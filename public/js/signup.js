// /js/signup.js
import { supabase } from "./supabaseClient.js";

/* ---------- UI helpers ---------- */
function setFeedback(msg, type = "ok") {
  const box = document.getElementById("signup-feedback");
  if (!box) return;

  if (!msg) {
    box.classList.remove("ok", "error");
    box.textContent = "";
    return;
  }

  box.textContent = msg;
  box.classList.remove("ok", "error");
  box.classList.add(type);

  box.scrollIntoView({ behavior: "smooth", block: "center" });
  box.setAttribute("tabindex", "-1");
  box.focus({ preventScroll: true });
}

function toggleBusy(busy) {
  const btn = document.getElementById("signup-submit");
  const form = document.getElementById("signup-form");
  if (btn) btn.disabled = !!busy;
  if (form) form.setAttribute("aria-busy", busy ? "true" : "false");
}
function showAlreadyExists(show) {
  const panel = document.getElementById("already-exists");
  if (!panel) return;
  panel.hidden = !show;
  if (show) document.getElementById("send-reset")?.focus();
}
function normalizeEmail(v) {
  return (v || "").trim().toLowerCase();
}
const ABS = (path) => `${location.origin}${path}`;

/* ---------- handlers ---------- */
document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("signup-form");
  const emailInput = document.getElementById("email");
  const passwordInput = document.getElementById("password");
  const sendResetBtn = document.getElementById("send-reset");

  if (!form) return;

  let submitting = false; // 二重送信防止

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (submitting) return;
    submitting = true;

    showAlreadyExists(false);
    setFeedback("", "ok");

    const email = normalizeEmail(emailInput?.value);
    const password = passwordInput?.value || "";

    // 最低限のバリデーション
    if (!email) {
      setFeedback("メールアドレスを入力してください。", "error");
      emailInput?.focus();
      submitting = false; 
      return;
    }
    if (password.length < 6) {
      setFeedback("パスワードは6文字以上で入力してください。", "error");
      passwordInput?.focus();
      submitting = false; 
      return;
    }

    let signupSucceeded = false;

    toggleBusy(true);
    try {
      // ★ 確認メール後の遷移先（Supabase Auth 許可URLに登録済みか確認）
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: ABS("/login.html") }
      });

      // 既存ユーザー判定（確認メール不要ケースで identities が空配列）
      const identities = data?.user?.identities ?? null;
      if (!error && identities && identities.length === 0) {
        setFeedback("このメールアドレスはすでに登録されています。", "error");
        showAlreadyExists(true);
        return;
      }

      if (error) {
        const raw = (error.message || "").toLowerCase();
        const code = (error.code || "").toLowerCase();

        const already =
          code === "user_already_exists" ||
          raw.includes("already registered") ||
          raw.includes("already exists") ||
          raw.includes("user exists") ||
          raw.includes("email address is already registered"); // 422系対策

        const rate =
          code === "over_email_send_rate_limit" || raw.includes("rate limit");

        // ★ SMTP 側エラー（500）もここに落ちることがある
        const smtpFail =
          raw.includes("error sending confirmation email") ||
          raw.includes("smtp");

        if (already) {
          setFeedback("このメールアドレスはすでに登録されています。", "error");
          showAlreadyExists(true);
          return;
        }
        if (rate) {
          setFeedback("メール送信が混み合っています。しばらくしてから再度お試しください。", "error");
          return;
        }
        if (smtpFail) {
          setFeedback("確認メールの送信でエラーが発生しました。数分後に再度お試しください。", "error");
          return;
        }

        setFeedback(`登録に失敗しました：${error.message}`, "error");
        return;
      }

      // 成功（確認メール送信）

      signupSucceeded = true; 
      window.location.href = "/mypage.html";

    } catch (err) {
      setFeedback(`登録に失敗しました：${String(err)}`, "error");

    } finally {
      // まずUIの「送信中」を解除（aria-busyもここで戻る）
      toggleBusy(false);

      if (signupSucceeded) {
        // 成功時は「二重登録」を防ぐため、確実に殺す
        const btn = document.getElementById("signup-submit");
        if (btn) btn.disabled = true;

        form.querySelectorAll("input").forEach(el => el.disabled = true);

      } else {
        // 失敗時は入力欄を戻す
        form.querySelectorAll("input").forEach(el => el.disabled = false);
      }

      submitting = false;
    }

  });

  // 「パスワード再設定メールを送る」
  sendResetBtn?.addEventListener("click", async () => {
    const email = normalizeEmail(emailInput?.value);
    if (!email) {
      setFeedback("メールアドレスを入力してください。", "error");
      emailInput?.focus();
      return;
    }

    toggleBusy(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: ABS("/reset-password.html"),
      });
      if (error) {
        const raw = error.message || "";
        const code = (error.code || "").toLowerCase();
        const m = raw.match(/(?:after|once every)\s+(\d+)\s*seconds?/i);

        if (code === "over_email_send_rate_limit" || m) {
          setFeedback(`セキュリティ保護のため、あと ${m ? m[1] : 60} 秒後にもう一度お試しください。`, "error");
        } else {
          setFeedback("再設定メールの送信に失敗しました。時間をおいてもう一度お試しください。", "error");
        }
        return;
      }
      setFeedback("パスワード再設定用のメールを送信しました。受信メールのリンクから続行してください。", "ok");
    } catch {
      setFeedback("再設定メールの送信に失敗しました。時間をおいてもう一度お試しください。", "error");
    } finally {
      toggleBusy(false);
    }
  });
});







