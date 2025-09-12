// /js/billing-portal.js
import { supabase } from './supabaseClient.js';

// Supabase Edge Function (portal) と anon key
const portalFnUrl = 'https://vyzkkkskmwyctznbczzr.functions.supabase.co/portal';
const anonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ5emtra3NrbXd5Y3R6bmJjenpyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDk4NzUxNzEsImV4cCI6MjA2NTQ1MTE3MX0.OXCQww5s83c4y1KFN_60Bo7aftKDiXfOT6hQsoGcJ2w';

let _opening = false;
export async function openBillingPortal() {
  if (_opening) return;
  _opening = true;


  try {
    // ログイン必須
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { 
        location.href = '/login.html'; 
        return; 
    }

    // customer_id を取得（無い＝未購入 → 購入導線へ）
    const { data: profile, error } = await supabase
      .from('user_profiles')
      .select('stripe_customer_id')
      .eq('user_id', user.id)
      .maybeSingle();

    if (error) throw error;

    if (!profile?.stripe_customer_id) {
      location.href = '/checkout.html';
      return;
    }

    // ▼ ここから追加：最新のJWTを取得（自動リフレッシュ対応）
    const { data: { session } } = await supabase.auth.getSession();
    const jwt = session?.access_token;

    // ポータルURLを発行して遷移
    const res = await fetch(portalFnUrl, {
    method: 'POST',
    headers: {
        'content-type': 'application/json',
        'apikey': anonKey,
        // JWT が取れたらそれを、無ければ従来どおり anonKey を Bearer に
        'authorization': `Bearer ${jwt || anonKey}`,
    },
    body: JSON.stringify({ customer_id: profile.stripe_customer_id })
  });

    const json = await res.json();
    if (!res.ok || !json.url) {
      throw new Error('Failed to create billing portal session');
    }
      location.href = json.url;
    } catch (e) {
    console.error(e);
    alert('請求ポータルを開けませんでした。しばらくして再度お試しください。');
  } finally {
    // ページ遷移しないケースでも必ず解除
    _opening = false;
  }
}


// ヘッダーのリンクに自動で紐付け
document.addEventListener('DOMContentLoaded', () => {
  const link = document.getElementById('link-cancel');
  if (!link) return;
  link.setAttribute('href', '#'); 
  link.addEventListener('click', (e) => { e.preventDefault(); openBillingPortal(); });
});
