// js/eventHandlers.js
import { getFeedbackMessage, formatChoiceText, showToast } from '/js/utils.js?v=toast-anchors-3';
console.log('[EVH] eventHandlers.js loaded');
export function attachEventHandlers(table, data, {
  hintBtn, hintEl,
  explBtn, explEl,
  feedbackEl,
  onJudged,
  goNext,
 }) {
  // ─── 前回のヒント／解説を隠す ───
  function resetHintAndExplanation() {
    hintBtn?.classList.add('hidden');
    explBtn?.classList.add('hidden');
    hintEl?.classList.add('hidden');
    explEl?.classList.add('hidden');
    feedbackEl && (feedbackEl.textContent = '');
  }

  const yourAnswerEl = document.getElementById('your-answer');
  let hasOpenedExplanation = false;
  let answered = false; 
  let inFlight = false; 

  // ─── テーブル行を取得してクリック処理を登録 ───
  const rows = Array.from(table.querySelectorAll('tr[data-index]'));

  rows.forEach((row, i) => {
    // 各行にフォーカス可能に
    row.setAttribute('tabindex', 0);

    // クリック or Enter/Space で呼ばれる関数
    const onSelect = async () => {
      if (hasOpenedExplanation || answered || inFlight) return; // ★通信中や正解後はブロック
      inFlight = true;

      resetHintAndExplanation();

    // data-index（0始まり）を優先し、無ければ forEach の i を使用
    const idxAttr = row.dataset.index;
    const choiceIndex = Number.isFinite(Number(idxAttr)) ? Number(idxAttr) : i;

    const { msg, shouldShowHint, questionIsCorrect } = getFeedbackMessage(choiceIndex, data);
    // 保存は onJudged に一本化（ここでは await してから遷移）
    try {
      if (onJudged) await onJudged(!!questionIsCorrect);
    } catch (e) {
      console.error('[onJudged] failed', e);
      // 記録が失敗したら早期リターン（遷移しない）
      inFlight = false;
      return;
    }

    // 先にUIを反映（選択ハイライト・あなたの解答）
    rows.forEach(r => r.classList.remove('selected'));
    row.classList.add('selected');

    if (yourAnswerEl) {
      yourAnswerEl.textContent = `あなたの解答：${formatChoiceText(choiceIndex, data.choices[choiceIndex], 'short')}`;
    }

    // トースト（1回だけ）
    showToast(msg, questionIsCorrect ? 'success' : 'error');

    // インラインフィードバック（要素がある場合のみ）
    if (feedbackEl) {
        feedbackEl.innerHTML = `
      <p>${
        questionIsCorrect
          ? 'すばらしい！ よく出来ました。👏'
          : '残念...不正解だ。😅'
      }</p>
    `;
    }

    // ボタン表示
    explBtn?.classList.remove('hidden');
    if (shouldShowHint) hintBtn?.classList.remove('hidden');


    // 自動遷移はしない。正解時は「次の問題へ」ボタンにフォーカスだけ当てる（任意）
    if (questionIsCorrect) {
      const nextBtn = document.getElementById('btn-next');
      if (nextBtn && !nextBtn.disabled) nextBtn.focus();
    }

    inFlight = false;
    answered = !!questionIsCorrect;
   }; 
   
    // イベント登録
    row.addEventListener('click', onSelect);
    row.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onSelect();
      }
    });
  });

 // ─── ヒントボタン ───
  hintBtn?.addEventListener('click', () => {
    if (!hintEl || !hintBtn) return;
    hintEl.innerHTML = `🧠 ${data.hint ?? ''}`;
    hintEl.classList.remove('hidden');
    hintBtn.classList.add('hidden');
  });

  // ─── 解説ボタン ───
  explBtn?.addEventListener('click', () => {
    if (!explEl || !explBtn) return;
    const expl = Array.isArray(data.explanation) ? data.explanation : [];
    const choices = Array.isArray(data.choices) ? data.choices : [];

    if (expl.length !== choices.length) {
      console.warn('解説配列が不正', { expl, choices: data.choices });
      explEl.classList.remove('hidden');
      explEl.innerHTML = '⚠️ 解説データの形式が不正です。管理者に連絡してください。';
      return;
    }

    // 正解の本文を表示（番号だけでなくテキストも）
    const answerIdx0 = Number(data.answer) - 1; // answer は 1始まり
    const answerText = choices[answerIdx0];
    explEl.innerHTML = `✅ 正解：${formatChoiceText(answerIdx0, answerText, 'short')}<br><br>`;

    // 各選択肢の解説
    data.choices.forEach((choice, idx) => {
      const isAnswer = idx + 1 === data.answer;                 // 1始まり
      const isNegation = data.feedback_mode === 'negation';

      // ✅ は常に付ける。❌ は通常モードのみ。
      const mark = isAnswer ? '✅ 正解' : (isNegation ? '' : '❌ 不正解');
      const suffix = mark ? ` ${mark}` : '';

      explEl.innerHTML += `
        ${idx + 1}.${suffix}<br>
        ${expl[idx] ?? ''}<br><br>
      `;
    });

    // 各選択肢の解説の後に、組合せ問題のA〜D個別解説を表示
    const stmtExpl = data.statement_explanations;
    if (stmtExpl && typeof stmtExpl === 'object') {
      explEl.innerHTML += `<hr style="margin:1em 0">`;
      explEl.innerHTML += `<strong>各文の解説</strong><br><br>`;
      for (const [key, text] of Object.entries(stmtExpl)) {
        explEl.innerHTML += `【${key}】${text}<br><br>`;
      }
    }

    explEl.classList.remove('hidden');
    hasOpenedExplanation = true;
    explBtn.classList.add('hidden');
    table.classList.add('disabled'); // 追加選択を防止
  });
}


