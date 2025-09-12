// public/js/nav.js
import { supabase } from './supabaseClient.js';

document.addEventListener('DOMContentLoaded', () => {
  // wait for nav elements to exist
  const retryUntilElementsExist = (callback, retries = 10) => {
   const checkout = document.getElementById('link-checkout');
   const cancel = document.getElementById('link-cancel');

   if (checkout || cancel) {
     callback(checkout, cancel);
   } else if (retries > 0) {
     setTimeout(() => retryUntilElementsExist(callback, retries - 1), 100);
   } else {
     console.warn('ナビゲーション要素が見つかりませんでした。');
   }
 };

  const show  = (el) => el && el.classList.remove('hidden');
  const hide  = (el) => el && el.classList.add('hidden');

  retryUntilElementsExist(async (checkoutLink, cancelLink) => {
    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();

      if (sessionError || !session) {
        // 未ログイン → 購入を見せる／キャンセルは隠す
        show(checkoutLink);
        hide(cancelLink);
        return;
      }

      const ACTIVE = ['active', 'trialing',  'past_due']; 
      let active = false;

 // 1) subscriptions から最新1件を取得（updated_at → created_at フォールバック）
      let sub = null, subError = null;

      let res = await supabase
        .from('subscriptions')
        .select('status, updated_at, created_at')
        .eq('user_id', session.user.id)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      sub = res.data; subError = res.error;

      // updated_at が無い等のエラー時は created_at で取り直す
      if (subError && /updated_at/i.test(subError.message || '')) {
        res = await supabase
          .from('subscriptions')
          .select('status, created_at')
          .eq('user_id', session.user.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        sub = res.data; subError = res.error;
      }

      if (!subError && sub) {
        active = ACTIVE.includes(String(sub.status || '').toLowerCase());
      } else {
        // 2) フォールバック：profiles 側の subscription_status を見る
        const { data: prof } = await supabase
          .from('user_profiles')
          .select('subscription_status')
          .eq('user_id', session.user.id)
          .maybeSingle();
        active = ACTIVE.includes(String(prof?.subscription_status || '').toLowerCase());
      }

      if (active) {
        show(cancelLink);
        hide(checkoutLink);
      } else {
        show(checkoutLink);
        hide(cancelLink);
      }
    } catch (e) {
      console.error('ナビ状態更新で例外:', e);
      // 例外時も購入側を見せておく
      show(checkoutLink);
      hide(cancelLink);
    }
  });
});

// --- フッターの法務リンクをページに応じて自動生成 ---
(function setupLegalLinks() {
  const el = document.querySelector('.legal-links');
  if (!el) return;

  const path = location.pathname.replace(/\/+$/, ''); // 末尾スラッシュ除去

  const ALL = {
    privacy: { href: '/privacy.html', label: 'プライバシーポリシー' },
    terms:   { href: '/terms.html',   label: '利用規約' },
    tokusho: { href: '/legal-tokusho.html', label: '特定商取引法に基づく表記' }
  };

  // 各ページで「自分以外の2ページ」だけを表示
  const map = {
    '/terms.html':          ['privacy','tokusho'],
    '/privacy.html':        ['terms','tokusho'],
    '/legal-tokusho.html':  ['privacy','terms']
  };

  // それ以外の一般ページは3点すべて出す（任意で2点にしてもOK）
  const keys = map[path] || ['privacy','terms','tokusho'];

  el.innerHTML = keys
    .map(k => `<a href="${ALL[k].href}" class="footer-link">${ALL[k].label}</a>`)
    .join('<span>／</span>');
})();


