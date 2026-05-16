import { supabase } from './supabaseClient.js';
import { getOrderedFreeQuestionIds, getCategoryPath } from './dataLoader.js';
import { openBillingPortal } from './billing-portal.js';

import { onProgressRecorded } from './progress-reader.js?v=prog-3';


// === progress-reader と同じ規則で mode/scope を解決 ===
function resolvePracticeParams() {
  const p = new URLSearchParams(location.search);
  let mode  = p.get('mode');                  // 'all' | 'free' | 'review' | null
  let scope = (p.get('scope') || '').trim();  // '', 'cat', 'sub', 'free'
  if (scope === 'all') scope = '';
  let sid   = p.get('sid') || null;
  let cid   = p.get('cid') || null;

  // mode フォールバック（保存値を優先）
  if (!mode || mode === 'review') {
    const mFromStore = sessionStorage.getItem('practice_mode') || localStorage.getItem('practice_mode');
    mode = (mFromStore === 'all') ? 'all' : 'free';
  } else {
    mode = (mode === 'all') ? 'all' : 'free';
  }

  // scope フォールバック（保存値を優先）
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
}

// === プール総数（分母）を mode/scope に合わせて数える ===
async function countPoolTotal({ mode, scope, sid, cid }) {
  const includePaid = (mode === 'all');

  // sub 固定
  if (scope === 'sub' && sid) {
    let q = supabase.from('questions').select('id', { head: true, count: 'exact' }).eq('subcategory_id', sid);
    if (!includePaid) q = q.eq('is_paid', false);
    const { count } = await q;
    return Number(count || 0);
  }

  // cat 固定
  if (scope === 'cat' && cid) {
    const { data: subs } = await supabase.from('subcategories').select('id').eq('category_id', cid);
    const subIds = (subs || []).map(s => s.id);
    if (!subIds.length) return 0;
    let q = supabase.from('questions').select('id', { head: true, count: 'exact' }).in('subcategory_id', subIds);
    if (!includePaid) q = q.eq('is_paid', false);
    const { count } = await q;
    return Number(count || 0);
  }

  // free / all（scope==='' もここ）
  let q = supabase.from('questions').select('id', { head: true, count: 'exact' });
  if (scope === 'free' || !includePaid) q = q.eq('is_paid', false);
  const { count } = await q;
  return Number(count || 0);
}

// === 直近誤答数（latest wrong）を scope に合わせて数える ===
async function countLatestWrong({ mode, scope, sid, cid }) {
  const includePaid = (mode === 'all');
  const view = includePaid ? 'user_wrong_latest_all' : 'user_wrong_latest_free_v2';

  // scope が無ければ全体
  if (!scope) {
    const { data: { session } } = await supabase.auth.getSession();
    const uid = session?.user?.id;
    if (!uid) return 0;
    const { count } = await supabase.from(view).select('question_id', { head: true, count: 'exact' }).eq('user_id', uid);
    return Number(count || 0);
  }

  // 絞り込み用に対象プールIDを取る
  const includePaid2 = (mode === 'all');
  const base = supabase.from('questions').select('id');
  let qids = [];
  if (scope === 'sub' && sid) {
    let q = base.eq('subcategory_id', sid);
    if (!includePaid2) q = q.eq('is_paid', false);
    const { data } = await q;
    qids = (data || []).map(r => String(r.id));
  } else if (scope === 'cat' && cid) {
    const { data: subs } = await supabase.from('subcategories').select('id').eq('category_id', cid);
    const subIds = (subs || []).map(s => s.id);
    if (!subIds.length) return 0;
    let q = base.in('subcategory_id', subIds);
    if (!includePaid2) q = q.eq('is_paid', false);
    const { data } = await q;
    qids = (data || []).map(r => String(r.id));
  } else {
    let q = base;
    if (scope === 'free' || !includePaid2) q = q.eq('is_paid', false);
    const { data } = await q;
    qids = (data || []).map(r => String(r.id));
  }
  if (!qids.length) return 0;

  const { data: { session } } = await supabase.auth.getSession();
  const uid = session?.user?.id;
  if (!uid) return 0;

  const { count } = await supabase
    .from(view)
    .select('question_id', { head: true, count: 'exact' })
    .eq('user_id', uid)
    .in('question_id', qids);

  return Number(count || 0);
}

const QUESTIONS_BASE = '/contents';

let chapterMap = {};
let progressChart = null;


// ---------- helpers: 章マップ ----------
async function buildSubcategoryMap() {
  const { data, error } = await supabase
    .from('subcategories')
    .select(`
      id, slug, name, category_id,
      categories(name)
    `)
    .order('order', { ascending: true });
  if (error) return {};

  const map = {};
  for (const r of data) {
   map[r.id] = {
     slug: r.slug,
     categoryId: r.category_id,                       // ← 追加：大分野ID
     categoryName: r.categories?.name ?? '(不明な分野)',
     name: r.name
   };
  }
  return map;
}

// questions を全部取る（Supabase の 1000 行制限を回避するためのページング）
async function fetchAllQuestionRows(paid) {
  const PAGE_SIZE = 1000;
  let from = 0;
  let all = [];

  while (true) {
    let q = supabase
      .from('questions')
      .select('id, subcategory_id')
      .range(from, from + PAGE_SIZE - 1);   // 0-999, 1000-1999, ...

    if (!paid) q = q.eq('is_paid', false);

    const { data, error } = await q;
    if (error) {
      console.error('[fetchAllQuestionRows] error:', error);
      break;
    }
    const rows = data || [];
    all = all.concat(rows);

    // 1000 件未満になったら終わり（これ以上のページはない）
    if (rows.length < PAGE_SIZE) break;

    from += PAGE_SIZE;
  }

  return all;
}


