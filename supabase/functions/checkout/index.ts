// supabase/functions/checkout/index.ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// ==== env ====
const LOOKUP_KEY = Deno.env.get("STRIPE_PRICE_LOOKUP_KEY")!;
const SITE_URL   = Deno.env.get("SITE_URL")!;

function cors(status: number, body: unknown, origin?: string) {
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": origin ?? SITE_URL,
    "access-control-allow-headers": "authorization, content-type, apikey",
    "access-control-allow-methods": "POST, OPTIONS",
    "vary": "Origin",
  };
  if (status === 204) return new Response(null, { status, headers });

  return new Response(JSON.stringify(body), { status, headers });
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin") ?? undefined;

  if (req.method === "OPTIONS") return cors(204, {}, origin);
  if (req.method !== "POST")    return cors(405, { error: "METHOD_NOT_ALLOWED" }, origin);

  let body: { agree?: boolean; lookup_key?: string; user_id?: string };
  try {
    body = await req.json();
  } catch {
    return cors(400, { error: "BAD_JSON" }, origin);
  }

  if (!body.agree)                   return cors(400, { error: "AGREE_REQUIRED" }, origin);
  if (body.lookup_key !== LOOKUP_KEY) return cors(400, { error: "INVALID_PLAN" }, origin);

  // ここで Stripe を動的 import + 遅延初期化（OPTIONSでは実行されない）
  const secret = Deno.env.get("STRIPE_SECRET_KEY");
  if (!secret) return cors(500, { error: "MISSING_ENV", key: "STRIPE_SECRET_KEY" }, origin);

  const { default: Stripe } = await import("https://esm.sh/stripe@14?target=denonext");
  const stripe = new Stripe(secret, { apiVersion: "2024-06-20" });

  const prices = await stripe.prices.list({ lookup_keys: [LOOKUP_KEY], limit: 1 });
  const price = prices.data[0];
  if (!price) return cors(400, { error: "PRICE_NOT_FOUND" }, origin);

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: price.id, quantity: 1 }],
    allow_promotion_codes: true,
    success_url: `${SITE_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url:  `${SITE_URL}/cancel.html`,
    client_reference_id: body.user_id ?? undefined,
    metadata: body.user_id ? { user_id: body.user_id } : undefined,
  });

  return cors(200, { url: session.url }, origin);
});



