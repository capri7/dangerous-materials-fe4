// /js/mistakes.js
import { supabase } from '/js/supabaseClient.js';

const subcatMap = new Map();   // subcategory_id -> { name, category_id }
const catMap = new Map();      // category_id    -> { name }  ※あれば使う

// ページ先頭の import 群の直後あたりに
const params = new URLSearchParams(location.search);
const MODE = params.get('view') === 'wrong' ? 'wrong' : 'mistakes';


// --- subscriptions helpers (profiles-based) ---
const ACTIVE_STATUSES = ['active', 'trialing', 'past_due'];
let _subCache = null;

async function fetchProfileSub(userId) {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('subscription_status, current_period_end')
    .eq('user_id', userId)
    .maybeSingle();
  return error ? null : data;
}

function isSubscriptionActive(row) {
  if (!row) return false;
  const status = String(row.subscription_status || '').toLowerCase();
  if (!ACTIVE_STATUSES.includes(status)) return false;
  const exp = row.current_period_end;
  if (!exp) return true;
  const t = new Date(exp).getTime();

  return Number.isFinite(t) && (t + 60_000) > Date.now(); // 60秒グレース
}

async function isSubscribed(userId) {
  if (_subCache?.userId === userId && _subCache?.checkedAt > Date.now() - 30_000) {
    return _subCache.active;
  }
  const row = await fetchProfileSub(userId);
  const active = isSubscriptionActive(row);
  _subCache = { userId, active, checkedAt: Date.now() };
  return active;
}

async function pickWrongView(userId) {
  return (await isSubscribed(userId)) ? 'user_wrong_latest_all' : 'user_wrong_latest_free_v2';
}

// ====== 設定 ======
const PAGE_SIZE = 30;                         // 1ページの件数
function buildQuestionUrl(id) {
  const meta = qMeta.get(String(id)) || {};
  // 1) questions.headers.url or fields.url にURLがあれば最優先で使う
  const urlFromHeaders = meta.headers?.url || meta.fields?.url;
  if (typeof urlFromHeaders === 'string' && urlFromHeaders.length) {
    const sep = urlFromHeaders.includes('?') ? '&' : '?';
    return `${urlFromHeaders}${sep}mode=review`;
  }
  // 2) category/subcategory の slug が取れていれば推測で組み立て
  if (meta.category_slug && meta.subcategory_slug) {
    const cat = String(meta.category_slug).replace(/-/g, '_');
    const sub = String(meta.subcategory_slug).replace(/-/g, '_');
    return `/contents/${cat}/${sub}/${encodeURIComponent(id)}.html?mode=review`;
  }

  // 2.5) フォールバック：IDからカテゴリとサブトピックを導出
  // 例) Otsux_Prop_Accident_Cases_And_Measures_001
  //     -> /contents/properties_prevention/accident_cases_and_measures/<id>.html
  const s = String(id);
  const m = /^Otsux_([A-Za-z]+)_(.+)_(\d+)$/.exec(s);
  if (m) {
    const key = m[1].toLowerCase();               // law / prop など
    const cat = key === 'law' ? 'law'
              : key === 'prop' ? 'properties_prevention'
              : null;
    const sub = m[2].toLowerCase().replace(/__+/g,'_'); // サブトピック（大文字→小文字）
    if (cat && sub) {
      return `/contents/${cat}/${sub}/${encodeURIComponent(id)}.html?mode=review`;
    }
  }
  // 3) フォールバック（最終手段）
  return `/contents/${encodeURIComponent(id)}.html?mode=review`;
}

// ====== 要素参照 ======
const el = {
  loading:   document.getElementById('loading'),
  error:     document.getElementById('error'),
  empty:     document.getElementById('empty'),
  list:      document.getElementById('mistakes-list'),
  loadMore:  document.getElementById('load-more'),
  refresh:   document.getElementById('refresh'),
};

// ====== 状態 ======
let user = null;
let rows = [];                // 取得したmistakesの累積
let hasMore = true;           // 追加ページの有無
let loading = false;
let offset = 0;
const qMeta = new Map();      // question_id -> { title, headers, fields, subcategory_id, category_slug, subcategory_slug }

// ====== ユーティリティ ======
const fmtDateTime = (iso) => {
  try { return new Date(iso).toLocaleString('ja-JP'); }
  catch { return iso || ''; }
};

const setState = ({ isLoading, isError } = {}) => {
  if (typeof isLoading === 'boolean') {
    loading = isLoading;
    el.loading.hidden = !isLoading;
  }
  if (typeof isError === 'boolean') {
    el.error.hidden = !isError;
  }
};