// ---------- helpers: 進捗集計 ----------
async function fetchUserProgress(userId) {
  // 会員かどうかで集計対象を切り替える
  const paid = await isSubscribed(userId);

  // 小分類ごとの問題総数（全件ページング取得）
  const qrows = await fetchAllQuestionRows(paid);
  if (!qrows || !qrows.length) {
    console.warn('[fetchUserProgress] no question rows fetched');
    return {};
  }


  const totalsBySub = {};
  for (const q of qrows) {
    if (!q.subcategory_id) continue;
    totalsBySub[q.subcategory_id] = (totalsBySub[q.subcategory_id] || 0) + 1;
  }

  // 初期化（全小分類を0で作る）
  const categoryData = {};
  for (const [subId, { categoryName, name: chapterName }] of Object.entries(chapterMap)) {
    if (!categoryData[categoryName]) {
      categoryData[categoryName] = { correct: 0, total: 0, chapters: {} };
    }
    const subTotal = totalsBySub[subId] || 0;
    categoryData[categoryName].chapters[subId] = { name: chapterName, correct: 0, total: subTotal };

    categoryData[categoryName].total += subTotal;
  }

  // 自分の解答履歴（会員=全問題 / 非会員=無料のみ）
  let q2 = supabase
    .from('user_progress')
    .select(`
      id, question_id, is_correct, answered_at, updated_at,
      questions!inner ( subcategory_id, is_paid )
    `)
    .eq('user_id', userId)
    .order('answered_at', { ascending: false, nullsFirst: false })
    .order('updated_at', { ascending: false, nullsFirst: false })
    .order('id',         { ascending: false });
  if (!paid) q2 = q2.eq('questions.is_paid', false);

  const { data: logs, error: lerr } = await q2;
  if (lerr) return categoryData;

  // 問題ごとに最後の解答だけ採用
  const lastByQuestion = new Map();
  for (const row of logs) {
    if (!lastByQuestion.has(row.question_id)) {
      lastByQuestion.set(row.question_id, row); // 先に来た＝最新だけ保持
    }
  }

  for (const row of lastByQuestion.values()) {
    const subId = row.questions?.subcategory_id;
    const chap = subId && chapterMap[subId];
    if (!chap) continue;
    if (row.is_correct) {
      const cat = categoryData[chap.categoryName];
      // バケット未生成でも補完してから加算（超レア保険）
      if (!cat.chapters[subId]) {
        cat.chapters[subId] = {
        name: chap.name,
        correct: 0,
        total: 0
       };
      }
        cat.correct += 1;
        cat.chapters[subId].correct += 1;
     }
    }
  return categoryData;
}

// === 学習カレンダー用ヘルパー =============================

