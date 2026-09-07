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
    } catch { /* fall through to legacy built-in env */ }
  }
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!legacy) throw new Error("Missing Supabase server key");
  return legacy;
}

const admin = createClient(url, secretKey(), { auth: { persistSession: false, autoRefreshToken: false } });

function safeMessage(value: unknown): string {
  return value instanceof Error ? value.message.slice(0, 500) : String(value).slice(0, 500);
}
function content(day: number, name: string, room: string) {
  if (day === 20) return { title: `Carantină: ${name}`, body: `Camera ${room} – carantina expiră mâine.` };
  if (day === 21) return { title: "Carantină expiră astăzi", body: `${name}, camera ${room}, împlinește astăzi 21 de zile.` };
  return { title: "Carantină expirată", body: `${name}, camera ${room} – perioada de 21 de zile s-a împlinit ieri.` };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const token = req.headers.get("x-invocation-token");
  if (!token) return new Response("Unauthorized", { status: 401 });
  const { data: accepted, error: tokenError } = await admin.rpc("consume_notification_invocation", { p_token: token });
  if (tokenError || accepted !== true) return new Response("Unauthorized", { status: 401 });

  const { data: candidates, error: candidateError } = await admin.rpc("notification_candidates");
  if (candidateError) return Response.json({ error: "Candidate lookup failed" }, { status: 500 });
  if (!candidates?.length) {
    return Response.json({ ok: true, sent: 0, failed: 0 }, { headers: { "Cache-Control": "no-store" } });
  }

  const vapid = await admin.rpc("get_vapid_keys");
  if (vapid.error || !vapid.data?.length) {
    return Response.json({ ok: true, sent: 0, failed: 0, reason: "push-not-initialized" }, { headers: { "Cache-Control": "no-store" } });
  }
  webpush.setVapidDetails("https://alin-talfes.github.io/regim/", vapid.data[0].public_key, vapid.data[0].private_key);

  let sent = 0;
  let failed = 0;
  for (const item of candidates ?? []) {
    const { data: claim, error: claimError } = await admin.rpc("claim_notification", {
      p_user_id: item.user_id, p_ppl_id: item.ppl_id, p_day: item.quarantine_day, p_date: item.notification_date,
    });
    if (claimError || claim !== true) continue;

    const { data: subscriptions, error: subError } = await admin.from("push_subscriptions")
      .select("id,endpoint,p256dh,auth").eq("user_id", item.user_id).eq("enabled", true);
    if (subError || !subscriptions?.length) {
      await admin.rpc("release_notification_claim", {
        p_user_id: item.user_id, p_ppl_id: item.ppl_id, p_day: item.quarantine_day,
        p_date: item.notification_date, p_error: subError ? "subscription lookup failed" : "no active subscription",
      });
      continue;
    }

    const message = content(item.quarantine_day, item.nume_complet, item.camera);
    const payload = JSON.stringify({ ...message, url: "/regim/#/alerte", tag: `regim-${item.ppl_id}-${item.quarantine_day}-${item.notification_date}` });
    let delivered = 0;
    const errors: string[] = [];
    for (const subscription of subscriptions) {
      try {
        await webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, payload, { TTL: 3600, urgency: "high" });
        delivered += 1;
      } catch (err: any) {
        const status = Number(err?.statusCode ?? err?.status ?? 0);
        if (status === 404 || status === 410) await admin.from("push_subscriptions").update({ enabled: false }).eq("id", subscription.id);
        errors.push(safeMessage(err));
      }
    }

    if (delivered > 0) {
      await admin.rpc("mark_notification_sent", { p_user_id: item.user_id, p_ppl_id: item.ppl_id, p_day: item.quarantine_day, p_date: item.notification_date });
      sent += 1;
    } else {
      await admin.rpc("mark_notification_failed", { p_user_id: item.user_id, p_ppl_id: item.ppl_id, p_day: item.quarantine_day, p_date: item.notification_date, p_error: errors.join(" | ").slice(0, 500) || "push failed" });
      failed += 1;
    }
  }
  return Response.json({ ok: true, sent, failed }, { headers: { "Cache-Control": "no-store" } });
});
