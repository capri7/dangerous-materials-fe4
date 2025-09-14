// supabase/functions/create-checkout-session/index.ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "https://esm.sh/stripe@14?target=denonext";

type ReqBody = {
  priceId: string;           // 例: 'price_XXXX'
  user_id?: string | null;   // ログイン時のみ
  email?: string | null;     // 送れるときだけ（未ログインなら省略でOK）
  success_url?: string;      // 任意。未指定なら既定を組み立て
  cancel_url?: string;       // 任意。未指定なら既定を組み立て
};

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const SITE_URL          = Deno.env.get("SITE_URL") ?? ""; // なければ Referer / Origin を使う
const ALLOW_LIST        = (Deno.env.get("PRICE_IDS") ?? "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

// ---- helpers ----
const baseHeaders = {
  "content-type": "application/json; charset=utf-8",
  // CORS（フロントがどこでも試せるように *、必要に応じて固定に変更可）
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type, apikey, x-client-info",
  "access-control-allow-methods": "POST, OPTIONS",
};
const j = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: baseHeaders });

function detectUiOrigin(req: Request): string | null {
  const origin = req.headers.get("origin");
  if (origin) return origin;
  const referer = req.headers.get("referer");
  if (referer) {
    try { return new URL(referer).origin; } catch { /* no-op */ }
  }
  return SITE_URL || null;
}

// ---- handler ----
Deno.serve(async (req) => {
  // Preflight
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: baseHeaders });
  if (req.method !== "POST")   return j({ error: "METHOD_NOT_ALLOWED" }, 405);

  // JSON parse
  let body: ReqBody;
  try {
    body = await req.json();
  } catch {
    return j({ error: "INVALID_JSON" }, 400);
  }

  const { priceId, user_id, email } = body;
  if (!priceId) return j({ error: "MISSING_PRICE_ID" }, 400);

  // 任意の価格制限（PRICE_IDS が設定されていればチェック）
  if (ALLOW_LIST.length && !ALLOW_LIST.includes(priceId)) {
    return j({ error: "PRICE_NOT_ALLOWED", priceId }, 400);
  }

  // success/cancel URL の既定値を決定
  const uiOrigin = detectUiOrigin(req);
  if (!uiOrigin) return j({ error: "MISSING_ORIGIN" }, 400);

  const success_url = body.success_url ?? `${uiOrigin}/success.html?session_id={CHECKOUT_SESSION_ID}`;
  const cancel_url  = body.cancel_url  ?? `${uiOrigin}/checkout.html?canceled=1`;

  try {
    // ここが肝心：user_id を client_reference_id と metadata の両方に載せる
    // email があれば customer_email として渡す
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      success_url,
      cancel_url,

      // 連携情報
      client_reference_id: user_id ?? undefined,
      customer_email: email ?? undefined,
      metadata: user_id ? { user_id } : undefined,
      subscription_data: user_id ? { metadata: { user_id } } : undefined,
    });

    // URL を返す
    return j({ url: session.url, id: session.id }, 200);
  } catch (e) {
    // Stripe からのメッセージをそのまま返しすぎないように最低限に抑える
    return j({ error: "STRIPE_ERROR", message: String(e) }, 500);
  }
});