// UTCタイムスタンプを「JSTのYYYY-MM-DD」に丸める
function toJstYmd(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;

  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d).reduce((o, p) => {
    o[p.type] = p.value;
    return o;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

// ユーザーが「1日でも学習した日」の集合を取得（JST日付のSet）
async function fetchStudyDaysSet(userId) {
  try {
    const { data, error } = await supabase
      .from('user_progress')
      .select('answered_at, updated_at')
      .eq('user_id', userId);

    if (error) {
      console.error('[study-calendar] fetchStudyDaysSet error:', error);
      return new Set();
    }

    const days = new Set();
    for (const row of data ?? []) {
      const ymd = toJstYmd(row.answered_at || row.updated_at);
      if (ymd) days.add(ymd);
    }
    return days;
  } catch (e) {
    console.error('[study-calendar] fetchStudyDaysSet exception:', e);
    return new Set();
  }
}

// カレンダーHTMLを描画する
function renderStudyCalendarTable(rootEl, year, monthIndex, learnedDaysSet) {
  // monthIndex: 0-11
  if (!rootEl) return;

  const first = new Date(year, monthIndex, 1);
  const firstDow = first.getDay(); // 0:日
  const lastDate = new Date(year, monthIndex + 1, 0).getDate();

  const yStr = String(year);
  const mStr = String(monthIndex + 1).padStart(2, '0');

  const table = document.createElement('table');
  table.className = 'study-calendar-table';

  const thead = document.createElement('thead');
  thead.innerHTML = `
    <tr>
      <th>日</th><th>月</th><th>火</th><th>水</th><th>木</th><th>金</th><th>土</th>
    </tr>
  `;
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  let row = document.createElement('tr');

  // 1日までの空マス
  for (let i = 0; i < firstDow; i++) {
    const td = document.createElement('td');
    td.className = 'empty';
    row.appendChild(td);
  }

  for (let day = 1; day <= lastDate; day++) {
    const dow = (firstDow + day - 1) % 7;
    const td = document.createElement('td');
    const dStr = String(day).padStart(2, '0');
    const ymd = `${yStr}-${mStr}-${dStr}`;

    td.textContent = String(day);

    if (learnedDaysSet?.has(ymd)) {
      td.classList.add('learned-day');
    }

    row.appendChild(td);

    if (dow === 6 || day === lastDate) {
      // 土曜日 or 月末で行を閉じる
      tbody.appendChild(row);
      row = document.createElement('tr');
    }
  }

  table.appendChild(tbody);

  // 差し替え
  rootEl.innerHTML = '';
  rootEl.appendChild(table);
}


// --- helpers: プロフィール（streak） ---
async function fetchProfileStreak(userId) {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('streak_days')
    .eq('user_id', userId)   // ★追加
    .maybeSingle();          // データ未作成でも例外にしない
  if (error) { console.error('fetchProfileStreak error:', error); return 0; }
  return data?.streak_days ?? 0;
}

async function getRandomAnyQuestionId() {
  const { count, error: cerr } = await supabase
    .from('questions')
    .select('id', { head: true, count: 'exact' });
  if (cerr || !count) { console.error(cerr); return null; }

  const offset = Math.floor(Math.random() * count);
  const { data, error } = await supabase
    .from('questions')
    .select('id')
    .order('id', { ascending: true })
    .range(offset, offset);
  if (error) { console.error(error); return null; }

  return data?.[0]?.id ?? null;
}

// === 共通ヘルパー（重複排除） ===

// 分野→設問ID
async function fetchQuestionIdsByCategory(categoryId, nowPaid) {
  const subIds = Object.entries(chapterMap)
    .filter(([, info]) => String(info.categoryId) === String(categoryId))
    .map(([sid]) => sid);
  if (!subIds.length) return [];
  let q = supabase.from('questions').select('id').in('subcategory_id', subIds);
  if (!nowPaid) q = q.eq('is_paid', false);
  const { data, error } = await q;
  if (error) { console.error(error); return []; }
  return (data ?? []).map(r => String(r.id));
}

async function fetchQuestionIdsBySub(subId, nowPaid) {
  let q = supabase.from('questions').select('id').eq('subcategory_id', subId);
  if (!nowPaid) q = q.eq('is_paid', false);
  const { data, error } = await q;
  if (error) { console.error(error); return []; }
  return (data ?? []).map(r => String(r.id));
}

// このプールに直近誤答が残っているか？
async function hasWrongInPool(userId, ids, nowPaid) {
  if (!ids.length) return false;
  const view = nowPaid ? 'user_wrong_latest_all' : 'user_wrong_latest_free_v2';
  const { data, error } = await supabase
    .from(view).select('question_id').eq('user_id', userId).in('question_id', ids);
  if (error) { console.error(error); return false; }
  const wrongSet = new Set((data ?? []).map(r => String(r.question_id)));
  return ids.some(id => wrongSet.has(String(id)));
}

// 指定ID群の「最新の正誤」を取得（最新は answered_at → updated_at → id の順）
async function getLatestCorrectMap(userId, ids) {
  if (!ids.length) return new Map();
  const { data, error } = await supabase
    .from('user_progress')
    .select('question_id, is_correct, answered_at, updated_at, id')
    .eq('user_id', userId)
    .in('question_id', ids)
    .order('answered_at', { ascending: false, nullsFirst: false })
    .order('updated_at', { ascending: false, nullsFirst: false })
    .order('id',         { ascending: false });

  if (error) { console.error(error); return new Map(); }
  const m = new Map();
  for (const r of (data ?? [])) {
    const qid = String(r.question_id);
    if (!m.has(qid)) m.set(qid, r.is_correct); // 最初だけ＝最新
  }
  return m;
}

// 未正解を優先して1問選ぶ（全て最新が正解なら全体からランダム）
async function pickOnePreferNotCorrect(userId, ids) {
  const latest = await getLatestCorrectMap(userId, ids);
  const notYetCorrect = ids.filter(id => latest.get(String(id)) !== true);
  const pool = notYetCorrect.length ? notYetCorrect : ids;
  return pool[Math.floor(Math.random() * pool.length)];
}

// プールが「最新すべて正解」か？
async function areAllCorrect(userId, ids) {
  if (!ids.length) return false;
  const latest = await getLatestCorrectMap(userId, ids);
  return ids.length > 0 && ids.every(id => latest.get(String(id)) === true);
}

// helpers 各設問の最新解答だけを採用して正解数を数える（会員=全問、非会員=無料のみ）
async function countAnsweredAndCorrectLatest(userId, paid) {
  let q = supabase
    .from('user_progress')
    .select(`
      question_id, is_correct, updated_at, answered_at,
      questions!inner ( is_paid )
    `)
    .eq('user_id', userId)
    .order('answered_at', { ascending: false, nullsFirst: false })
    .order('updated_at', { ascending: false, nullsFirst: false })
    .order('id',         { ascending: false });

  if (!paid) q = q.eq('questions.is_paid', false);

  const { data: rows, error } = await q;
  if (error || !rows) return { answered: 0, correct: 0 };

  const seen = new Set();
  let answered = 0;
  let correct  = 0;

  for (const r of rows) {
    const qid = String(r.question_id);
    if (seen.has(qid)) continue;       // 既に最新を拾っている
    seen.add(qid);
    answered += 1; 
    if (r.is_correct) correct += 1;
  }
  return { answered, correct };
}

// 進捗サマリ（上部）— mode/scope 準拠
// 進捗サマリ（上部）— 有料/無料で分母を切り替え
async function fetchProgressSummaryGlobal(userId) {
  const paid = await isSubscribed(userId);

  // 分母：問題総数（有料=全問 / 無料=無料32問）
  async function countTotalQuestions() {
    let q = supabase
      .from('questions')
      .select('id', { head: true, count: 'exact' });

    if (!paid) {
      // 無料ユーザーは is_paid = false だけ
      q = q.eq('is_paid', false);
    }

    const { count, error } = await q;
    if (error) {
      console.error('[fetchProgressSummaryGlobal] total error', error);
      return 0;
    }
    return Number(count || 0);
  }

  // 直近誤答数（全体）
  async function countWrongGlobal() {
    const view = paid ? 'user_wrong_latest_all' : 'user_wrong_latest_free_v2';
    const { count, error } = await supabase
      .from(view)
      .select('question_id', { head: true, count: 'exact' })
      .eq('user_id', userId);

    if (error) {
      console.error('[fetchProgressSummaryGlobal] wrong error', error);
      return 0;
    }
    return Number(count || 0);
  }

  const [{ answered, correct }, total, wrong] = await Promise.all([
    // 分子：自分が解いた問題（最新1回分）
    countAnsweredAndCorrectLatest(userId, paid),
    countTotalQuestions(),
    countWrongGlobal()
  ]);

  // percent は renderOverallProgressSummary が計算するのでそのまま返す
  return { total, answered, correct, wrong };
}

// --- 復習リスト件数（全体） ---
async function fetchReviewCountGlobal(userId) {
  try {
    const { count, error } = await supabase
      // ★ review.js と同じテーブル or ビュー名に揃える
      .from('user_review_items')
      .select('id', { head: true, count: 'exact' })
      .eq('user_id', userId)
      .eq('status', 'active'); // review.html が使っているステータスに合わせる

    if (error) {
      console.error('[mypage] review count error', error);
      return 0;
    }
    return Number(count || 0);
  } catch (e) {
    console.error('[mypage] review count exception', e);
    return 0;
  }
}


// --- helpers: サブスク取得/判定（user_profiles だけ見る・キャッシュなし簡易版） ---
const ACTIVE_STATUSES = ['active', 'trialing', 'past_due'];

async function isSubscribed(userId) {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('subscription_status, current_period_end')
    .eq('user_id', userId)
    .maybeSingle();

  if (error || !data) {
    console.error('[isSubscribed] error or no data', error, data);
    return false;
  }

  const status = String(data.subscription_status || '').toLowerCase();
  const exp = data.current_period_end ? new Date(data.current_period_end) : null;

  const active =
    (exp && exp.getTime() > Date.now() - 60_000) ||  // 有効期限が未来なら OK（60秒グレース）
    ACTIVE_STATUSES.includes(status);                // 念のためステータスでも判定

  console.log('[isSubscribed] row =', data, '=> active =', active);
  return active;
}


// --- UI 切替（有料/無料） ---
function applySubscriptionUI(isPaid) {
  // アップセル（HTMLが <section id="paid-upsell">… なら優先して隠す）
  const upsell =
    document.getElementById('paid-upsell') ||
    document.getElementById('purchase-btn')?.closest('.subcat-card');

  if (upsell) {
    upsell.classList.toggle('hidden', isPaid);
  } else {
    // ラッパーが無い旧構成でも隠せるように保険
    const btn = document.getElementById('purchase-btn');
    btn?.classList.toggle('hidden', isPaid);
    btn?.previousElementSibling?.classList.toggle('hidden', isPaid);                // 説明<p>
    btn?.previousElementSibling?.previousElementSibling?.classList.toggle('hidden', isPaid); // 見出し<h3>
  }

  // ヘッダーの購入/キャンセル
  document.getElementById('link-checkout')?.classList.toggle('hidden', isPaid);
  document.getElementById('link-cancel')?.classList.toggle('hidden', !isPaid);

  // 任意：状態クラス（CSSで使いたい場合）
  document.body.classList.toggle('paid', isPaid);
}

// ---------- 色（CSSカスタムプロパティから） ----------
const css = getComputedStyle(document.documentElement);
const rawColors = {
  '危険物に関する法令': css.getPropertyValue('--color-law').trim(),
  '物理と化学':         css.getPropertyValue('--color-physics').trim(),
  '性質と火災予防':     css.getPropertyValue('--color-safety').trim(),
};
const norm = (s) => String(s).replace(/\s+/g, '').toLowerCase();
const categoryColors = new Proxy(rawColors, {
  get: (t, p) => t[p] ?? t[Object.keys(t).find(k => norm(k) === norm(p))] ?? '#ccc'
});

// ---------- 描画 ----------
// --- helpers: 大分野ID ↔ 小分野ID / 大分野名マップ ---
function getSubcategoryIdsByCategoryId(categoryId) {
   const cid = String(categoryId);
   return Object.entries(chapterMap)
     .filter(([, info]) => String(info.categoryId) === cid)
     .map(([sid]) => sid);
}

function buildCategoryNameToIdMap() {
  const m = {};
  for (const info of Object.values(chapterMap)) {
    if (info.categoryName && info.categoryId && m[info.categoryName] == null) {
      m[info.categoryName] = info.categoryId;
    }
  }
  return m;
}

// 既存の norm を使います
function resolveCategoryIdByLabel(label, categoryNameToId) {
  if (!label) return null;
  // 完全一致→正規化一致 の順で解決
  if (categoryNameToId[label] != null) return categoryNameToId[label];
  const key = Object.keys(categoryNameToId).find(k => norm(k) === norm(label));
  return key ? categoryNameToId[key] : null;
}

async function handleCategoryBarClick(idx, categoryNameToId, getUser) {
  const label = progressChart?.data?.labels?.[idx];
  const categoryId = resolveCategoryIdByLabel(label, categoryNameToId);
  if (!categoryId) return;

  const user = getUser();
  const nowPaid = await isSubscribed(user.id);

  const targetIds = await fetchQuestionIdsByCategory(categoryId, nowPaid);
  if (!targetIds.length) { alert('この分野の問題が見つかりませんでした。'); return; }

  if (await areAllCorrect(user.id, targetIds)) {
    const go = confirm(`${label} はすべて完了しています。ランダムで再挑戦しますか？`);
    if (!go) return;
  }

  const qid  = await pickOnePreferNotCorrect(user.id, targetIds);
  const path = await getCategoryPath(qid);
  const qs = new URLSearchParams();
  qs.set('mode', nowPaid ? 'all' : 'free');
  qs.set('scope', 'cat');
  qs.set('cid', String(categoryId));
  location.href = `${QUESTIONS_BASE}/${path}/${qid}.html?${qs.toString()}`;
}

function renderCategoryChart(categoryData, categoryNameToId, getUser) {
  const canvas = document.getElementById('progressChart');
  if (!canvas || !window.Chart) return;

  if (progressChart) progressChart.destroy();

  const labels = Object.keys(categoryData);
  const values = labels.map(l => {
    const { correct, total } = categoryData[l];
    return total > 0 ? Math.round((correct / total) * 100) : 0;
  });
  const colors = labels.map(l => categoryColors[l] || '#ccc');

  const ctx = canvas.getContext('2d');
  progressChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: colors,
        borderColor: colors,
        borderWidth: 1,
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        y: { beginAtZero: true, max: 100, ticks: { stepSize: 20, callback: v => v + '%' } }
      },
      plugins: { legend: { display: false } },

      // クリック時は常に「そのX列のインデックス」を解決する
      onClick: (evt, _activeEls, chart) => {
        // 1) 通常経路：index & 非交差
        let els = chart.getElementsAtEventForMode(evt, 'index', { intersect: false }, true);
        let idx = els?.[0]?.index ?? els?.[0]?._index;

        // 2) フォールバック：座標→Xスケールからインデックス算出
        if (typeof idx !== 'number') {
          const xScale = chart.scales?.x || chart.scales?.['x-axis-0'];
          const ox = evt?.native?.offsetX ?? evt?.offsetX; // v4 / DOM
          if (xScale && typeof ox === 'number') {
            const v = xScale.getValueForPixel(ox);              // category: 数値 or ラベル
            idx = (typeof v === 'number') ? v : chart.data.labels.indexOf(v);
          }
        }

        if (typeof idx !== 'number' || idx < 0) return;
        handleCategoryBarClick(idx, categoryNameToId, getUser);
      }
    } 
  });

  // ← この直後に追加
