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
  if (day === 22) return { title: "Aplicare regim provizoriu", body: `${name}, camera ${room} – carantina s-a încheiat ieri; astăzi este Ziua 22.` };
  return { title: "ATENȚIE – regim provizoriu restant", body: `${name}, camera ${room} – este Ziua 23. Regimul provizoriu trebuia aplicat ieri.` };
}

function groupedContent(items: any[]) {
  const sample = items.slice(0, 3).map((item) => `${String(item.nume_complet)} (camera ${String(item.camera)}, Ziua ${Number(item.quarantine_day)})`).join('; ');
  const extra = items.length > 3 ? `; +${items.length - 3} ${items.length - 3 === 1 ? "persoană" : "persoane"}` : "";
  return {
    title: `REGIM – ${items.length} ${items.length === 1 ? "persoană necesită" : "persoane necesită"} acțiune`,
    body: `${sample}${extra}.`,
  };
}

async function updateClaim(item: any, mode: "sent" | "failed" | "release", error = "") {
  const base = {
    p_user_id: item.user_id,
    p_ppl_id: item.ppl_id,
    p_day: item.quarantine_day,
    p_date: item.notification_date,
  };
  if (mode === "sent") return admin.rpc("mark_notification_sent", base);
  if (mode === "release") return admin.rpc("release_notification_claim", { ...base, p_error: error.slice(0, 500) });
  return admin.rpc("mark_notification_failed", { ...base, p_error: error.slice(0, 500) });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const token = req.headers.get("x-invocation-token");
  if (!token) return new Response("Unauthorized", { status: 401 });
  const { data: accepted, error: tokenError } = await admin.rpc("consume_notification_invocation", { p_token: token });
  if (tokenError || !isRpcTrue(accepted)) return new Response("Unauthorized", { status: 401 });

  const { data: candidates, error: candidateError } = await admin.rpc("notification_candidates");
  if (candidateError) return Response.json({ error: "Candidate lookup failed", detail: safeMessage(candidateError) }, { status: 500 });

  const stats = { ok: true, candidates: candidates?.length ?? 0, claimed: 0, claim_errors: 0, claim_rejected: 0, no_subscriptions: 0, sent: 0, failed: 0, grouped_pushes: 0 };
  if (!candidates?.length) return Response.json(stats, { headers: { "Cache-Control": "no-store" } });

  const vapid = await admin.rpc("get_vapid_keys");
  if (vapid.error || !vapid.data?.length) {
    return Response.json({ ...stats, reason: "push-not-initialized" }, { headers: { "Cache-Control": "no-store" } });
  }
  webpush.setVapidDetails("https://alin-talfes.github.io/regim/", vapid.data[0].public_key, vapid.data[0].private_key);

  const byUser = new Map<string, any[]>();
  for (const item of candidates) {
    const key = String(item.user_id);
    byUser.set(key, [...(byUser.get(key) ?? []), item]);
  }

  for (const [userId, userCandidates] of byUser) {
    const claimed: any[] = [];
    for (const item of userCandidates) {
      const { data: claim, error: claimError } = await admin.rpc("claim_notification", {
        p_user_id: item.user_id,
        p_ppl_id: item.ppl_id,
        p_day: item.quarantine_day,
        p_date: item.notification_date,
      });
      if (claimError) { stats.claim_errors += 1; continue; }
      if (!isRpcTrue(claim)) { stats.claim_rejected += 1; continue; }
      stats.claimed += 1;
      claimed.push(item);
    }
    if (!claimed.length) continue;

    const { data: subscriptions, error: subError } = await admin.rpc("notification_push_subscriptions", { p_user_id: userId });
    if (subError || !subscriptions?.length) {
      stats.no_subscriptions += claimed.length;
      const reason = subError ? `subscription lookup failed: ${safeMessage(subError)}` : "no active subscription";
      for (const item of claimed) await updateClaim(item, "release", reason);
      continue;
    }

    const message = claimed.length === 1 ? content(claimed[0]) : groupedContent(claimed);
    const payload = JSON.stringify({
      ...message,
      url: "/regim/#/alerte",
      tag: claimed.length === 1
        ? `regim-${claimed[0].ppl_id}-${claimed[0].quarantine_day}-${claimed[0].notification_date}`
        : `regim-group-${userId}-${claimed[0].notification_date}`,
      milestoneDate: claimed.length === 1 ? claimed[0].milestone_date : null,
      early: claimed.length === 1 ? Boolean(claimed[0].is_early) : false,
      grouped: claimed.length > 1,
      count: claimed.length,
    });

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
      for (const item of claimed) await updateClaim(item, "sent");
      stats.sent += claimed.length;
      if (claimed.length > 1) stats.grouped_pushes += 1;
    } else {
      const reason = errors.join(" | ").slice(0, 500) || "push failed";
      for (const item of claimed) await updateClaim(item, "failed", reason);
      stats.failed += claimed.length;
    }
  }

  return Response.json(stats, { headers: { "Cache-Control": "no-store" } });
});
