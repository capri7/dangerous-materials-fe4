// /js/billing-portal.js
import { supabase } from './supabaseClient.js';

let opening = false;

async function openPortal() {
  if (opening) return;
  opening = true;
  try {
    // ✅ getSession から user は取り出さない。session.user を使う
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) { location.href = '/login.html'; return; }

    // 未契約なら購入へ
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('stripe_customer_id')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!profile?.stripe_customer_id) { location.href = '/checkout.html'; return; }

    // Edge Function を呼び出し（JWTはSDKが自動付与）
    const endpoint = 'https://vyzkkkskmwyctznbczzr.functions.supabase.co/billing-portal';
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${session.access_token}`, // これだけでOK
      },
      body: JSON.stringify({ return_url: `${location.origin}/mypage.html` }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.url) throw new Error(json.error || 'No portal URL');

    location.href = json.url;
  } catch (err) {
    console.error(err);
    alert('請求ポータルを開けませんでした。しばらくして再度お試しください。');
  } finally {
    opening = false;
  }
}

// イベント紐付け
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('link-cancel')?.addEventListener('click', (e) => {
    e.preventDefault(); openPortal();
  });
  document.getElementById('btn-open-portal')?.addEventListener('click', (e) => {
    e.preventDefault(); openPortal();
  });
});

export { openPortal as openBillingPortal };