canvas.style.position = 'relative';
canvas.style.zIndex = '10';
canvas.style.pointerEvents = 'auto';

// 念のため、下に続くセクションが重なっていたら下げる
const under = canvas.closest('.tab-content')?.nextElementSibling;
if (under) {
  under.style.position = 'relative';
  under.style.zIndex = '0';
}

  canvas.style.cursor = 'pointer';
}

function renderCategoryList(categoryData) {
  const list = document.getElementById('category-list');
  if (!list) return;
  list.innerHTML = '';

  for (const [catName, catData] of Object.entries(categoryData)) {
    // 見出し（大分野）
    const header = document.createElement('button');
    header.type = 'button';
    header.className = 'category-toggle';
    header.setAttribute('aria-expanded', 'false');

    const pct = catData.total ? Math.round((catData.correct / catData.total) * 100) : 0;
    header.innerHTML = `
      <strong>${catName}</strong> （${catData.correct}/${catData.total}問）
      <div class="cat-bar"><div class="cat-fill" style="width:${pct}%;background:${categoryColors[catName]};"></div></div>
    `;
    list.appendChild(header);

    // パネル（小分野リスト）
    const panel = document.createElement('ul');
    panel.className = 'category-panel';
    panel.hidden = true;

    for (const [subId, chapData] of Object.entries(catData.chapters)) {
      const chapName = chapData.name;
      const cPct = chapData.total ? Math.round((chapData.correct / chapData.total) * 100) : 0;

      const li = document.createElement('li');
      li.innerHTML = `
        ${chapName} （${chapData.correct}/${chapData.total}問）
        <div class="cat-bar"
             data-sub-id="${subId ?? ''}"
             data-slug="${chapterMap[subId]?.slug || ''}"
             data-cat-name="${catName}"
             data-chap-name="${chapName}"
             style="cursor:pointer">
          <div class="cat-fill" style="width:${cPct}%;background:${categoryColors[catName] || '#ccc'};"></div>
        </div>
      `;
      panel.appendChild(li);
    }
    list.appendChild(panel);
  }

  // 開閉は現状のまま
  list.querySelectorAll('.category-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const exp = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', String(!exp));
      btn.nextElementSibling.hidden = exp;
    });
  });
}

