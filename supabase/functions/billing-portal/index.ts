import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import Stripe from "npm:stripe";
import { createClient } from "npm:@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2024-06-20",
});

const allow = new Set([
  "https://kikenbutsu-z4.com",
  "https://www.kikenbutsu-z4.com",
  "http://localhost:5173",
  "http://localhost:3000",
]);

// ★ 引数に allowHeaders を追加して、preflight で反射できるようにする
function cors(origin: string, allowHeaders?: string) {
  const o = allow.has(origin) ? origin : "https://kikenbutsu-z4.com";
  return {
    "Access-Control-Allow-Origin": o,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    // 要求されたヘッダをそのまま返す（無ければ既定値）
    "Access-Control-Allow-Headers":
      allowHeaders ||
      "authorization, content-type, x-client-info, apikey, prefer",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

serve(async (req) => {
  const origin = req.headers.get("origin") ?? "";

  // ★ preflight は 204 + 許可ヘッダを反射
  if (req.method === "OPTIONS") {
    const acrh = req.headers.get("access-control-request-headers") ?? "";
    return new Response(null, { status: 204, headers: cors(origin, acrh) });
  }

  try {
    // 認証ユーザーを確定
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser(jwt);

    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json", ...cors(origin) },
      });
    }

    // Stripe customer を取得
    const { data: profile, error: profErr } = await supabase
      .from("user_profiles")
      .select("stripe_customer_id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (profErr) {
      return new Response(JSON.stringify({ error: "Profile lookup failed" }), {
        status: 500,
        headers: { "content-type": "application/json", ...cors(origin) },
      });
    }

    const customerId = profile?.stripe_customer_id ?? null;
    if (!customerId) {
      return new Response(JSON.stringify({ error: "No Stripe customer linked" }), {
        status: 400,
        headers: { "content-type": "application/json", ...cors(origin) },
      });
    }

    const body = await req.json().catch(() => ({} as any));
    const return_url = body.return_url || `${origin}/mypage.html`;

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url,
    });

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { "content-type": "application/json", ...cors(origin) },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { "content-type": "application/json", ...cors(origin) },
    });
  }
});