const clearList = () => { el.list.innerHTML = ''; };

// ====== 認証チェック ======
async function requireAuth() {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) {
    location.href = '/login.html';
    return null;
  }
  return data.user;
}

// ====== 取得（ページ分） ======
async function fetchMistakesPage({ from = offset, limit = PAGE_SIZE } = {}) {
  const { data, error } = await supabase
    .from('mistakes')
    .select('question_id, incorrect_count, last_seen_at')
    .eq('user_id', user.id)
    .order('last_seen_at', { ascending: false })
    .range(from, from + limit - 1);

  if (error) throw error;
  return data || [];
}

// fetchWrongPage をビュー切替
async function fetchWrongPage({ from = offset, limit = PAGE_SIZE } = {}) {
  const view = await pickWrongView(user.id);
  const { data, error } = await supabase
    .from(view)
    .select('question_id, answered_at')
    .eq('user_id', user.id)
    .order('answered_at', { ascending: false })
    .range(from, from + limit - 1);
  if (error) throw error;
  return data || [];
}

// ====== 補足メタ（questionsテーブル） ======
async function hydrateQuestionMeta(newRows) {
   const ids = Array.from(new Set(
     newRows.map(r => r.question_id).filter(id => id && !qMeta.has(String(id)))
   ));
   if (ids.length === 0) return;

  try {
    // questions: id(text), title(text), subcategory_id(uuid), headers(jsonb), fields(jsonb)
    const { data, error } = await supabase
      .from('questions')
      .select('id, title, subcategory_id, headers, fields')
      .in('id', ids);
    if (error) throw error;

      const subIds = new Set();
      (data || []).forEach(row => {
        qMeta.set(String(row.id), {
        title: row.title ?? '',
        subcategory_id: row.subcategory_id ?? null,
        headers: row.headers ?? null,
        fields: row.fields ?? null,
      });
      if (row.subcategory_id) subIds.add(row.subcategory_id);
     });
    
    // 任意：サブカテゴリ名を取得（テーブルがある場合）
    if (subIds.size) {
      const { data: subs, error: subErr } = await supabase
        .from('subcategories')                // ある想定。無ければこのブロックは削除
        .select('id, name, slug, category_id')
        .in('id', Array.from(subIds));
       if (!subErr && subs) {
          subs.forEach(s => subcatMap.set(s.id, { name: s.name, slug: s.slug, category_id: s.category_id }));
    }

      const catIds = Array.from(new Set((subs || []).map(s => s.category_id).filter(Boolean)));
      if (catIds.length) {
        const { data: cats } = await supabase
          .from('categories')
          .select('id, name, slug')
          .in('id', catIds);
        (cats || []).forEach(c => catMap.set(c.id, { name: c.name, slug: c.slug }));
      }

      // qMetaへ slug を反映
      (data || []).forEach(row => {
        if (!row.subcategory_id) return;
        const sub = subcatMap.get(row.subcategory_id);
        const cat = sub?.category_id ? catMap.get(sub.category_id) : null;
        const meta = qMeta.get(String(row.id));
        if (meta) {
          meta.subcategory_slug = sub?.slug || null;
          meta.category_slug    = cat?.slug || null;
          qMeta.set(String(row.id), meta);
        }
      });
     }
   } catch (e) {
     console.warn('hydrateQuestionMeta skipped:', e);
   }
 }