// --- 上部の「学習状況/％/バー/直近誤答」をサマリから描画 ---
function renderOverallProgressSummary({ total, correct, wrong }) {
  const percent = total ? Math.round(( correct / total) * 100) : 0;

  const textEl  = document.getElementById('progress-text');   // ％
  const countEl = document.getElementById('progress-count');  // （x/y問）
  const fillEl  = document.getElementById('progress-fill');   // バーの幅
  const barEl   = document.getElementById('progressbar');     // aria
  const wrongEl = document.getElementById('wrong-count');     // 直近誤答 N

  if (textEl)  textEl.textContent  = `${percent}%`;
  if (countEl) countEl.textContent = `（${correct}/${total}問）`;
  if (fillEl)  fillEl.style.width  = `${percent}%`;
  if (barEl) {
    barEl.setAttribute('aria-valuenow', String(percent));
    barEl.setAttribute('aria-valuetext', `学習進捗 ${percent}%`);
  }
  if (wrongEl) wrongEl.textContent = String(wrong ?? 0);
}

// --- 復習リスト件数バッジの描画 ---
function renderReviewCountGlobal(count) {
  const el = document.getElementById('review-count');
  if (!el) return;
  const n = Number.isFinite(count) ? count : 0;
  el.textContent = String(n);
}

