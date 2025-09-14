// supabase/functions/portal/index.ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const SITE_URL = Deno.env.get("SITE_URL")!;

function cors(status: number, body: unknown, origin?: string) {
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": origin ?? SITE_URL,
    "access-control-allow-headers": "authorization, content-type, apikey",
    "access-control-allow-methods": "POST, OPTIONS",
    "vary": "Origin",
  };
  if (status === 204) return new Response(null, { status, headers }); // 204はボディ無し
  return new Response(JSON.stringify(body), { status, headers });
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin") ?? undefined;

  if (req.method === "OPTIONS") return cors(204, {}, origin);
  if (req.method !== "POST")    return cors(405, { error: "METHOD_NOT_ALLOWED" }, origin);

  let body: { session_id?: string; customer_id?: string };
  try {
    body = await req.json();
  } catch {
    return cors(400, { error: "BAD_JSON" }, origin);
  }

  // Stripe は POST 内で遅延初期化（プリフライトでは実行されない）
  const secret = Deno.env.get("STRIPE_SECRET_KEY");
  if (!secret) return cors(500, { error: "MISSING_ENV", key: "STRIPE_SECRET_KEY" }, origin);
  const { default: Stripe } = await import("https://esm.sh/stripe@14?target=denonext");
  const stripe = new Stripe(secret, { apiVersion: "2024-06-20" });

  // 顧客の特定：customer_idがあれば優先。無ければsession_id→customer解決
  let customerId = body.customer_id;
  if (!customerId) {
    const sid = body.session_id;
    if (!sid) return cors(400, { error: "MISSING_PARAM", detail: "session_id or customer_id is required" }, origin);
    try {
      const s = await stripe.checkout.sessions.retrieve(sid);
      const c = s.customer;
      if (!c) return cors(400, { error: "CUSTOMER_NOT_FOUND", detail: "no customer on session" }, origin);
      customerId = typeof c === "string" ? c : c.id;
    } catch (e) {
      return cors(400, { error: "INVALID_SESSION", detail: String(e) }, origin);
    }
  }

  try {
    const portal = await stripe.billingPortal.sessions.create({
      customer: customerId!,
      return_url: `${SITE_URL}/mypage.html`,
    });
    return cors(200, { url: portal.url }, origin);
  } catch (e) {
    return cors(500, { error: "PORTAL_CREATE_FAILED", detail: String(e) }, origin);
  }
});