// ====== 描画 ======
function renderList() {
  const listData = rows; // フィルタなしでそのまま表示
  el.empty.hidden = listData.length !== 0 || loading;
  clearList();

  const isWrongMode = MODE === 'wrong';
  const frag = document.createDocumentFragment();

  for (const r of listData) {
    const li = document.createElement('li');
    li.className = 'list-item mistake-item';

    const meta = qMeta.get(String(r.question_id));
    const title = meta?.title ? meta.title : `問題ID: ${r.question_id}`;

    // 分野バッジ
    let catLabel = '';
    if (meta?.subcategory_id && subcatMap.has(meta.subcategory_id)) {
      const sub = subcatMap.get(meta.subcategory_id);
      catLabel = sub?.name ? sub.name : '';
    }

    // バッジ（誤答モードは最新解答時刻のみ）
    const badges = isWrongMode
      ? `
          ${catLabel ? `<span class="badge badge-cat">${escapeHtml(catLabel)}</span>` : ''}
          <span class="badge">最新解答: ${fmtDateTime(r.answered_at)}</span>
        `
      : `
          ${catLabel ? `<span class="badge badge-cat">${escapeHtml(catLabel)}</span>` : ''}
          <span class="badge">誤答回数: ${r.incorrect_count}</span>
          <span class="badge">最終更新: ${fmtDateTime(r.last_seen_at)}</span>
        `;

    const removeBtn = isWrongMode
      ? '' // 誤答モードは mistakes テーブルを使わないため削除ボタン非表示
      : `<button type="button" class="btn btn-outline js-remove" data-qid="${escapeAttr(r.question_id)}">削除</button>`;

    li.innerHTML = `
      <div class="item-main">
        <h3 class="item-title">${escapeHtml(title)}</h3>
        <div class="item-meta">${badges}</div>
      </div>
      <div class="item-cta">
        <a class="btn btn-primary" href="${buildQuestionUrl(r.question_id)}" aria-label="問題 ${escapeAttr(title)} を再挑戦">再挑戦</a>
        ${removeBtn}
      </div>
    `;
    frag.appendChild(li);
  }

  el.list.appendChild(frag);
  el.loadMore.hidden = !hasMore;
}


// エスケープ（最低限）
function escapeHtml(s) {
  return String(s)
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'",'&#39;');
}
function escapeAttr(s) { return escapeHtml(s).replaceAll('\n', ' '); }

// ====== 初期化 ======
async function init() {
  setState({ isLoading: true, isError: false });
  try {
    user = await requireAuth();
    if (!user) return;

    // 1ページ目
    const page = await (MODE === 'wrong'
     ? fetchWrongPage({ from: 0, limit: PAGE_SIZE })
     : fetchMistakesPage({ from: 0, limit: PAGE_SIZE }));


    rows = page;
    hasMore = page.length === PAGE_SIZE;
    offset = page.length;

    // 質問メタの取得（任意）
    await hydrateQuestionMeta(page);
    renderList();
  } catch (e) {
    console.error(e);
    setState({ isError: true });
  } finally {
    setState({ isLoading: false });
  }
}


el.refresh?.addEventListener('click', async () => {
  if (loading) return;
  setState({ isLoading: true, isError: false });
  try {
    offset = 0; rows = []; hasMore = true; qMeta.clear();
    const page = await (MODE === 'wrong'
     ? fetchWrongPage({ from: offset, limit: PAGE_SIZE })
     : fetchMistakesPage({ from: offset, limit: PAGE_SIZE }));



    rows = page;
    hasMore = page.length === PAGE_SIZE;
    offset = page.length;
    await hydrateQuestionMeta(page);
    renderList();
  } catch (e) {
    console.error(e);
    setState({ isError: true });
  } finally {
    setState({ isLoading: false });
  }
});

el.loadMore?.addEventListener('click', async () => {
  if (!hasMore || loading) return;
  setState({ isLoading: true, isError: false });
  try {
    const page = await (MODE === 'wrong'
     ? fetchWrongPage({ from: offset, limit: PAGE_SIZE })
     : fetchMistakesPage({ from: offset, limit: PAGE_SIZE }));

    rows = rows.concat(page);
    hasMore = page.length === PAGE_SIZE;
    offset += page.length;
    await hydrateQuestionMeta(page);
    renderList();
  } catch (e) {
    console.error(e);
    setState({ isError: true });
  } finally {
    setState({ isLoading: false });
  }
});

// 追加：削除ボタン（イベント委譲）
if (MODE !== 'wrong') {
  el.list?.addEventListener('click', async (e) => {
    const btn = e.target.closest('.js-remove');
    if (!btn) return;

    const qid = btn.dataset.qid;
    if (!qid || !user) return;

    btn.disabled = true; // 二重押し防止

    try {
      const { error } = await supabase
        .from('mistakes')
        .delete()
        .eq('user_id', user.id)
        .eq('question_id', qid);

      if (error) throw error;

      // DOMとメモリから即時削除
      const li = btn.closest('li');
      if (li) li.remove();
      rows = rows.filter(r => String(r.question_id) !== String(qid));
      offset = Math.max(0, offset - 1);

      // 空表示の切り替え
      el.empty.hidden = rows.length !== 0 || loading;
    } catch (err) {
      console.error('[mistakes] delete failed', err);
      btn.disabled = false;
      alert('削除に失敗しました。時間をおいて再度お試しください。');
    }
  });
}


// ====== 実行 ======
document.addEventListener('DOMContentLoaded', init);