// ---------- main ----------
document.addEventListener('DOMContentLoaded', async () => {
  console.log('[MP] DOM ready on', location.pathname);
  // セッション
  const { data: { session }, error: sErr } = await supabase.auth.getSession();
  if (sErr) return;
  if (!session) { window.location.href = '/login.html'; return; }
  const user = session.user;
  const getUser = () => user; 

  const paid = await isSubscribed(user.id);
  applySubscriptionUI(paid);

  // ヘッダー：メール
  const emailEl = document.getElementById('user-email');
  if (emailEl) emailEl.textContent = user.email ?? '';

  // ログアウト
  document.querySelectorAll('#logout-link, .nav-link.logout').forEach(el => {
    el.addEventListener('click', async (e) => {
      e.preventDefault();
      _subCache = null;
      await supabase.auth.signOut();
      window.location.href = '/login.html';
    });
 });

  // ナビの「請求情報」→ポータル
  document.getElementById('link-cancel')?.addEventListener('click', (e) => {
    e.preventDefault();
    openBillingPortal();
  });

    // === 上部サマリ（常に全体で集計） ===
  // === 上部サマリ（常に全体で集計） ===
  async function refreshOverallSummary() {
    try {
      const summary = await fetchProgressSummaryGlobal(user.id);
      renderOverallProgressSummary(summary);
    } catch (e) {
      console.error('[mypage] summary error', e);
      renderOverallProgressSummary({ total: 0, correct: 0, wrong: 0 });
    }
  }

  // ★ 復習リスト件数のサマリ
  async function refreshReviewSummary() {
    try {
      const count = await fetchReviewCountGlobal(user.id);
      renderReviewCountGlobal(count);
    } catch (e) {
      console.error('[mypage] review summary error', e);
      renderReviewCountGlobal(0);
    }
  }

  // 初期表示時に両方まとめて更新
  await Promise.all([
    refreshOverallSummary(),
    refreshReviewSummary(),
  ]);

  // 解答記録が入ったら即反映（progress-reader 経由）
  onProgressRecorded(() => {
    // Promise は待たなくてOK、fire-and-forget で更新
    refreshOverallSummary();
    refreshReviewSummary();
  });



  // 「練習問題を始める」
  const practiceBtn = document.getElementById('btn-practice');
  practiceBtn?.addEventListener('click', async () => {
    try {
      if (practiceBtn.disabled) return;
      practiceBtn.disabled = true;

      // 誤答があってもここでは誤答ページへ飛ばさない。
      const nowPaid = await isSubscribed(user.id);

      if (nowPaid) {
        // 2) 有料：全問題からランダム
        const qid = await getRandomAnyQuestionId();
        if (!qid) { alert('問題が見つかりませんでした。'); return; }
        const path = await getCategoryPath(qid);
        location.href = `${QUESTIONS_BASE}/${path}/${qid}.html?mode=all&scope=all`;
        return;
      }

      // 3) 無料：厳選32問からランダム（全問済なら確認してランダム再挑戦）
      const ordered = await getOrderedFreeQuestionIds();
      if (!ordered?.length) { alert('無料問題が見つかりませんでした。'); return; }

      const { data: latestRows, error: lerr2 } = await supabase
        .from('user_latest_free_v2')
        .select('question_id')
        .eq('user_id', user.id);
      if (lerr2) { console.error(lerr2); alert('読み込みに失敗しました。'); return; }

      const latestSet = new Set((latestRows ?? []).map(r => String(r.question_id)));
      const allDoneFree = ordered.length > 0 && latestSet.size >= ordered.length;
      if (allDoneFree) {
        const go = confirm('無料セットはすべて完了しています。ランダムで再挑戦しますか？');
        if (!go) return;
      }

      const candidate = ordered[Math.floor(Math.random() * ordered.length)];
      const path = await getCategoryPath(candidate);
      location.href = `${QUESTIONS_BASE}/${path}/${candidate}.html?mode=free&scope=free`;
    } catch (e) {
      console.error(e);
      alert('読み込みに失敗しました。');
    } finally {
      practiceBtn.disabled = false;
    }
  });


  // ストリーク
  const streakEl = document.getElementById('streak-count');
  if (streakEl) {
    const s = await fetchProfileStreak(user.id);
    streakEl.textContent = String(s);
  }

    // === 学習カレンダー（スクロール式） ======================
  const calRoot   = document.getElementById('study-calendar');
  const calPrev   = document.getElementById('study-cal-prev');
  const calNext   = document.getElementById('study-cal-next');
  const calTitle  = document.querySelector('.study-calendar-title');

  if (calRoot && calPrev && calNext && calTitle) {
    // 今日（ブラウザ側）の年月を初期表示にする
    const today = new Date();
    let calYear  = today.getFullYear();
    let calMonth = today.getMonth(); // 0-11

    // このユーザーが「1日でも学習した日」の集合を取得
    const learnedDaysSet = await fetchStudyDaysSet(user.id);

    function updateCalendar() {
      renderStudyCalendarTable(calRoot, calYear, calMonth, learnedDaysSet);

      const mDisp = String(calMonth + 1).padStart(2, '0');
      calTitle.textContent = `${calYear}年${mDisp}月の学習カレンダー`;
    }

    calPrev.addEventListener('click', () => {
      // 前の月へ
      if (calMonth === 0) {
        calMonth = 11;
        calYear -= 1;
      } else {
        calMonth -= 1;
      }
      updateCalendar();
    });

    calNext.addEventListener('click', () => {
      // 次の月へ
      if (calMonth === 11) {
        calMonth = 0;
        calYear += 1;
      } else {
        calMonth += 1;
      }
      updateCalendar();
    });

    // 最初の1回描画
    updateCalendar();
  }


  // 分野別進捗（チャート/リスト）
  chapterMap = await buildSubcategoryMap();
  const categoryData = await fetchUserProgress(user.id);
  const categoryNameToId = buildCategoryNameToIdMap();

  const activePanelId = document.querySelector('.tab-content.active')?.id;
  if (activePanelId === 'tab-list') {
    renderCategoryList(categoryData);
    wireCategoryListClicks(getUser);
  } else {
    renderCategoryChart(categoryData, categoryNameToId, getUser);
  }

  // タブ切り替え
  document.querySelectorAll('.chart-switch .tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.chart-switch .tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

      const targetId = tab.getAttribute('aria-controls') || `tab-${tab.dataset.view || ''}`;
      document.getElementById(targetId)?.classList.add('active');

      if (targetId === 'tab-graph') {
        renderCategoryChart(categoryData, categoryNameToId, getUser);
      } else if (targetId === 'tab-list') {
        renderCategoryList(categoryData);
        wireCategoryListClicks(getUser);
      }
    });
  });

  function wireCategoryListClicks(getUser) {
  const list = document.getElementById('category-list');
  if (!list) return;
  if (list.dataset.wired === '1') return; // 二重バインド防止
  list.dataset.wired = '1';

  // デリゲーションで .cat-bar を拾う
  list.addEventListener('click', async (e) => {
    const bar = e.target.closest('.cat-bar');
    if (!bar || !list.contains(bar)) return;

    const subId    = bar.dataset.subId;
    const catName  = bar.dataset.catName;
    const chapName = bar.dataset.chapName;
    if (!subId) return; // 大分野バーなどは無視

    const user = getUser();
    try {
      const nowPaid = await isSubscribed(user.id);

      // ① 小分野の対象問題（有料=全問 / 無料=無料のみ）
      let qQuery = supabase.from('questions').select('id').eq('subcategory_id', subId);
      if (!nowPaid) qQuery = qQuery.eq('is_paid', false);
      const { data: qRows, error: qErr } = await qQuery;
      if (qErr) { console.error(qErr); alert('読み込みに失敗しました。'); return; }

      const targetIds = (qRows ?? []).map(r => String(r.id));
      if (!targetIds.length) { alert('この小分野の問題が見つかりませんでした。'); return; }

      // ③ 最新すべて正解なら確認
      const allDone = await areAllCorrect(user.id, targetIds);
      if (allDone) {
        const go = confirm(`${catName} ＞ ${chapName} はすべて完了しています。ランダムで再挑戦しますか？`);
        if (!go) return;
      }

      // ④ 未正解を優先して1問へ
      const qid = await pickOnePreferNotCorrect(user.id, targetIds);

      // 小分野内ランダムへ
      const path = await getCategoryPath(qid);
      const qs = new URLSearchParams();
      qs.set('mode', nowPaid ? 'all' : 'free'); 
      qs.set('scope', 'sub');         // ★ 小分野スコープ
      qs.set('sid', subId);           // ★ 小分野ID（UUID）を渡す
      location.href = `${QUESTIONS_BASE}/${path}/${qid}.html?${qs.toString()}`;
    } catch (e) {
      console.error(e);
      alert('読み込みに失敗しました。');
    }
    }, { passive: true });
}

  // 誤答ページへ
  document.getElementById('btn-open-wrong')?.addEventListener('click', () => {
    window.location.href = '/mistakes.html?view=wrong';
  });

  // 復習リスト
  document.getElementById('review-btn')?.addEventListener('click', () => {
    window.location.href = '/review.html';
  });

  // 請求情報カード（有料のみ見せる）
  const card   = document.getElementById('billing-card');
  const btn    = document.getElementById('btn-open-portal');
  const hintEl = document.getElementById('billing-hint');

  const { data: profile, error: profErr } = await supabase
    .from('user_profiles')
    .select('stripe_customer_id, subscription_status, current_period_end')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!profErr && profile?.stripe_customer_id) {
    card?.classList.remove('hidden');
    if (hintEl) {
      const endStr = profile.current_period_end
        ? new Date(profile.current_period_end).toLocaleDateString('ja-JP', { year: 'numeric', month: 'numeric', day: 'numeric' })
        : '';
      hintEl.textContent =
        `現在のステータス：${profile.subscription_status ?? 'none'}` +
        (endStr ? `（有効期限：${endStr} まで）` : '');
    }
  }

  // === 受験日カウントダウン（スコープ隔離） ===
