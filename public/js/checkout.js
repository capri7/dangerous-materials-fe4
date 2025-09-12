// /js/checkout.js
import { supabase } from '/js/supabaseClient.js';

document.addEventListener('DOMContentLoaded', () => {
  // checkout ページ以外では何もしない（保険）
  if (!document.body.classList.contains('page-checkout')) return;

  const agree = document.getElementById('agree');
  const btn   = document.getElementById('start-checkout') || document.getElementById('checkoutBtn');
  const errEl = document.getElementById('consent-error'); // ない場合は null でOK

  // エラー表示用（任意要素）。なければ動的に作る
  let flowErr  = document.getElementById('checkout-error');
  if (!flowErr) {
    flowErr = document.createElement('p');
    flowErr.id = 'checkout-error';
    flowErr.style.color = '#b91c1c';
    flowErr.style.marginTop = '8px';
    flowErr.style.fontSize = '.9rem';
    flowErr.hidden = true;
    // ボタンの近くに差し込む（なければ末尾）
    (btn?.parentElement || document.body).appendChild(flowErr);
  }

  if (!agree || !btn) return; // 要素が無ければ終了

  let live = document.getElementById('checkout-status');
  if (!live) {
    live = document.createElement('p');
    live.id = 'checkout-status';
    live.setAttribute('role', 'status');
    live.setAttribute('aria-live', 'polite');
    // 視覚的に隠す（sr-only）
    Object.assign(live.style, {
      position: 'absolute', width: '1px', height: '1px',
      margin: '-1px', border: '0', padding: '0',
      clip: 'rect(0 0 0 0)', overflow: 'hidden'
    });
    (btn.parentElement || document.body).appendChild(live);
  }

  function updateState() {
    const ok = agree.checked;
    btn.disabled = !ok;
    btn.setAttribute('aria-disabled', String(!ok));
    btn.classList.toggle('is-disabled', !ok);
    if (errEl) errEl.hidden = true; // 入力中はエラーを隠す
  }

  agree.addEventListener('change', updateState);
  updateState();

  // 万一、無効状態でクリックできた場合の保険（通常は発火しない）
  btn.addEventListener('click', (e) => {
    if (btn.disabled) {
      e.preventDefault();
      if (errEl) errEl.hidden = false;
      agree.focus();
    }
  });

 // 設定値
  const FN_URL = 'https://vyzkkkskmwyctznbczzr.functions.supabase.co/create-checkout-session';
  const ANON   = window.__ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ5emtra3NrbXd5Y3R6bmJjenpyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDk4NzUxNzEsImV4cCI6MjA2NTQ1MTE3MX0.OXCQww5s83c4y1KFN_60Bo7aftKDiXfOT6hQsoGcJ2w';

  function getPriceId() {
    // 取得優先度: ボタン data-price-id → <meta name="stripe:price_id"> → 隠しinput#priceId
    const byData   = btn?.dataset?.priceId;
    const byMeta   = document.querySelector('meta[name="stripe:price_id"]')?.getAttribute('content');
    const byInput  = document.getElementById('priceId')?.value;
    return byData || byMeta || byInput || null;
  }

async function startCheckout() {
  flowErr.hidden = true;
  flowErr.textContent = '';

  const priceId = getPriceId();
  if (!priceId) {
    flowErr.textContent = '価格IDが設定されていません（data-price-id などを設定してください）。';
    flowErr.hidden = false;
    return;
  }

  // ✅ ボタンのUI更新（ここが「ボタンのUI更新」ブロックです）
  const prevLabel = btn.textContent;
  const hadBusy   = btn.hasAttribute('aria-busy'); // 復元用に保持
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true'); 
  btn.setAttribute('aria-describedby', 'checkout-status');     
  btn.textContent = '処理中…';
  if (live) live.textContent = '処理中です。まもなく決済ページに移動します。';

    try {
    // ログインしている場合だけ user_id / email を同梱（Supabaseから取得）
    const { data: { user } } = await supabase.auth.getUser();
    const user_id = user?.id ?? null;
    const email   = user?.email ?? null;

    const payload = {
      priceId,
      user_id,
      email,
      success_url: `${location.origin}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${location.origin}/checkout.html?canceled=1`,
    };

    const res = await fetch(FN_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${ANON}`,


        'apikey': ANON,
      },
      body: JSON.stringify(payload),
    });

    const json = await res.json();
    if (res.ok && json.url) {
      location.href = json.url; // Stripe Checkout へ遷移（成功時は復旧不要）
      return;
    }

    throw new Error(json?.error || 'Checkoutの開始に失敗しました');
  } catch (e) {
    // ❗ 失敗時だけ復旧
    flowErr.textContent = `エラー: ${String(e)}`;
    flowErr.hidden = false;

    if (!hadBusy) btn.removeAttribute('aria-busy'); else btn.setAttribute('aria-busy', 'false');
    btn.disabled = false;
    btn.textContent = prevLabel;
    if (live) live.textContent = 'エラーが発生しました。もう一度お試しください。';
  }
}

  // 有効時クリックで Checkout を開始
  btn.addEventListener('click', (e) => {
    if (btn.disabled) return; // 無効時は上の保険ハンドラが対応
    e.preventDefault();       // フォーム送信/リンク遷移を抑止して明示的に開始
    startCheckout();
  });

});


