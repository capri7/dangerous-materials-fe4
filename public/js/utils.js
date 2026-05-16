// utils.js
import { supabase } from './supabaseClient.js';

/* ------------ 表示・判定ユーティリティ ------------ */

function formatFeedback(choice, raw) {
  return raw.replace('{property}', getChoiceProp(choice));
}

function getChoiceProp(choice, key = 'property') {
  return typeof choice === 'object' ? choice[key] : choice;
}

export function formatChoiceText(i, choice, mode = 'default') {
  if (typeof choice === 'string') return `${i + 1}. ${choice}`;
  if (mode === 'short') return `${choice.name || choice.property || ''}`;
  return `${i + 1}. ${choice.property}`;
}

export function getFeedbackMessage(i, data) {
  const isCorrect  = i + 1 === data.answer;
  const isNegation = data.feedback_mode === 'negation';

  const contentIsCorrect  = isNegation ? !isCorrect : isCorrect;
  const questionIsCorrect = isCorrect;

  const feedbackText = {
    correct:                '✅ 正解です！',
    incorrect:              '❌ 不正解です。',
    correct_but_negation:   '✅ 正解！この問題の答えとして正しい選択です。',
    incorrect_but_negation: 'ℹ️ 不正解！この問題の答えとして誤った選択です。',
  };

  let msg, shouldShowHint;
  if (isCorrect && isNegation)          { msg = feedbackText.correct_but_negation;   shouldShowHint = true;  }
  else if (!isCorrect && isNegation)    { msg = feedbackText.incorrect_but_negation; shouldShowHint = true;  }
  else if (isCorrect)                   { msg = feedbackText.correct;                 shouldShowHint = false; }
  else                                  { msg = feedbackText.incorrect;               shouldShowHint = true;  }

  return { msg, shouldShowHint, contentIsCorrect, questionIsCorrect };
}

/* ------------ トースト（位置固定 + 追従） ------------ */

const clamp = (v, min, max) => Math.min(Math.max(v, min), max);
const isInViewport = (r, pad = 4) =>
  r.bottom > pad && r.top < window.innerHeight - pad &&
  r.right  > pad && r.left < window.innerWidth  - pad;

function positionToastDesktop(container) {
  const anchor = document.getElementById('your-answer') || document.querySelector('.answer-wrapper');

  container.style.setProperty('writing-mode', 'horizontal-tb', 'important');
  container.style.setProperty('text-orientation', 'mixed', 'important');
  container.style.setProperty('white-space', 'normal', 'important');
  container.style.setProperty('direction', 'ltr', 'important');
  container.style.display = 'flex';
  container.style.flexDirection = 'column';
  container.style.gap = '8px';

  const margin = 12;

  if (anchor) {
    const r = anchor.getBoundingClientRect();
    if (!isInViewport(r)) {
      container.style.position = 'fixed';
      container.style.top = '16px';
      container.style.right = '16px';
      container.style.left = 'auto';
      container.style.bottom = 'auto';
      container.style.transform = 'none';
      container.style.zIndex = '9999';
      return;
    }
    container.style.position = 'fixed';
    const top = r.top + r.height / 2;
    const left = r.right + margin;
    const maxLeft = window.innerWidth - 16;
    container.style.top = `${clamp(top, 16, window.innerHeight - 16)}px`;
    container.style.left = `${clamp(left, 16, maxLeft)}px`;
    container.style.right = 'auto';
    container.style.bottom = 'auto';
    container.style.transform = 'translateY(-50%)';
    container.style.zIndex = '9999';
  } else {
    container.style.position = 'fixed';
    container.style.top = '16px';
    container.style.right = '16px';
    container.style.left = 'auto';
    container.style.bottom = 'auto';
    container.style.transform = 'none';
    container.style.zIndex = '9999';
  }
}

function getToastContainerAnchored() {
  let c = document.getElementById('toast-container');
  if (!c) {
    c = document.createElement('div');
    c.id = 'toast-container';
    c.setAttribute('aria-live', 'polite');
    c.setAttribute('aria-atomic', 'true');
    document.body.appendChild(c);
  }
  c.style.setProperty('writing-mode', 'horizontal-tb', 'important');
  c.style.setProperty('text-orientation', 'mixed', 'important');
  c.style.setProperty('white-space', 'normal', 'important');
  c.style.setProperty('direction', 'ltr', 'important');
  return c;
}

