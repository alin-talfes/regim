import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2.115.0";
import webpush from "npm:web-push@3.6.7";

const url = Deno.env.get("SUPABASE_URL")!;
const ALLOWED_ORIGINS = new Set([
  "https://alin-talfes.github.io",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);

function corsHeaders(req: Request): HeadersInit {
  const origin = req.headers.get("origin");
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Vary": "Origin",
  };
  if (origin && ALLOWED_ORIGINS.has(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function json(req: Request, body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { ...corsHeaders(req), "Cache-Control": "no-store" },
  });
}

function namedKey(envName: string, legacyEnvName: string): string {
  const raw = Deno.env.get(envName);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, string>;
      if (parsed.default) return parsed.default;
    } catch { /* fall through to legacy built-in env */ }
  }
  const legacy = Deno.env.get(legacyEnvName);
  if (!legacy) throw new Error(`Missing ${envName}/${legacyEnvName}`);
  return legacy;
}

const publishableKey = namedKey("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");
const secretKey = namedKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
const admin = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    const origin = req.headers.get("origin");
    if (origin && !ALLOWED_ORIGINS.has(origin)) return new Response(null, { status: 403, headers: corsHeaders(req) });
    return new Response(null, { status: 204, headers: corsHeaders(req) });
  }
  if (req.method !== "GET" && req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders(req) });

  const origin = req.headers.get("origin");
  if (origin && !ALLOWED_ORIGINS.has(origin)) return json(req, { error: "Forbidden" }, 403);

  const authorization = req.headers.get("authorization");
  if (!authorization) return json(req, { error: "Unauthorized" }, 401);

  const userClient = createClient(url, publishableKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: profile, error: profileError } = await userClient.from("profiles").select("id,active").maybeSingle();
  if (profileError || !profile?.active) return json(req, { error: "Forbidden" }, 403);

  const current = await admin.rpc("get_vapid_public_key");
  if (current.error) return json(req, { error: "Push configuration unavailable" }, 500);
  let publicKey = current.data as string | null;
  if (!publicKey) {
    const generated = webpush.generateVAPIDKeys();
    const stored = await admin.rpc("store_vapid_keys", { p_public_key: generated.publicKey, p_private_key: generated.privateKey });
    if (stored.error) return json(req, { error: "Push configuration unavailable" }, 500);

    const reread = await admin.rpc("get_vapid_public_key");
    if (reread.error || !reread.data) return json(req, { error: "Push configuration unavailable" }, 500);
    publicKey = reread.data as string;
  }

  return json(req, { publicKey });
});
