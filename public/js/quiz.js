document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.quiz').forEach(quizEl => {
    const buttons = quizEl.querySelectorAll('button[data-correct]');
    const feedbackEl = quizEl.querySelector('.quiz-feedback');

    buttons.forEach(button => {
      button.addEventListener('click', () => {
        // すでに回答済みなら無視
        if (quizEl.classList.contains('answered')) return;

        const isCorrect = button.dataset.correct === 'true';

        // ボタンの見た目
        button.classList.add(isCorrect ? 'correct' : 'incorrect');

        // 全ボタンを無効化
        buttons.forEach(btn => btn.disabled = true);

        // フィードバック表示
        const correctMsg = quizEl.dataset.feedbackCorrect || '正解です！';
        const incorrectMsg = quizEl.dataset.feedbackIncorrect || '不正解です。もう一度基礎知識を読み直してみましょう。';
        feedbackEl.textContent = isCorrect ? correctMsg : incorrectMsg;
        feedbackEl.classList.add(isCorrect ? 'correct' : 'incorrect');
        feedbackEl.hidden = false;

        // 回答済みにする
        quizEl.classList.add('answered');
      });
    });
  });
});