export function showToast(message, type = 'info') {
  const c = getToastContainerAnchored();
  const isDesktop = window.matchMedia('(min-width: 769px)').matches;

  if (isDesktop) {
    positionToastDesktop(c);
    if (c._raf) cancelAnimationFrame(c._raf);
    const follow = () => { positionToastDesktop(c); c._raf = requestAnimationFrame(follow); };
    c._raf = requestAnimationFrame(follow);
  }

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.setAttribute('role', 'status');
  toast.textContent = message;
  toast.style.display = 'inline-flex';
  toast.style.alignItems = 'center';
  toast.style.minWidth = '240px';
  toast.style.maxWidth = '420px';

  c.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));

  setTimeout(() => {
    toast.classList.remove('show');
    toast.addEventListener('transitionend', () => {
      toast.remove();
      if (!c.querySelector('.toast.show')) {
        if (c._raf) cancelAnimationFrame(c._raf);
        c._raf = null;
      }
    }, { once: true });
  }, 3000);
}

/* ------------ recordProgress（保存＋モード同期） ------------ */

/** URL から practice のパラメータを取得 */
function readPracticeParamsFromURL() {
  try {
    const p = new URLSearchParams(location.search);
    const mode  = (p.get('mode') === 'all') ? 'all' : 'free';
    const scope = (p.get('scope') || '').trim(); // '', 'cat', 'sub', 'free'
    const sid   = p.get('sid') || null;
    const cid   = p.get('cid') || null;
    return { mode, scope, sid, cid };
  } catch {
    return { mode: 'free', scope: '', sid: null, cid: null };
  }
}

/** scope/mode を両ストレージに同期（旧キー互換） */
function syncPracticeToStorage({ mode, scope, sid, cid }) {
  try {
    const scopePayload = JSON.stringify({ scope, sid, cid });
    for (const k of ['practice_scope_v1', 'practice_scope']) {
      if (scope) {
        sessionStorage.setItem(k, scopePayload);
        localStorage.setItem(k, scopePayload);
      } else {
        sessionStorage.removeItem(k);
        localStorage.removeItem(k);
      }
    }
    // mode も保存（読み元がどちらを見るか不明なため両方）
    for (const k of ['practice_mode']) {
      sessionStorage.setItem(k, mode || 'free');
      localStorage.setItem(k, mode || 'free');
    }
  } catch {}
}

/**
 * 進捗を user_progress に記録 + mode/scope を保存
 * @param {{questionId?: string, isCorrect: boolean, mode?: 'all'|'free', scope?: ''|'cat'|'sub'|'free', sid?: string|null, cid?: string|null}} opts
 * @returns {Promise<{ok: boolean, reason?: string, error?: any}>}
 */
export async function recordProgress(opts = {}) {
  let {
    questionId,
    isCorrect,
    mode,
    scope,
    sid = null,
    cid = null,
  } = opts;

  // 1) URL でデフォルト補完
  const fromURL = readPracticeParamsFromURL();
  if (!mode)  mode  = fromURL.mode;
  if (scope === undefined) scope = fromURL.scope;
  if (!sid)   sid   = fromURL.sid;
  if (!cid)   cid   = fromURL.cid;

  // 2) 保存（互換キーへ）
  syncPracticeToStorage({ mode, scope, sid, cid });

  // 3) DB upsert
  try {
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) return { ok: false, reason: 'no_user' };

    const qid = String(questionId || document.body.dataset.questionId || '');
    if (!qid) return { ok: false, reason: 'no_question_id' };

    const payload = {
      user_id: user.id,
      question_id: qid,
      is_correct: !!isCorrect,
      answered_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from('user_progress')
      .upsert(payload, { onConflict: 'user_id,question_id', returning: 'minimal' });

    if (error) return { ok: false, reason: 'upsert_error', error };

    // フロント側へ通知（必要なら学習状況UIがこれをlisten）
    try {
      window.dispatchEvent(new CustomEvent('practice:progress-recorded', {
        detail: { questionId: qid, isCorrect: !!isCorrect, mode, scope, sid, cid },
      }));
    } catch {}

    return { ok: true };
  } catch (e) {
    console.error('[recordProgress] unexpected error', e);
    return { ok: false, reason: 'exception', error: e };
  }
}

/* ------------ デバッグ補助（必要なら） ------------ */
export function dumpPracticeKeys() {
  const pm  = sessionStorage.getItem('practice_mode')  || localStorage.getItem('practice_mode');
  const ps1 = sessionStorage.getItem('practice_scope_v1') || localStorage.getItem('practice_scope_v1');
  const ps  = sessionStorage.getItem('practice_scope')    || localStorage.getItem('practice_scope');
  console.info('[practice_mode]', pm);
  console.info('[practice_scope_v1]', ps1);
  console.info('[practice_scope]', ps);
  return { practice_mode: pm, practice_scope_v1: ps1, practice_scope: ps };
}
