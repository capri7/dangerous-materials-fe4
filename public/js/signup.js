// /js/signup.js
import { supabase } from "./supabaseClient.js";

/**
 * 画面メッセージのユーティリティ
 */
function setFeedback(msg, type = "ok") {
  const box = document.getElementById("signup-feedback");
  box.textContent = msg;
  box.classList.remove("ok", "error");
  box.classList.add(type);
}

function toggleBusy(busy) {
  const btn = document.getElementById("signup-submit");
  const form = document.getElementById("signup-form");
  btn.disabled = busy;
  form.setAttribute("aria-busy", busy ? "true" : "false");
}

/**
 * 「このメールは既に登録済みです」ブロックの表示/非表示
 */
function showAlreadyExists(show) {
  const panel = document.getElementById("already-exists");
  panel.hidden = !show;
  if (show) document.getElementById("send-reset")?.focus();
}


document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("signup-form");
  const emailInput = document.getElementById("email");
  const passwordInput = document.getElementById("password");
  const sendResetBtn = document.getElementById("send-reset");

  // サインアップ送信
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    showAlreadyExists(false);
    setFeedback("", "ok");

    const email = emailInput.value.trim();
    const password = passwordInput.value;

    // 最低限のバリデーション
    if (!email) {
      setFeedback("メールアドレスを入力してください。", "error");
      emailInput.focus();
      return;
    }
    if (password.length < 6) {
      setFeedback("パスワードは6文字以上で入力してください。", "error");
      passwordInput.focus();
      return;
    }

    toggleBusy(true);
    try {
      // ここでのリダイレクト先は Supabase Auth 許可ドメインに登録しておくこと
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          // 確認メールのリンク遷移先（あとで変更可）
          emailRedirectTo: `${location.origin}/login.html`},
      });

      // ① 既存ユーザーの“黙り成功”パターンを先に判定
      const identities = data?.user?.identities ?? null;
      if (!error && identities && identities.length === 0) {
        setFeedback("このメールアドレスはすでに登録されています。", "error");
        showAlreadyExists(true);
        return;
      }

      if (error) {
        // 既存ユーザー判定（Supabase/GoTrueの代表的メッセージを網羅気味に）
        const msg = (error.message || "").toLowerCase();
        const code = (error.code || "").toLowerCase();
        const looksLikeAlready =
          code === "user_already_exists" ||
          msg.includes("already registered") ||
          msg.includes("already exists") ||
          msg.includes("user exists");
        const looksLikeRateLimit =
          msg.includes("rate limit") || code === "over_email_send_rate_limit";

        if (looksLikeAlready) {
          setFeedback("このメールアドレスはすでに登録されています。", "error");
          showAlreadyExists(true);
          return;
        }
        if (looksLikeRateLimit) {
          setFeedback(
            "メール送信が混み合っています。しばらくしてから再度お試しください。",
            "error"
          );
          return;
        }

        // その他のエラー
        setFeedback(`登録に失敗しました：${error.message}`, "error");
        return;
      }

      // 成功（確認メール送信）
      passwordInput.value = "";
      setFeedback(
        "確認メールを送信しました。メール内のリンクから手続きを完了してください。",
        "ok"
      );
    } catch (err) {
      setFeedback(`登録に失敗しました：${String(err)}`, "error");
    } finally {
      toggleBusy(false);
    }
  });

  // 「パスワード再設定メールを送る」
  sendResetBtn.addEventListener("click", async () => {
    const email = emailInput.value.trim();
    if (!email) {
      setFeedback("メールアドレスを入力してください。", "error");
      emailInput.focus();
      return;
    }

 toggleBusy(true);
  try {
    // 回復リンク受信後に新パスワードを設定するページへ
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${location.origin}/reset-password.html`,
    });

    if (error) {
      // 「For security purposes, you can only request this after 47 seconds」
      // などを日本語に置換（英語は出さない）
      const raw  = error.message || "";
      const code = (error.code || "").toLowerCase();
      const m = raw.match(/(?:after|once every)\s+(\d+)\s*seconds?/i);

      if (code === "over_email_send_rate_limit" || m) {
        setFeedback(`セキュリティ保護のため、あと ${m ? m[1] : 60} 秒後にもう一度お試しください。`, "error");
      } else {
        setFeedback("再設定メールの送信に失敗しました。時間をおいてもう一度お試しください。", "error");
      }
      return;
    }

    // 成功
    setFeedback(
      "パスワード再設定用のメールを送信しました。受信メールのリンクから続行してください。",
      "ok"
    );
    } catch (err) {
      setFeedback("再設定メールの送信に失敗しました。時間をおいてもう一度お試しください。", "error");
    } finally {
      toggleBusy(false);
    }
  });
});




