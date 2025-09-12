// /js/progress-reader.js
import { supabase } from '/js/supabaseClient.js';

/** URL から practice のパラメータを取得 */
function readPracticeParamsFromURL() {
  try {
    const p = new URLSearchParams(location.search);
    let mode  = p.get('mode');                      // 'all' | 'free' | 'review' | null
    let scope = (p.get('scope') || '').trim();      // '', 'cat', 'sub', 'free'
    if (scope === 'all') scope = '';
    let sid   = p.get('sid') || null;
    let cid   = p.get('cid') || null;

    // 1) mode フォールバック（practice_mode を優先）
    if (!mode || mode === 'review') {
      const mFromStore =
        sessionStorage.getItem('practice_mode') ||
        localStorage.getItem('practice_mode');
      mode = (mFromStore === 'all') ? 'all' : 'free';
    } else {
      mode = (mode === 'all') ? 'all' : 'free';
    }

    // 2) scope フォールバック（practice_scope_v1/practice_scope を優先）
    if (!scope) {
      const raw =
        sessionStorage.getItem('practice_scope_v1') ||
        localStorage.getItem('practice_scope_v1')  ||
        sessionStorage.getItem('practice_scope')   ||
        localStorage.getItem('practice_scope');
      if (raw) {
        try {
          const o = JSON.parse(raw);
          scope = o.scope || '';
          if (!sid) sid = o.sid || null;
          if (!cid) cid = o.cid || null;
        } catch {}
      }
    }

    return { mode, scope, sid, cid };
  } catch {
    return { mode: 'free', scope: '', sid: null, cid: null };
  }
}

/** scope に応じた問題IDプールを取得（question-main.js のロジック準拠） */
async function getPoolIds({ mode, scope, sid, cid }) {
  const includePaid = (mode === 'all');
  const base = supabase.from('questions').select('id').order('id', { ascending: true });

  // sub 固定
  if (scope === 'sub' && sid) {
    let q = base.eq('subcategory_id', sid);
    if (!includePaid) q = q.eq('is_paid', false);
    const { data, error } = await q;
    if (error) { console.error('[progress-reader] pool/sub error', error); return []; }
    return (data || []).map(r => String(r.id));
  }

  // cat 固定
  if (scope === 'cat' && cid) {
    const { data: subs, error: sErr } = await supabase
      .from('subcategories').select('id').eq('category_id', cid);
    if (sErr) { console.error('[progress-reader] pool/cat subcategories error', sErr); return []; }
    const subIds = (subs || []).map(s => s.id);
    if (!subIds.length) return [];
    let q = base.in('subcategory_id', subIds);
    if (!includePaid) q = q.eq('is_paid', false);
    const { data, error } = await q;
    if (error) { console.error('[progress-reader] pool/cat questions error', error); return []; }
    return (data || []).map(r => String(r.id));
  }

  // free / all
  let q = base;
  if (scope === 'free' || !includePaid) q = q.eq('is_paid', false);
  const { data, error } = await q;
  if (error) { console.error('[progress-reader] pool/default error', error); return []; }
  return (data || []).map(r => String(r.id));
}

/** 進捗行を取得（必要なら scope で絞る） */
export async function fetchProgressRows({ limit = 50, mode, scope, sid, cid } = {}) {
  const pp = readPracticeParamsFromURL();
  mode  ||= pp.mode;
  scope = (scope === undefined ? pp.scope : scope);
  sid   ||= pp.sid;
  cid   ||= pp.cid;

  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return { rows: [], error: 'no_user' };

  let rq = supabase
    .from('user_progress')
    .select('question_id, is_correct, answered_at')
    .eq('user_id', user.id)
    .order('answered_at', { ascending: false })
    .order('question_id', { ascending: false })
    .limit(limit);

  // scope がある or モードが free のときはプールで絞る
  if (scope || mode === 'free') {
    const poolIds = await getPoolIds({ mode, scope, sid, cid });
    if (!poolIds.length) return { rows: [], error: null };
    rq = rq.in('question_id', poolIds);
  }

  const { data, error } = await rq;
  if (error) return { rows: [], error };
  return { rows: data || [], error: null };
}

/** 件数集計（回答数/正解数） */
export async function countProgress({ mode, scope, sid, cid } = {}) {
  const pp = readPracticeParamsFromURL();
  mode  ||= pp.mode;
  scope = (scope === undefined ? pp.scope : scope);
  sid   ||= pp.sid;
  cid   ||= pp.cid;

  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return { answered: 0, correct: 0, error: 'no_user' };

  let base = supabase.from('user_progress').select('question_id', { count: 'exact', head: true }).eq('user_id', user.id);
  let cor  = supabase.from('user_progress').select('question_id', { count: 'exact', head: true }).eq('user_id', user.id).eq('is_correct', true);

  if (scope || mode === 'free') {
    const poolIds = await getPoolIds({ mode, scope, sid, cid });
    if (!poolIds.length) return { answered: 0, correct: 0, error: null };
    base = base.in('question_id', poolIds);
    cor  = cor.in('question_id', poolIds);
  }

  const [{ count: ans, error: e1 }, { count: corCnt, error: e2 }] = await Promise.all([base, cor]);
  return { answered: ans || 0, correct: corCnt || 0, error: e1 || e2 || null };
}

/** その問題を正解済みか（直近の正誤ではなく、1回でも正解したか） */
export async function isQuestionCleared(questionId) {
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return false;
  const { count, error } = await supabase
    .from('user_progress')
    .select('question_id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('question_id', String(questionId))
    .eq('is_correct', true);
  if (error) { console.warn('[progress-reader] isQuestionCleared error', error); }
  return (count || 0) > 0;
}

/** recordProgress が発火するカスタムイベントを購読 */
export function onProgressRecorded(handler) {
  const fn = (e) => handler?.(e.detail);
  // 現行
  window.addEventListener('progress:recorded', fn);
  // 旧名（残っている箇所があれば念のため）
  window.addEventListener('practice:progress-recorded', fn);

  // 解除用
  return () => {
    window.removeEventListener('progress:recorded', fn);
    window.removeEventListener('practice:progress-recorded', fn);
  };
}