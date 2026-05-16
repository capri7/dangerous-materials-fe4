// /js/mistakes.js
import { supabase } from '/js/supabaseClient.js';

// ===== モード判定（?view=wrong なら「直近誤答モード」） =====
const params = new URLSearchParams(location.search);
const MODE = params.get('view') === 'wrong' ? 'wrong' : 'mistakes';

// ===== サブスク判定（profiles ベース） =====
const ACTIVE_STATUSES = ['active', 'trialing', 'past_due'];
let _subCache = null;

async function fetchProfileSub(userId) {
  const { data, error } = await supabase
    .from('user_profiles')
    .select('subscription_status, current_period_end')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    console.warn('[mistakes] fetchProfileSub error', error);
    return null;
  }
  return data;
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
  const active = await isSubscribed(userId);
  // 有料ユーザーと無料ユーザーでビューを切り替える想定
  return active ? 'user_wrong_latest_all' : 'user_wrong_latest_free_v2';
}

// ===== 設定 =====
const PAGE_SIZE = 30;

// question_id から問題ページ URL を組み立てる
const qMeta = new Map();      // question_id -> { title, headers, fields, subcategory_id, ... }
const subcatMap = new Map();  // subcategory_id -> { name, slug, category_id }
const catMap = new Map();     // category_id    -> { name, slug }

function buildQuestionUrl(id) {
  const meta = qMeta.get(String(id)) || {};

  // 1) questions.headers.url or fields.url があればそれを優先
  const urlFromHeaders = meta.headers?.url || meta.fields?.url;
  if (typeof urlFromHeaders === 'string' && urlFromHeaders.length) {
    const sep = urlFromHeaders.includes('?') ? '&' : '?';
    return `${urlFromHeaders}${sep}mode=review`;
  }

  // 2) category/subcategory の slug があれば、それで推測
  if (meta.category_slug && meta.subcategory_slug) {
    const cat = String(meta.category_slug).replace(/-/g, '_');
    const sub = String(meta.subcategory_slug).replace(/-/g, '_');
    return `/contents/${cat}/${sub}/${encodeURIComponent(id)}.html?mode=review`;
  }

  // 2.5) IDパターンからフォールバック生成
  //    例: Otsux_Prop_Accident_Cases_And_Measures_001
  const s = String(id);
  const m = /^Otsux_([A-Za-z]+)_(.+)_(\d+)$/.exec(s);
  if (m) {
    const key = m[1].toLowerCase(); // law / prop など
    const cat = key === 'law'
      ? 'law'
      : key === 'prop'
        ? 'properties_prevention'
        : null;
    const sub = m[2].toLowerCase().replace(/__+/g, '_');
    if (cat && sub) {
      return `/contents/${cat}/${sub}/${encodeURIComponent(id)}.html?mode=review`;
    }
  }

  // 3) 最終手段
  return `/contents/${encodeURIComponent(id)}.html?mode=review`;
}

// ===== 要素参照 =====
const el = {
  loading:  document.getElementById('loading'),
  error:    document.getElementById('error'),
  empty:    document.getElementById('empty'),
  list:     document.getElementById('mistakes-list'),
  loadMore: document.getElementById('load-more'),
  refresh:  document.getElementById('refresh'),
};

// ===== 状態 =====
let user = null;
let rows = [];
let hasMore = true;
let loading = false;
let offset = 0;

// データソース: 'wrong-view' or 'mistakes-table'
let dataSource = null;

// ===== ユーティリティ =====
const fmtDateTime = (iso) => {
  try {
    return iso ? new Date(iso).toLocaleString('ja-JP') : '';
  } catch {
    return iso || '';
  }
};

const setState = ({ isLoading, isError } = {}) => {
  if (typeof isLoading === 'boolean') {
    loading = isLoading;
    if (el.loading) el.loading.hidden = !isLoading;
  }
  if (typeof isError === 'boolean') {
    if (el.error) el.error.hidden = !isError;
  }
};

const clearList = () => {
  if (el.list) el.list.innerHTML = '';
};

// ===== 認証 =====
async function requireAuth() {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) {
    location.href = '/login.html';
    return null;
  }
  return data.user;
}

// ===== Supabase 取得ローレベル関数 =====
async function fetchMistakesTable({ from, limit }) {
  const { data, error } = await supabase
    .from('mistakes')
    .select('question_id, incorrect_count, last_seen_at')
    .eq('user_id', user.id)
    .order('last_seen_at', { ascending: false })
    .range(from, from + limit - 1);

  if (error) throw error;
  return data || [];
}