(() => {
  const elDisplay = document.getElementById('countdown-display');
  const elForm    = document.getElementById('exam-date-form');
  const elInput   = document.getElementById('exam-date-input');
  const btnSave   = document.getElementById('exam-date-save');
  const btnClear  = document.getElementById('exam-date-clear');

  let midnightTimer = null;

  if (!elDisplay || !elForm || !elInput || !btnSave || !btnClear) {
    // マイページ以外では何もしない
    return;
  }

  // JSTの今日を "YYYY-MM-DD" で
  function jstTodayYMD() {
    const now = new Date();
    const p = new Intl.DateTimeFormat('ja-JP', {
      timeZone:'Asia/Tokyo', year:'numeric', month:'2-digit', day:'2-digit'
    }).formatToParts(now).reduce((o,p)=>(o[p.type]=p.value,o),{});
    return `${p.year}-${p.month}-${p.day}`;
  }

  // JSTの“日単位の差”（試験日 - 今日）
  function daysLeftJST(ymd) {
    if (!ymd) return null;
    const [y,m,d] = ymd.split('-').map(Number);
    const examUTC  = Date.UTC(y, m-1, d);                       // 受験日の 00:00
    const [ty,tm,td] = jstTodayYMD().split('-').map(Number);
    const todayUTC = Date.UTC(ty, tm-1, td);                    // 今日の 00:00
    return Math.round((examUTC - todayUTC) / 86400000);
  }

  // 次の JST 深夜0時までのms
  function msUntilNextJSTMidnight() {
    const now = new Date();
    const p = new Intl.DateTimeFormat('ja-JP', {
      timeZone:'Asia/Tokyo', hour12:false,
      year:'numeric', month:'2-digit', day:'2-digit',
      hour:'2-digit', minute:'2-digit', second:'2-digit'
    }).formatToParts(now).reduce((o,p)=>(o[p.type]=p.value,o),{});
    const cur  = new Date(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}+09:00`);
    const next = new Date(`${p.year}-${p.month}-${p.day}T00:00:00+09:00`);
    next.setDate(next.getDate() + 1);
    return next - cur;
  }

  function updateDisplay(ymd){
    if (!ymd) { elDisplay.textContent = '受験日を設定してください'; return; }
    const left = daysLeftJST(ymd);
    if (left > 0)        elDisplay.textContent = `本番まで残り ${left}日`;
    else if (left === 0) elDisplay.textContent = '今日が試験日！';
    else                 elDisplay.textContent = `試験日から ${Math.abs(left)}日経過`;
  }

  // 入力の最小値を「今日（JST）」に固定
  elInput.min = jstTodayYMD();

  // 保存：RPC があれば優先、なければテーブルUPSERT（RLS前提）
  async function saveExamDate(ymd /* string | null */) {
    try {
      const { error } = await supabase.rpc('set_exam_date', { p_exam_date: ymd });
      if (!error) return;
    } catch {/* RPCが無い場合は無視 */}
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from('exam_dates').upsert({ user_id: user.id, exam_date: ymd });
  }

  // 取得：テーブル直読み（RLS）→ 失敗時のみRPC
  async function fetchExamDate() {
    try {
      const { data, error } = await supabase.from('exam_dates').select('exam_date').maybeSingle();
      if (!error) return data?.exam_date ?? null;
    } catch {}
    try {
      const { data } = await supabase.rpc('get_exam_date');
      // SQL関数の戻り形式により配列or単体の可能性があるため両対応
      if (Array.isArray(data)) return data[0]?.exam_date ?? null;
      return data?.exam_date ?? null;
    } catch { return null; }
  }

  function setBusy(b) {
    [elForm, btnSave, btnClear, elInput].forEach(n => {
      if (!n) return;
      if (b) n.setAttribute('aria-busy','true'); else n.removeAttribute('aria-busy');
      if (n.tagName === 'BUTTON') n.disabled = !!b;
    });
  }

  async function initExamCountdown() {
    // 初期ロード
    const current = await fetchExamDate();
    if (current) elInput.value = current;
    updateDisplay(current);

    // JSTの深夜に自動で1日進める
    if (midnightTimer) clearTimeout(midnightTimer);
    midnightTimer = setTimeout(() => {
      updateDisplay(elInput.value || null);
      setInterval(() => updateDisplay(elInput.value || null), 24*60*60*1000);
    }, msUntilNextJSTMidnight());

    // 保存（submit）
    elForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      setBusy(true);
      try {
        const ymd = elInput.value || null;   // 空ならクリア
        await saveExamDate(ymd);
        updateDisplay(ymd);
      } catch (err) {
        console.error('[exam-date save]', err);
        alert('保存に失敗しました。時間をおいて再度お試しください。');
      } finally {
        setBusy(false);
      }
    });

    // クリア
    btnClear.addEventListener('click', async () => {
      setBusy(true);
      try {
        await saveExamDate(null);
        elInput.value = '';
        updateDisplay(null);
      } catch (err) {
        console.error('[exam-date clear]', err);
        alert('クリアに失敗しました。');
      } finally {
        setBusy(false);
      }
    });
  }

  initExamCountdown();  // ここで即実行（外側はすでに DOMContentLoaded 内）

})();


});












