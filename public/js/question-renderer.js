// js/question-renderer.js
(async () => {
  try {
    // 1) JSONファイル名の組み立て
    const path = window.location.pathname.split('/');
    const filename = path.pop() || path.pop();   // deep link 対応
    const id = filename.replace(/\.html$/, '');

    // 2) データ取得
    const res = await fetch(`./questions/${id}.json`);
    const data = await res.json();
    data.answer = Number(data.answer);

    // 3) 要素取得
    const titleEl = document.getElementById("title");
    const questionEl = document.getElementById("question");
    const choicesList = document.getElementById("choices");
    const feedbackEl = document.getElementById("feedback");
    const hintBtn = document.getElementById("showHintBtn");
    const hintEl = document.getElementById("hint");
    const explBtn = document.getElementById("showExplanationBtn");
    const explEl = document.getElementById("explanation");

    // ── A11y: ボタンにスクリーンリーダー用ラベルを追加
    hintBtn.setAttribute("aria-label", "ヒントを表示");
    explBtn.setAttribute("aria-label", "解説を表示");

    // “次へ” / “分野を変える” ボタン取得
    const nextBtn   = document.getElementById("btn-next");
    const changeBtn = document.getElementById("btn-change");

    nextBtn.setAttribute("aria-label", "次の問題へ進む");
    changeBtn.setAttribute("aria-label", "分野選択に戻る");

    // 初期描画
    titleEl.textContent    = data.title || "";
    questionEl.textContent = data.question;
    choicesList.innerHTML  = "";

    let answered = false;
    let hintShown = false;
    let selectedChoice = null;

    function formatChoiceText(i, choice, mode = "default") {
      if (typeof choice === "string") {
      return `${i + 1}. ${choice}`;
    }
      if (mode === "short") {
      return `${choice.name || choice.property || ""}`;
    }
      return `${i + 1}. ${choice.property}`;
    }

    function formatFeedback(choice, raw) {
      return raw.replace("{property}", getChoiceProp(choice));
    }

    function getChoiceProp(choice, key = "property") {
      return typeof choice === "object" ? choice[key] : choice;
    }

    function getFeedbackMessage(i, data) {
      const choice = data.choices[i]; 
      const isCorrect = i + 1 === data.answer;
      if (!choice) {
        return { msg: "⚠️ システムエラー：選択肢が見つかりません。", shouldShowHint: false };
      }
      const isNegation = data.feedback_mode === "negation";

      const feedbackText = {
        correct_but_negation: "✅ この記述は誤っています。よって正解です。",
        incorrect_but_negation: "ℹ️ この記述は正しいです。本問は「誤った記述」を選ぶ問題のため、正しい文を含む選択肢は不正解になります。",
        correct: "✅ 正解です！",
        incorrect: formatFeedback(choice, data.wrong_feedback || "❌ 不正解です。"),
      };

      if (isCorrect && isNegation)
        return { msg: feedbackText.correct_but_negation, shouldShowHint: true };
      if (!isCorrect && isNegation)
        return { msg: feedbackText.incorrect_but_negation, shouldShowHint: true };
      if (isCorrect)
        return { msg: feedbackText.correct, shouldShowHint: false };
      return { msg: feedbackText.incorrect, shouldShowHint: true };
    }

    // ← ここから追加
    let hasOpenedExplanation = false;

    // 5) 選択肢描画：オブジェクト配列なら <table> で出す
    if (Array.isArray(data.choices) && typeof data.choices[0] === "object") {
      const table = document.createElement("table");
      table.className = "choices-table";

      const rawFields = data.fields;
      const rawHeaders = data.headers;

      // fields と headerLabels を計算しておく
      const fields       = Array.isArray(rawFields)  && rawFields.length  > 0 ? rawFields  : null;
      const headerLabels = Array.isArray(rawHeaders) && rawHeaders.length > 0 ? rawHeaders : null;

      // ヘッダー
      if (fields && headerLabels) {
        const thead = table.createTHead();
        const hr = thead.insertRow();
        ["No.", ...headerLabels].forEach(h => {
          const th = document.createElement("th");
          th.textContent = h;
          hr.appendChild(th);
        });
      }
      data.choices.forEach((choice, i) => {
       const row = table.insertRow();
       row.dataset.index = i;
       
       // ── A11y: 行をボタン扱いに
       row.setAttribute("role", "button");
       row.tabIndex = 0;  // フォーカス可能に

       // No
       const noCell = row.insertCell();
       noCell.textContent = `${i+1}`;
       // 本文
       if (fields) {
         fields.forEach(f => row.insertCell().textContent = choice[f]);
       } else {
         const key = Object.keys(choice).find(k => k!=="name") || "name";
         row.insertCell().textContent = choice[key];
        }

        // クリックと同じ動作をキーボードでも
        row.addEventListener("keydown", e => {
          if (answered) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            row.click();
          }
        });

        // クリック
        row.addEventListener("click", () => {
          if (hasOpenedExplanation) return; 
         table.querySelectorAll("tr").forEach(r => r.classList.remove("selected"));
         row.classList.add("selected");

         selectedChoice = i;

         // 回答表示
         const yourAnswer = document.querySelector(".your-answer")
          ?? (() => {
             const d = document.createElement("div");
             d.className = "your-answer";
             choicesList.after(d);
             return d;
           })();
         yourAnswer.textContent = `あなたの解答：${formatChoiceText(i, choice)}`;
         // フィードバック
         const { msg, shouldShowHint } = getFeedbackMessage(i, data);
         feedbackEl.textContent = msg;
         if (shouldShowHint) hintBtn.classList.remove("hidden");
         if (msg === "✅ 正解です！") explBtn.classList.remove("hidden");
       });
     });

     // ◆ forEach の外で一度だけテーブルを差し替える
     choicesList.innerHTML = "";
     choicesList.appendChild(table);

    } else {
      // ── 文字列 or プリミティブ配列向け <li> 描画 ──
      const markup = data.choices
        .map((choice, i) => {
        const isObj = typeof choice === "object";
        const label = isObj ? (choice.name||`${i+1}`) : `${i+1}`;
        const text  = isObj ? choice.property : choice;
        return `<li class="choice-item" data-index="${i}">${label}. ${text}</li>`;
        })
        .join("");
        choicesList.innerHTML = markup;

        // クリックを choicesList に集約（元のまま）
        choicesList.addEventListener("click", e => {
         if (answered) return;
         const li = e.target.closest(".choice-item");
         if (!li) return;
         const i = Number(li.dataset.index);
         choicesList.querySelectorAll(".choice-item").forEach(el => el.classList.remove("selected"));
         li.classList.add("selected");
         let yourAnswer = document.querySelector(".your-answer");
         if (!yourAnswer) {
           yourAnswer = document.createElement("div");
           yourAnswer.className = "your-answer";
           choicesList.after(yourAnswer);
        }
         const choice = data.choices[i];
         yourAnswer.textContent = `あなたの解答：${formatChoiceText(i,choice)}`;
         if (i+1 === data.answer) {
           feedbackEl.textContent = "✅ 正解です！";
           explBtn.classList.remove("hidden");
           answered = true;
        } else {
          const choice = data.choices[i];
          feedbackEl.textContent = msg.msg;
          if (!hintShown) hintBtn.classList.remove("hidden");
        }
      });
    }

    // 6) ヒントを見るボタンはそのまま
    hintBtn.addEventListener("click", () => {
      hintEl.textContent = "🧠 " + data.hint;
      hintEl.classList.remove("hidden");
      hintBtn.classList.add("hidden");
      explBtn.classList.remove("hidden");
      hintShown = true;
    });

    // “分野を変える” は常にマイコンテンツのセクショントップへ戻る
    changeBtn.addEventListener("click", () => {
      const folder = window.location.pathname
        .split("/")
        .slice(0, -1)   // 最後のファイル名を除く
        .join("/");
      window.location.href = folder + "/";
    });

    // 7) “解説を見る” と “次へ” を一度にハンドルする
    explBtn.addEventListener("click", () => {
      // ─────────── 既存の解説展開ロジック ───────────
     explEl.innerHTML = `📘 解答：${data.answer}<br><br>`;
     data.choices.forEach((choice, i) => {
      const mark = (i+1===data.answer) ? "✅ 正解" : "❌ 不正解";
      // 品名は choice.name を使う
      explEl.innerHTML += `${formatChoiceText(i,choice)}：${mark}<br>${data.explanations[i]}<br><br>`;
     });
     explEl.classList.remove("hidden");

     hasOpenedExplanation = true;
    });

    // ─────────── toastユーティリティ ───────────
    function showToast(msg, duration = 3000) {
      const t = document.createElement("div");
      t.className = "toast";
      t.textContent = msg;
      document.body.appendChild(t);
      setTimeout(() => t.remove(), duration);
    }

  // “次へ” は常に有効 ...
  nextBtn.addEventListener("click", () => {
    const curr = parseInt(id.split("_").pop(), 10);
    const next = String(curr + 1).padStart(3, "0");

    // ← ここも地味に修正：.html を二重に付けない
    const nextId = id.replace(curr.toString().padStart(3, "0"), next);
    window.location.href = `${nextId}.html`;
  });

} catch (err) {
  console.error('[question-renderer]', err);
}
})(); // ← これで IIFE を閉じる

