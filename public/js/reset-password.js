// /js/reset-password.js
import { supabase } from './supabaseClient.js';

const byId = (id) => document.getElementById(id);

const form      = byId('reset-form');
const submitBtn = byId('reset-submit');
const pw1       = byId('new-password');
const pw2       = byId('new-password-confirm');
const feedback  = byId('reset-feedback');
const linkWarn  = byId('link-warning');

function setFeedback(msg = '', type = 'ok') {
  if (!feedback) return;
  feedback.textContent = msg;
  feedback.classList.remove('ok', 'error');
  if (msg) feedback.classList.add(type);
}

// Supabase Auth の英語エラー → 日本語メッセージに変換
function translateAuthError(err) {
  const code = (err?.code || '').toLowerCase();
  const msg  = (err?.message || '');

  // 代表的なケース
  if (code === 'same_password') {
    return '新しいパスワードは以前のパスワードと異なる必要があります。';
  }
  if (/new password should be different/i.test(msg)) {
    return '新しいパスワードは以前のパスワードと異なる必要があります。';
  }
  if (/password (should be|must be).+6/i.test(msg)) {
    return 'パスワードは6文字以上で入力してください。';
  }
  if (/(expired|invalid).*(session|token)/i.test(msg)) {
    return 'リンクの有効期限が切れているか無効です。メールのリンクからもう一度お試しください。';
  }

  // デフォルト（英語本文を添えておく）
  return `更新に失敗しました：${msg || '不明なエラー'}`;
}


function toggleBusy(busy) {
  form?.setAttribute('aria-busy', busy ? 'true' : 'false');
  submitBtn.disabled = !!busy;
  pw1.disabled = !!busy;
  pw2.disabled = !!busy;
}

function enableForm(enabled) {
  submitBtn.disabled = !enabled;
  pw1.disabled = !enabled;
  pw2.disabled = !enabled;
  // 注意: 警告(#link-warning)はここでいじらない（確定時にだけ表示）
}

function showLinkWarning(show) {
  if (!linkWarn) return;
  linkWarn.classList.toggle('hidden', !show);
}

function passwordsValid() {
  const v1 = pw1.value;
  const v2 = pw2.value;
  if (v1.length < 6) {
    setFeedback('パスワードは6文字以上で入力してください。', 'error');
    pw1.focus();
    return false;
  }
  if (v1 !== v2) {
    setFeedback('確認用のパスワードが一致しません。', 'error');
    pw2.focus();
    return false;
  }
  return true;
}

/** (#access_token / #refresh_token) が付いている古い/一部テンプレのリンクに対応 */
async function adoptSessionFromHashIfNeeded() {
  const hash = (location.hash || '').replace(/^#/, '');
  if (!hash) return;
  const sp = new URLSearchParams(hash);
  const at = sp.get('access_token');
  const rt = sp.get('refresh_token');
  if (at && rt) {
    try {
      await supabase.auth.setSession({ access_token: at, refresh_token: rt });
    } catch (_) { /* noop */ }
    // URLをクリーンに
    history.replaceState({}, document.title, location.pathname + location.search);
  }
}

/** リカバリリンクから来て session が作れているか？ */
async function hasRecoverySession() {
  // 既に session があるか
  const { data } = await supabase.auth.getSession();
  if (data?.session) return true;

  // ?code=... 方式に対応
  const params = new URLSearchParams(location.search);
  const code = params.get('code');
  if (code && typeof supabase.auth.exchangeCodeForSession === 'function') {
    try {
      await supabase.auth.exchangeCodeForSession(code);
      const after = await supabase.auth.getSession();
      return !!after.data?.session;
    } catch {
      /* noop */
    }
  }
  return false;
}

async function init() {
  // 初期状態: フォームは無効・警告は非表示のまま
  enableForm(false);
  showLinkWarning(false);
  setFeedback('リンクを確認しています…', 'ok');

  // ハッシュ(#token)対応を先に試す
  await adoptSessionFromHashIfNeeded();

  // PASSWORD_RECOVERY を拾えたら即フォーム有効化
  supabase.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') {
      enableForm(true);
      showLinkWarning(false);
      setFeedback('');
    }
  });

  // 直接 session が拾えるか確認
  const ok = await hasRecoverySession();
  if (ok) {
    enableForm(true);
    showLinkWarning(false);
    setFeedback('');
  } else {
    // タイミング差の保険: 少し待って再確認
    setTimeout(async () => {
      const again = await supabase.auth.getSession();
      const ready = !!again.data?.session;
      enableForm(ready);
      showLinkWarning(!ready); // ここで初めて警告を出す
      setFeedback(
        ready ? '' :
        'リンクが無効、または有効期限切れの可能性があります。メールからもう一度お試しください。',
        ready ? 'ok' : 'error'
      );
    }, 400);
  }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  setFeedback('');

  if (!passwordsValid()) return;

  toggleBusy(true);
  try {
    const { error } = await supabase.auth.updateUser({ password: pw1.value });
    if (error) {
      const code = (error.code || '').toLowerCase();
      const m = (error.message || '');
      if (code === 'session_not_found' || /expired|invalid|session|token/i.test(m)) {
        showLinkWarning(true);
        setFeedback('リンクの有効期限が切れているか無効です。メールのリンクからもう一度お試しください。', 'error');
      } else {
        setFeedback(translateAuthError(error), 'error');
      }
      return;
    }
    // 成功
    pw1.value = '';
    pw2.value = '';
    setFeedback('パスワードを更新しました。ログイン画面からサインインしてください。', 'ok');
    setTimeout(() => { window.location.href = '/login.html'; }, 1500);
  } catch (err) {
    setFeedback(`更新に失敗しました：${String(err)}`, 'error');
  } finally {
    toggleBusy(false);
  }
});

init();

