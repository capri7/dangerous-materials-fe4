import { supabase } from '/js/supabaseClient.js';

const LS_KEY = 'free32_progress_v1'; // { index, answers: {id: {choice, correct}} }

// 共有端末モード（sessionStorage）対応
const sharedEl = document.getElementById('shared-mode');
let currentStorage = localStorage;
// 起動時：セッション側にデータがあれば共有モード優先
if (sessionStorage.getItem(LS_KEY) !== null) {
  currentStorage = sessionStorage;
  if (sharedEl) sharedEl.checked = true;
}

function readState(storage) {
  try {
    return JSON.parse(storage.getItem(LS_KEY) || '{"index":0,"answers":{}}');
  } catch (_) {
    // 壊れた値は消してリセット
    try { storage.removeItem(LS_KEY); } catch(e) {}
    return { index: 0, answers: {} };
  }
}
const state = readState(currentStorage);

// 起動パラメータで進捗を初期化（例：/contents/free.html?reset=1）
const qs = new URLSearchParams(location.search);
if (qs.get('reset') === '1') {
  state.index = 0;
  state.answers = {};
  save();
  // URLから reset=1 を消しておく（F5で再リセットされないように）
  history.replaceState(null, '', location.pathname);
}

let questions = [];

const qRoot = document.getElementById('q-root');
const btnPrev = document.getElementById('btn-prev');
const btnNext = document.getElementById('btn-next');
const btnShow = document.getElementById('btn-show');
const btnConfirm = document.getElementById('btn-confirm'); 

function isEarned(q) {
  return state.answers?.[q.id]?.earned === true;
}

function updateNavState(){
  const q = questions[state.index];
  const a = q ? (state.answers?.[q.id] || {}) : {};
  const canNext = !!(a.earned === true || a.peeked === true); 
  btnNext.disabled = !canNext;
  btnPrev.disabled = (state.index <= 0);
}

function findNextUnsolved(start = state.index + 1) {
  const cur = state.index;

    // 第1候補: earned!==true && peeked!==true（まだ何も見ていない未獲得）
  for (let i = Math.max(0, start); i < questions.length; i++) {
    if (i === cur) continue;
    const a = state.answers?.[questions[i].id] || {};
    if (a.earned !== true && a.peeked !== true) return i;
  }
  for (let i = 0; i < Math.min(start, questions.length); i++) {
    if (i === cur) continue;
    const a = state.answers?.[questions[i].id] || {};
    if (a.earned !== true && a.peeked !== true) return i;
  }

  // 第2候補: earned!==true（既に解説を見たが未獲得）
  for (let i = Math.max(0, start); i < questions.length; i++) {
    if (i === cur) continue;
    const a = state.answers?.[questions[i].id] || {};
    if (a.earned !== true) return i;
  }
  for (let i = 0; i < Math.min(start, questions.length); i++) {
    if (i === cur) continue;
    const a = state.answers?.[questions[i].id] || {};
    if (a.earned !== true) return i;
  }

  return -1; // 全て earned 済み
}

async function load() {
  // 1) JSONをロード（開発中はキャッシュ回避）
  const res = await fetch(`/data/free/free-32.json?v=${Date.now()}`, { cache: 'no-store' });
  questions = await res.json();

  if (state.index < 0 || state.index >= questions.length) state.index = 0;

  render();
}

function saveSafe(key, obj, currentStorage) {
  const v = JSON.stringify(obj);
  try {
    currentStorage.setItem(key, v);
    return true;
  } catch (e) {
    console.warn('primary storage save failed, fallback to sessionStorage', e);
    try { sessionStorage.setItem(key, v); } catch (_) {}
    return false;
  }
}


function save() {
  const ok = saveSafe(LS_KEY, state, currentStorage);
  if (!ok) currentStorage = sessionStorage; // ← 失敗後は以降セッション側を使う
}


