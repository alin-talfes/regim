import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2.115.0";
import webpush from "npm:web-push@3.6.7";

const url = Deno.env.get("SUPABASE_URL")!;

function secretKey(): string {
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, string>;
      if (parsed.default) return parsed.default;
    } catch { /* fallback */ }
  }
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!legacy) throw new Error("Missing Supabase server key");
  return legacy;
}

const admin = createClient(url, secretKey(), { auth: { persistSession: false, autoRefreshToken: false } });

function safeMessage(value: unknown): string {
  return value instanceof Error ? value.message.slice(0, 500) : String(value).slice(0, 500);
}

function isRpcTrue(value: unknown): boolean {
  return value === true || value === "true" || value === 1 || value === "1";
}

function formatYmd(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
  return match ? `${match[3]}.${match[2]}.${match[1]}` : value;
}

function content(item: any) {
  const day = Number(item.quarantine_day);
  const name = String(item.nume_complet);
  const room = String(item.camera);
  if (item.is_early) {
    const date = formatYmd(String(item.milestone_date));
    const reason = String(item.non_working_reason || "zi nelucrătoare");
    if (day === 20) return { title: "Atenție – Ziua 20 nelucrătoare", body: `${name}, camera ${room}: Ziua 20 cade ${reason} (${date}). Tratați astăzi cazul.` };
    if (day === 21) return { title: "Atenție – expirare în zi nelucrătoare", body: `${name}, camera ${room}: Ziua 21 cade ${reason} (${date}). Tratați astăzi expirarea carantinei.` };
    return { title: "Atenție – regim provizoriu", body: `${name}, camera ${room}: Ziua 22 cade ${reason} (${date}). Tratați astăzi aplicarea regimului provizoriu.` };
  }
  if (day === 20) return { title: `Carantină: ${name}`, body: `Camera ${room} – carantina expiră mâine.` };
  if (day === 21) return { title: "Carantină expiră astăzi", body: `${name}, camera ${room}, împlinește astăzi 21 de zile.` };
  return { title: "Aplicare regim provizoriu", body: `${name}, camera ${room} – carantina s-a încheiat ieri; astăzi este Ziua 22.` };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const token = req.headers.get("x-invocation-token");
  if (!token) return new Response("Unauthorized", { status: 401 });
  const { data: accepted, error: tokenError } = await admin.rpc("consume_notification_invocation", { p_token: token });
  if (tokenError || !isRpcTrue(accepted)) return new Response("Unauthorized", { status: 401 });

  const { data: candidates, error: candidateError } = await admin.rpc("notification_candidates");
  if (candidateError) return Response.json({ error: "Candidate lookup failed", detail: safeMessage(candidateError) }, { status: 500 });

  const stats = { ok: true, candidates: candidates?.length ?? 0, claimed: 0, claim_errors: 0, claim_rejected: 0, no_subscriptions: 0, sent: 0, failed: 0 };
  if (!candidates?.length) return Response.json(stats, { headers: { "Cache-Control": "no-store" } });

  const vapid = await admin.rpc("get_vapid_keys");
  if (vapid.error || !vapid.data?.length) {
    return Response.json({ ...stats, reason: "push-not-initialized" }, { headers: { "Cache-Control": "no-store" } });
  }
  webpush.setVapidDetails("https://alin-talfes.github.io/regim/", vapid.data[0].public_key, vapid.data[0].private_key);

  for (const item of candidates) {
    const { data: claim, error: claimError } = await admin.rpc("claim_notification", {
      p_user_id: item.user_id,
      p_ppl_id: item.ppl_id,
      p_day: item.quarantine_day,
      p_date: item.notification_date,
    });
    if (claimError) { stats.claim_errors += 1; continue; }
    if (!isRpcTrue(claim)) { stats.claim_rejected += 1; continue; }
    stats.claimed += 1;

    const { data: subscriptions, error: subError } = await admin.rpc("notification_push_subscriptions", { p_user_id: item.user_id });
    if (subError || !subscriptions?.length) {
      stats.no_subscriptions += 1;
      await admin.rpc("release_notification_claim", {
        p_user_id: item.user_id,
        p_ppl_id: item.ppl_id,
        p_day: item.quarantine_day,
        p_date: item.notification_date,
        p_error: subError ? `subscription lookup failed: ${safeMessage(subError)}` : "no active subscription",
      });
      continue;
    }

    const message = content(item);
    const payload = JSON.stringify({ ...message, url: "/regim/#/alerte", tag: `regim-${item.ppl_id}-${item.quarantine_day}-${item.notification_date}`, milestoneDate: item.milestone_date, early: Boolean(item.is_early) });
    let delivered = 0;
    const errors: string[] = [];

    for (const subscription of subscriptions) {
      try {
        await webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, payload, { TTL: 3600, urgency: "high" });
        delivered += 1;
      } catch (err: any) {
        const status = Number(err?.statusCode ?? err?.status ?? 0);
        if (status === 404 || status === 410) await admin.from("push_subscriptions").update({ enabled: false }).eq("id", subscription.id);
        errors.push(`status=${status || "unknown"}: ${safeMessage(err)}`);
      }
    }

    if (delivered > 0) {
      await admin.rpc("mark_notification_sent", { p_user_id: item.user_id, p_ppl_id: item.ppl_id, p_day: item.quarantine_day, p_date: item.notification_date });
      stats.sent += 1;
    } else {
      await admin.rpc("mark_notification_failed", { p_user_id: item.user_id, p_ppl_id: item.ppl_id, p_day: item.quarantine_day, p_date: item.notification_date, p_error: errors.join(" | ").slice(0, 500) || "push failed" });
      stats.failed += 1;
    }
  }

  return Response.json(stats, { headers: { "Cache-Control": "no-store" } });
});
