// js/index.js
import { supabase } from './supabaseClient.js';

// ログアウト用の関数
let signingOut = false;
async function logoutHandler(e) {
  e.preventDefault();
  if (signingOut) return;
  signingOut = true;

  document.body.setAttribute('aria-busy', 'true');

  try {
    const { error } = await supabase.auth.signOut();
    if (error) alert('ログアウトに失敗しました: ' + error.message);
    else window.location.href = '/login.html';
  } finally {
    document.body.removeAttribute('aria-busy');
    signingOut = false;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const nav = document.querySelector('.nav-links');
  if (!nav) return;

  nav.addEventListener('click', (e) => {
    const target = e.target instanceof Element ? e.target : null;
    if (!target) return;

    // 要素自身がマッチするセレクタに修正（navスコープ内なのでこれで十分）
    const t = target.closest('#link-logout, a.logout, [data-action="logout"]');
    if (!t) return;
    t.blur?.();

    logoutHandler(e);
  });
});