// 共有ON/OFFで localStorage ↔ sessionStorage を移行
if (sharedEl) {
  sharedEl.addEventListener('change', (e) => {
    const toSession = e.target.checked;
    const src = toSession ? localStorage : sessionStorage;
    const dst = toSession ? sessionStorage : localStorage;

    // 既存データを該当側へ移す（なければ現在のstateを書き出す）
    const v = src.getItem(LS_KEY);
    if (v !== null) {
      dst.setItem(LS_KEY, v);
      src.removeItem(LS_KEY);
    } else if (dst.getItem(LS_KEY) === null) {
      dst.setItem(LS_KEY, JSON.stringify(state));
    }

    currentStorage = dst;
  });
}

function render() {
  const q = questions[state.index];
  if (!q) return;
  const done = state.answers[q.id];
  const answerNum = Number(q.answer) || 1; // ← 1始まりを数値化
  const expFromArray =
    Array.isArray(q.explanations)
      ? q.explanations[Math.max(0, Math.min(answerNum - 1, (q.choices?.length ?? 1) - 1))]
      : undefined;
  const expl = q.explanation ?? expFromArray ?? '';
  const answerText = (q.choices && q.choices[answerNum - 1]) ? q.choices[answerNum - 1] : '';

  const current = state.index + 1;
  const total = questions.length;
  // ★ 正解した数で進捗を出す
  const solvedCount = questions.reduce((n, qq) => {
  const a = state.answers?.[qq.id];
  return n + (a?.earned === true ? 1 : 0);   // ← 初回「確認する」で正解したものだけ計上
}, 0);
  const progressPct = Math.round((solvedCount / Math.max(1, total)) * 100);

  qRoot.innerHTML = `
    <div class="question">
      <div class="q-head">
        <div class="q-counter" aria-label="進捗">
          <span class="pill">Q${current}</span>
          <span class="solved">正解 ${solvedCount}/${total}</span>
        </div>
        <div class="q-title">${q.title}</div>
        <div class="q-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progressPct}">
        <div class="bar" style="width:${progressPct}%"></div>
        </div>
        </div> <!-- /.q-head -->
         ${q.question ? `<div class="q-question">${q.question}</div>` : ''}
         <ul class="choices">
            ${q.choices.map((c, i) => {
              const idx = i + 1;

            // 解説を一度見ていて、まだ獲得していない＆解説非表示なら
            // ラジオは未選択で出す（過去に正解choiceが残っていても非表示）
            const suppressCheck = done && done.peeked && !done.earned && !done.revealed;
            const checkedAttr   = (!suppressCheck && done && done.choice === idx) ? 'checked' : '';

            const isCorrect = done?.revealed && idx === answerNum;
            return `
             <li class="${isCorrect ? 'is-correct' : ''}">
               <label class="choice">
                 <input type="radio" name="choice" value="${idx}"
                   ${(done && done.choice===idx && !(done.peeked && !done.earned)) ? 'checked' : ''}>
                 <span class="num">${idx}.</span>
                 <span class="text">${c}</span>
                </label>
             </li>`;
           }).join('')}
         </ul>
        ${q.hint ? `<div class="hint" ${done?.revealed ? 'hidden' : ''}>${q.hint}</div>` : ''}
        <div class="answer-line" ${done?.revealed ? '' : 'hidden'}>
         正解：<strong class="ans-num">${answerNum}</strong>. <span class="ans-text">${answerText}</span>
        </div>
        <div class="explain" ${done?.revealed ? '' : 'hidden'}>${expl}</div>
     </div>`; 

qRoot.querySelectorAll('input[name="choice"]').forEach(r => {
  r.addEventListener('change', e => {
    const choice = Number(e.target.value);
    // const correct = (choice === answerNum); // ← 確認するで判定するので不要
    const prev = state.answers[q.id] || {};
    state.answers[q.id] = { ...prev, choice, revealed: false }; // 既存フラグは保持
    save();
  });
});

  // ←← この直後に追記（完了CTA）
  if (solvedCount === total && total > 0) {
    qRoot.insertAdjacentHTML('beforeend', `
      <section class="complete-card">
        <h3>無料${total}問 完了！</h3>
        <p>無料登録でマイページに同期できます。他の端末でも続きから再開できます。</p>
        <div class="cta-row">
          <a class="btn-cta primary" href="/signup.html">無料登録して同期する</a>
          <a class="btn-cta" href="/checkout.html">有料版で本番演習へ</a>
        </div>
      </section>
    `);
  }
  updateNavState(); 
}

