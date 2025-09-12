// /js/login.js
import { supabase } from './supabaseClient.js';

function setFeedback(msg, type = 'ok') {
  const box = document.getElementById('login-feedback');
  if (!box) return;
  box.textContent = msg || '';
  box.classList.remove('ok', 'error');
  if (msg) box.classList.add(type);
}

function toggleBusy(busy) {
  const btn = document.getElementById('login-submit');
  const reset = document.getElementById('send-reset');
  const form = document.getElementById('login-form');
  const email = document.getElementById('email');
  btn.disabled = !!busy;
  reset.disabled = !!busy;
  if (email) email.disabled = !!busy;
  form.setAttribute('aria-busy', busy ? 'true' : 'false');
}

function mapAuthError(err, { forReset = false } = {}) {
  const code   = String(err?.code || '').toLowerCase();
  const msg    = String(err?.message || '').toLowerCase();
  const status = Number(err?.status || 0);

 // サインイン時の典型
  if (!forReset && (code === 'invalid_credentials' || /invalid login|email|password/.test(msg))) {
    return 'メールアドレスまたはパスワードが正しくありません。';
  }
  if (code === 'email_not_confirmed' || /not confirmed|email not confirmed/.test(msg)) {
    return 'メール確認が未完了です。受信メールのリンクから有効化してください。';
  }

  // パスワード再設定メールの送信
  if (forReset && (status === 429 || code === 'over_email_send_rate_limit' || /rate|too many|throttle/.test(msg))) {
    return 'メール送信が混み合っています。1〜2分後にもう一度お試しください。';
  }
  if (forReset && (/redirect|not allowed|url not permitted|url not allowed/.test(msg))) {
    return 'リダイレクトURLが許可されていません。管理画面のURL設定を確認してください。';
  }

  // ネットワーク一般
  if (/network|fetch|failed to fetch|timeout/.test(msg)) {
    return 'ネットワークエラーが発生しました。接続を確認して再度お試しください。';
  }

  return `処理に失敗しました：${err?.message ?? '不明なエラー'}`;
}

document.addEventListener('DOMContentLoaded', () => {
  const pwInput   = document.getElementById('password');
  const emailEl   = document.getElementById('email');
  const toggleBtn = document.querySelector('.toggle-password');
  const form      = document.getElementById('login-form');
  const resetBtn  = document.getElementById('send-reset');

  if (!form || !emailEl || !pwInput) return;

  // 目アイコンでパスワード表示切替
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      const show = pwInput.type === 'password';
      pwInput.type = show ? 'text' : 'password';
      toggleBtn.setAttribute('aria-pressed', String(show));
      try {
       toggleBtn.style.color = show ? 'var(--accent-primary)' : 'var(--text-muted)';
      } catch {}
      pwInput.focus();
    });
  }

  // ログイン
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    setFeedback('');

    const email = emailEl.value.trim().toLowerCase();
    const password = pwInput.value;

    if (!email) { setFeedback('メールアドレスを入力してください。', 'error'); emailEl.focus(); return; }
    if (!password) { setFeedback('パスワードを入力してください。', 'error'); pwInput.focus(); return; }

    toggleBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setFeedback(mapAuthError(error), 'error');
        // 認証失敗時はパスワードだけ消して再入力を促す
        pwInput.value = '';
        pwInput.focus();
        return;
      }

      // 成功
      window.location.href = '/mypage.html';
    } catch (err) {
      setFeedback(`ログインに失敗しました：${String(err)}`, 'error');
    } finally {
      toggleBusy(false);
    }
  });

  // パスワード再設定メール送信
  if (resetBtn) {
    resetBtn.addEventListener('click', async (e) => {
     e?.preventDefault?.();   
     setFeedback('');     

      const email = emailEl.value.trim().toLowerCase();
      if (!email) {
        setFeedback('まずメールアドレスを入力してください。', 'error');
        emailEl.focus();
        return;
      }

    toggleBusy(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${location.origin}/reset-password.html`,
      });

      if (error) {
         setFeedback(mapAuthError(error, { forReset: true }), 'error');
         return;
        }
        setFeedback('パスワード再設定用のメールを送信しました。届かない場合は迷惑メールもご確認ください。（登録のないアドレスには届かない仕様です）',
           'ok'
          );
      } catch (err) {
        setFeedback(`再設定メールの送信に失敗しました：${String(err)}`, 'error');
      } finally {
        toggleBusy(false);
      }
    });
  }
});