async function fetchWrongViewPage({ from, limit }) {
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

// ===== 高レベル: モードに応じてページ取得（フォールバック付き） =====
async function fetchPage({ from = offset, limit = PAGE_SIZE } = {}) {
  // wrong モードのときは、まずビューを試し、ダメなら mistakes テーブルにフォールバック
  if (MODE === 'wrong' && dataSource !== 'mistakes-table') {
    try {
      const page = await fetchWrongViewPage({ from, limit });
      dataSource = 'wrong-view';
      return { rows: page };
    } catch (e) {
      console.warn('[mistakes] wrong-view fetch failed, fallback to mistakes table', e);
      dataSource = 'mistakes-table';
    }
  }

  // 通常モード、またはフォールバック
  const page = await fetchMistakesTable({ from, limit });
  if (!dataSource) dataSource = 'mistakes-table';
  return { rows: page };
}

// ===== 質問メタ情報の補完 =====
async function hydrateQuestionMeta(newRows) {
  const ids = Array.from(
    new Set(
      newRows
        .map((r) => r.question_id)
        .filter((id) => id && !qMeta.has(String(id)))
    )
  );
  if (!ids.length) return;

  try {
    const { data, error } = await supabase
      .from('questions')
      .select('id, title, subcategory_id, headers, fields')
      .in('id', ids);

    if (error) throw error;

    const subIds = new Set();

    (data || []).forEach((row) => {
      qMeta.set(String(row.id), {
        title: row.title ?? '',
        subcategory_id: row.subcategory_id ?? null,
        headers: row.headers ?? null,
        fields: row.fields ?? null,
      });
      if (row.subcategory_id) subIds.add(row.subcategory_id);
    });

    if (!subIds.size) return;

    // subcategories
    const { data: subs, error: subErr } = await supabase
      .from('subcategories')
      .select('id, name, slug, category_id')
      .in('id', Array.from(subIds));

    if (subErr) throw subErr;

    (subs || []).forEach((s) => {
      subcatMap.set(s.id, {
        name: s.name,
        slug: s.slug,
        category_id: s.category_id,
      });
    });

    // categories
    const catIds = Array.from(
      new Set((subs || []).map((s) => s.category_id).filter(Boolean))
    );

    let cats = [];
    if (catIds.length) {
      const { data: catsData, error: catsErr } = await supabase
        .from('categories')
        .select('id, name, slug')
        .in('id', catIds);
      if (catsErr) throw catsErr;
      cats = catsData || [];
    }

    cats.forEach((c) => {
      catMap.set(c.id, {
        name: c.name,
        slug: c.slug,
      });
    });

    // slug を qMeta に反映
    (data || []).forEach((row) => {
      if (!row.subcategory_id) return;
      const sub = subcatMap.get(row.subcategory_id);
      const cat = sub?.category_id ? catMap.get(sub.category_id) : null;
      const meta = qMeta.get(String(row.id));
      if (meta) {
        meta.subcategory_slug = sub?.slug || null;
        meta.category_slug = cat?.slug || null;
      }
    });
  } catch (e) {
    console.warn('[mistakes] hydrateQuestionMeta skipped', e);
  }
}

// ===== 描画 =====
function renderList() {
  const listData = rows;
  if (el.empty) el.empty.hidden = listData.length !== 0 || loading;
  clearList();

  const isWrongView = MODE === 'wrong' && dataSource === 'wrong-view';
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

    let badges = '';
    if (isWrongView) {
      badges = `
        ${catLabel ? `<span class="badge badge-cat">${escapeHtml(catLabel)}</span>` : ''}
        <span class="badge">最新解答: ${fmtDateTime(r.answered_at)}</span>
      `;
    } else {
      badges = `
        ${catLabel ? `<span class="badge badge-cat">${escapeHtml(catLabel)}</span>` : ''}
        <span class="badge">誤答回数: ${r.incorrect_count ?? '-'}</span>
        <span class="badge">最終更新: ${fmtDateTime(r.last_seen_at)}</span>
      `;
    }

    li.innerHTML = `
  <div class="item-main">
    <h3 class="item-title">${escapeHtml(title)}</h3>
    <div class="item-meta">${badges}</div>
  </div>
  <div class="item-cta">
    <a class="btn btn-primary"
       href="${buildQuestionUrl(r.question_id)}"
       aria-label="問題 ${escapeAttr(title)} を再挑戦">
      再挑戦
    </a>
  </div>
`;

    frag.appendChild(li);
  }

  if (el.list) el.list.appendChild(frag);
  if (el.loadMore) el.loadMore.hidden = !hasMore;
}

// エスケープ
function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
function escapeAttr(s) {
  return escapeHtml(s).replaceAll('\n', ' ');
}

// ===== 初期化 =====
async function init() {
  setState({ isLoading: true, isError: false });

  try {
    user = await requireAuth();
    if (!user) return;

    rows = [];
    offset = 0;
    hasMore = true;
    dataSource = null;
    qMeta.clear();

    const { rows: firstPage } = await fetchPage({ from: 0, limit: PAGE_SIZE });
    rows = firstPage;
    hasMore = firstPage.length === PAGE_SIZE;
    offset = firstPage.length;

    await hydrateQuestionMeta(firstPage);
    renderList();
  } catch (e) {
    console.error('[mistakes] init error', e);
    setState({ isError: true });
  } finally {
    setState({ isLoading: false });
  }
}

// ===== イベント =====
el.refresh?.addEventListener('click', async () => {
  if (loading) return;
  setState({ isLoading: true, isError: false });

  try {
    rows = [];
    offset = 0;
    hasMore = true;
    dataSource = null;
    qMeta.clear();

    const { rows: page } = await fetchPage({ from: 0, limit: PAGE_SIZE });
    rows = page;
    hasMore = page.length === PAGE_SIZE;
    offset = page.length;

    await hydrateQuestionMeta(page);
    renderList();
  } catch (e) {
    console.error('[mistakes] refresh error', e);
    setState({ isError: true });
  } finally {
    setState({ isLoading: false });
  }
});

el.loadMore?.addEventListener('click', async () => {
  if (!hasMore || loading) return;
  setState({ isLoading: true, isError: false });

  try {
    const { rows: page } = await fetchPage({ from: offset, limit: PAGE_SIZE });
    rows = rows.concat(page);
    hasMore = page.length === PAGE_SIZE;
    offset += page.length;

    await hydrateQuestionMeta(page);
    renderList();
  } catch (e) {
    console.error('[mistakes] loadMore error', e);
    setState({ isError: true });
  } finally {
    setState({ isLoading: false });
  }
});



// ===== 実行 =====
document.addEventListener('DOMContentLoaded', init);