btnShow.addEventListener('click', () => {
  const q = questions[state.index]; if (!q) return;
  const answerNum = Number(q.answer) || 1;

  const prev = state.answers[q.id] || {};
  // const correct = (choice === answerNum);     // ここでは判定しない

  state.answers[q.id] = { ...prev, revealed: true, peeked: true };
  save();
  render();
});

btnPrev.addEventListener('click', ()=>{ 
  state.index = Math.max(0, state.index-1);
  const nq = questions[state.index]; const na = state.answers?.[nq.id] || {};
  if (na.peeked && !na.earned) state.answers[nq.id] = { ...na, revealed: false };
  save(); render();
});


btnConfirm?.addEventListener('click', () => {
  const q = questions[state.index]; if (!q) return;
  const answerNum = Number(q.answer) || 1;

  // 選択チェック
  const picked = qRoot.querySelector('input[name="choice"]:checked');
  if (!picked) { alert('選択肢を選んでから「確認する」を押してください。'); return; }

  const choice = Number(picked.value);
  const ok = (choice === answerNum);

  // 進捗を更新（初回正解のみ earned を立てる／peekedなら獲得しない）
  const prev = state.answers[q.id] || {};
  const attempts = (prev.attempts || 0) + 1;
  const next = { ...prev, choice, attempts };
  if (ok && !prev.earned) {
   next.earned = true;                 // 最終的に正解できたら獲得
   if (prev.peeked) next.afterPeek = true;  // 任意：解説後クリアの印
   else             next.firstTry  = true;  // 任意：初回正解の印
}
  state.answers[q.id] = next;
  save();
  render();

  // 判定UI（カード内に短い結果表示）
  const qBox = qRoot.querySelector('.question');
  let judge = qBox.querySelector('.judge');

  if (!judge) {
    judge = document.createElement('div');
    judge.className = 'judge';

    qBox.appendChild(judge);

  }
  judge.innerHTML = ok
    ? `<p class="ok">正解です。</p>`
    : `<p class="ng">まだ正解に届いていません。</p>
       <div class="retry-row"><button id="btn-retry-q" class="btn-ghost">もう一度チャレンジ</button></div>`;

  // 正解なら誤操作防止に選択肢をロック（任意）
  qRoot.querySelectorAll('input[name="choice"]').forEach(r => r.disabled = ok);

  // 進捗・ナビ状態を反映
  updateNavState();            // （render内でも呼ばれるが二重呼びでも問題なし）
});

document.addEventListener('click', (e) => {
  if (e.target.id !== 'btn-retry-q') return;
  const q = questions[state.index]; if (!q) return;

  const prev = state.answers[q.id] || {};
  const next = { ...prev };
  delete next.choice;         // 選択だけ初期化
  next.revealed = false;      // 解説・正解表示を閉じる

  state.answers[q.id] = next;
  save();
  render();                   // カードを初期状態に戻す
  updateNavState();           // 「次へ」を無効に戻す
});


btnNext.addEventListener('click', ()=>{
  const q = questions[state.index]; if (!q) return;
  const a = state.answers?.[q.id] || {};
  if (!(a.earned === true || a.peeked === true)) return;

  const j = findNextUnsolved(state.index + 1);
  if (j >= 0) {
    state.index = j;
  } else {
    state.index = Math.min(questions.length-1, state.index+1);
  }
  
  // 到達先が「peeked 済み・未earned」なら解説は閉じた状態で表示
  const nq = questions[state.index]; const na = state.answers?.[nq.id] || {};
  if (na.peeked && !na.earned) state.answers[nq.id] = { ...na, revealed: false };
  save(); render();
});

load();
