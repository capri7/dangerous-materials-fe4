// /js/dataLoader.js ーー Supabase対応 完全置換版
import { supabase } from '/js/supabaseClient.js';

/** 現在ページのファイル名(ID)を取得（例: Otsux_Law_Designated_Quantities_002） */
function extractFilenameFromUrl() {
  return window.location.pathname.split('/').pop().replace(/\.html$/, '');
}

/** 問題データを Supabase から取得（JSON は参照しない） */
console.log('[DQ4] → dataLoader.js is loaded')//追加ログ
export async function fetchQuestionData() {
  const id = extractFilenameFromUrl();
  console.log('[DQ4] fetchQuestionData id=', id); // ← 追加ログ①
  if (!id) throw new Error('問題IDが取得できませんでした');

  const { data, error } = await supabase
    .from('questions')                 // ← テーブル名
    .select('*')                       // 必要に応じて列を絞る
    .eq('id', id)
    .single();
  if (error) { console.error('[DQ4] fetchQuestionData error', error); throw error; } // ← 追加ログ②
  console.log('[DQ4] fetchQuestionData ok ->', data?.id);       // ← 追加ログ③
  return data;                         // そのまま返す（title, question, choices, explanation 等）
}

// いまある getNextSubcategoryId をこの実装に置き換え
async function getNextSubcategoryId(currentSubId) {
  // いまいる小分野の category_id と order を取得
  const { data: cur, error: curErr } = await supabase
    .from('subcategories')
    .select('id, "order", category_id')
    .eq('id', currentSubId)
    .single();
  if (curErr || !cur) return null;

  // 同じカテゴリの中で、次に大きい order の小分野を1件
  const { data: next, error: nextErr } = await supabase
    .from('subcategories')
    .select('id, "order"')
    .eq('category_id', cur.category_id)
    .gt('order', cur.order ?? 0)
    .order('order', { ascending: true })
    .limit(1);

  if (nextErr) return null;
  return next?.[0]?.id ?? null;
}

/** 章トップへの戻りURL（従来互換） */
export function getSectionTopUrl() {
  const parts = window.location.pathname.split('/');
  parts.pop(); // ファイル名
  if (parts[parts.length - 1] === 'questions') parts.pop();
  return parts.join('/') + '/';
}


// 質問IDから正しいコンテンツパス "categorySlug/subcategorySlug" を返す
export async function getCategoryPath(questionId) {
  // 質問 -> 小分野(slug) -> 分野(slug) を辿って取得
  const { data, error } = await supabase
    .from('questions')
    .select(`
      id,
      subcategories:subcategory_id (
        slug,
        categories:category_id ( slug )
      )
    `)
    .eq('id', questionId)
    .single();

    // "kebab-case" → "snake_case"
    const toSnake = (s) => (s || '').trim().toLowerCase().replace(/-/g, '_');

    if (!error && data?.subcategories?.categories) {
      const cat = toSnake(data.subcategories.categories.slug);
      const sub = toSnake(data.subcategories.slug);
      if (cat && sub) return `${cat}/${sub}`;
    }

    // ── 2) フォールバック: questionId から推定（例: Otsux_Phy_Types_of_Combustion_001）
    const parts = String(questionId).split('_');
    const main = (parts[1] || '').toLowerCase(); // phy, law など
    const sub  = parts.slice(2, -1).map(s => s.toLowerCase()).join('_');

    // 必要ならここで main のマッピングを追加（例）
    const mainMap = { law: 'law', phy: 'physical_chemistry', prop: 'properties_prevention' };
    const cat = mainMap[main] || main;

    return `${cat}/${sub}`;
  }


// --- ここから追記 ---

// URLのモード (?mode=free / ?mode=all)
export function getUIMode() {
  const m = new URLSearchParams(location.search).get('mode');
  return m === 'free' || m === 'all' ? m : null;
}

// 有料会員判定（user_profiles 準拠に統一）
export async function isPaidUser() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;

  const { data, error } = await supabase
    .from('user_profiles')
    .select('subscription_status, current_period_end')
    .eq('user_id', user.id)
    .maybeSingle();

  if (error || !data) return false;

  // 期限が未来なら有効（解約予約でも期間内はOK）
  const exp = data.current_period_end && Date.parse(data.current_period_end);
  if (Number.isFinite(exp) && exp + 60_000 > Date.now()) return true;

  const status = String(data.subscription_status || '').toLowerCase();
  return ['active', 'trialing', 'past_due'].includes(status);
}


// 現在行のカーソル（同一 subcategory 内で並び替えるため）
async function getCursor(currentId) {
  const { data, error } = await supabase
    .from('questions')
    .select('subcategory_id, "order"')   // order は予約語なので "order"
    .eq('id', currentId)
    .single();
    if (error || !data) { console.error('[DQ4] getCursor error', error, data); return null; } // ← 追加⑤  
  return { subcategory_id: data.subcategory_id, order: data.order };
}

// 全問題で「次」：同小分野の次 → 無ければ次の小分野の先頭
export async function getNextAnyQuestionId(currentId) {
  const cur = await getCursor(currentId);
  if (!cur) return null;

  // 同じ小分野内の次を探す
  const { data } = await supabase
    .from('questions')
    .select('id, "order"')
    .eq('subcategory_id', cur.subcategory_id)
    .order('order', { ascending: true });

  const sameNext = (data || []).find(r => (r.order ?? 0) > (cur.order ?? 0));
  if (sameNext) return sameNext.id;

  // 見つからなければ「次の小分野」の先頭へ
  const nextSub = await getNextSubcategoryId(cur.subcategory_id);
  if (!nextSub) return null;

  const { data: first } = await supabase
    .from('questions')
    .select('id, "order"')
    .eq('subcategory_id', nextSub)
    .order('order', { ascending: true })
    .limit(1);

  return first?.[0]?.id ?? null;
}


// 無料だけで「次」— コース横断で次IDを返す
export async function getNextFreeQuestionId(currentId) {
  const ids = await getOrderedFreeQuestionIds();    // 32問の並び（分野横断）
  const cur  = String(currentId || '');
  const idx  = ids.indexOf(cur);
  if (idx === -1) {
    console.warn('[DQ4] currentId not in free-list:', cur);
    return ids[0] ?? null;
  }
  return ids[idx + 1] ?? null;   // 末尾なら null
}


// 有料＝ランダム、無料＝ランダム
export async function getNextForUser(currentId) {
  const orderPref = new URLSearchParams(location.search).get('order');
  if (orderPref === 'linear') {
    // デバッグ/学習モード用に直線順を残す
    return await getNextAnyQuestionId(currentId);
  }

  const mode = getUIMode();            // 'free' | 'all' | null
  const paid = await isPaidUser();

  const includePaid = (mode !== 'free') && !!paid;   // true=全体, false=無料のみ

  // ① まずは未解答だけをサーバーで抽出（RPC）
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data, error } = await supabase.rpc('pick_next_question', {
        p_user_id: user.id,
        p_include_paid: includePaid
      });
      if (!error) {
        const nextId = Array.isArray(data) ? data[0]?.id : data?.id ?? null;
        if (nextId) return nextId;
        // 追加: free が尽きたとき、課金中ならもう一度 paid を含めて試す
        if (!includePaid && paid) {
          const r2 = await supabase.rpc('pick_next_question', {
            p_user_id: user.id,
            p_include_paid: true,
          });
          const next2 = Array.isArray(r2.data) ? r2.data[0]?.id : r2.data?.id ?? null;
          if (next2) return next2;
        }        
      } else {
        console.warn('pick_next_question RPC error', error);
      }
    }
  } catch (e) {
    console.warn('pick_next_question RPC exception', e);
  }

  // ② フォールバック：フロント側の未解答優先ロジック
  // free が尽きたら、課金中は all に自動拡張
  const scope = includePaid ? 'all' : 'free';
  return await getNextRandomQuestionId(currentId, scope);

} 

// ★★★ ここからはトップレベルに配置（getNextForUser の外）★★★
// 文字列に統一して Set を作る
async function getAnsweredSetForUser(questionIds) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !questionIds?.length) return new Set();
  const { data, error } = await supabase
    .from('user_progress')
    .select('question_id')
    .eq('user_id', user.id)
    .in('question_id', questionIds);
  if (error) { console.error('[DQ4] getAnsweredSetForUser error', error); return new Set(); }
  return new Set((data || []).map(r => String(r.question_id)));
}

// scope: 'free'（無料のみ） | 'all'（全件）
async function getQuestionPoolIds(scope = 'all') {
  const query = supabase.from('questions').select('id').order('id', { ascending: true });
  const { data, error } = (scope === 'free')
    ? await query.eq('is_paid', false)
    : await query;

  if (error || !data?.length) {
    console.error('[DQ4] getQuestionPoolIds error', error);
    return [];
  }
  return data.map(r => r.id);
}


export async function getOrderedQuestionIdsBySubcategory(subcategoryId) {
  const { data, error } = await supabase
    .from('questions')
    .select('id')
    .eq('subcategory_id', subcategoryId)
    .order('order', { ascending: true });

  if (error) {
    console.error('getOrderedQuestionIdsBySubcategory', error);
    return [];
  }
  return (data || []).map(r => r.id);
}


// そのサブカテゴリで「続きから」行くべきIDを返す
export async function getResumeForUserInSubcategory(subcategoryId) {
  const ids = await getOrderedQuestionIdsBySubcategory(subcategoryId);
  if (ids.length === 0) return null;

  // 未ログインなら、とりあえず1問目へ
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return ids[0];

  // その章でユーザーが回答した question_id を取得
  const { data: answered, error } = await supabase
    .from('user_progress')
    .select('question_id, answered_at')
    .in('question_id', ids)
    .eq('user_id', user.id);

  if (error) { console.error('getResumeForUserInSubcategory answered', error); return ids[0]; }

  const answeredSet = new Set((answered || []).map(r => r.question_id));
  const next = ids.find(id => !answeredSet.has(id));
  return next || ids[0]; // 全問済みなら1問目（復習）へ
}

// 小さな表示用：最後に回答した問題と時刻（任意）
export async function getLastAnsweredInSubcategory(subcategoryId) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  // subcategory の問題IDを取得してから .in(...) に渡す
  const ids = await getOrderedQuestionIdsBySubcategory(subcategoryId);
  if (!ids.length) return null;

  const { data, error } = await supabase
    .from('user_progress')
    .select('question_id, answered_at')
    .eq('user_id', user.id)
    .in('question_id', ids)
    .order('answered_at', { ascending: false })
    .limit(1);

  return (error || !data?.length) ? null : data[0];
}

// --- 無料コースでユーザーが最後に解いた問題（なければ null） ---
export async function getLastAnsweredInFreeCourse() {
  const ids = await getOrderedFreeQuestionIds();
  if (!ids.length) return null;

  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return null;

  const { data, error } = await supabase
    .from('user_progress')
    .select('question_id, answered_at')
    .eq('user_id', user.id)
    .in('question_id', ids)
    .order('answered_at', { ascending: false })
    .limit(1);

  if (error || !data || !data.length) return null;
  return data[0]; // { question_id, answered_at }
}

// --- 無料コースの「続きから」用：次に開くIDと最後の記録を返す ---
export async function getResumeForFreeCourse() {
  const ids = await getOrderedFreeQuestionIds();
  if (!ids.length) return { next: null, last: null };

  const last = await getLastAnsweredInFreeCourse();
  if (!last) return { next: ids[0], last: null };

  const idx = ids.indexOf(last.question_id);
  const next = (idx >= 0 && idx + 1 < ids.length) ? ids[idx + 1] : ids[idx] ?? ids[0];
  return { next, last };
}

// 乱数（決定論的）: mulberry32
function mulberry32(a) {
  return function() {
    let t = a += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// 文字列→数値ハッシュ（簡易）
function cyrb53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i=0, ch; i<str.length; i++) {
    ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1>>>16), 2246822507) ^ Math.imul(h2 ^ (h2>>>13), 3266489909);
  h2 = Math.imul(h2 ^ (h2>>>16), 2246822507) ^ Math.imul(h1 ^ (h1>>>13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1>>>0);
}

// ★ seededShuffle の上でも下でもOK。どこか1か所だけに追加。
function todayLocalYYYYMMDD() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}


// 決定論的シャッフル
function seededShuffle(arr, seedStr) {
  const seed = cyrb53(seedStr);
  const rand = mulberry32(seed);
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ← 2正: 直前のIDから“次”に回す & 未回答優先
export async function getNextRandomQuestionId(currentId, scope = 'all') {
  const cur = String(currentId ?? '');
  const { data: { user } } = await supabase.auth.getUser();
  const paidUser = user ? await isPaidUser() : false;
  if (!user) return null;

  const allIdsRaw = await getQuestionPoolIds(scope);
  const allIds = (allIdsRaw || []).map(String);
  if (!allIds.length) return null;

  const answered = await getAnsweredSetForUser(allIds);

  const today = todayLocalYYYYMMDD();
  const deck = seededShuffle(allIds, `${user.id}|${today}|${scope}`);

  const pos = deck.indexOf(cur);
  const rotated = (pos >= 0) ? deck.slice(pos + 1).concat(deck.slice(0, pos)) : deck;

  const next = rotated.find(id => !answered.has(id)) ?? rotated[0] ?? null;
  if (!next && scope === 'free') {
    if (paidUser) {
      return await getNextRandomQuestionId(currentId, 'all');
    }
  }
  return next;

}

// 2 無料横断の並び（分野→小分野→問題）※既に別所にあれば重複させずにそれを使う
export async function getOrderedFreeQuestionIds() {
  const { data: cats } = await supabase.from('categories').select('id, "order"');
  const catOrderMap = new Map((cats || []).map(c => [c.id, c.order ?? 9999]));

  const { data: subs } = await supabase.from('subcategories').select('id, "order", category_id');
  const subInfoMap = new Map((subs || []).map(s => [s.id, { order: s.order ?? 9999, category_id: s.category_id }]));

  const { data: qs } = await supabase
    .from('questions')
    .select('id, subcategory_id, "order", is_paid')
    .eq('is_paid', false);

  return (qs || [])
    .sort((a, b) => {
      const sa = subInfoMap.get(a.subcategory_id) || {};
      const sb = subInfoMap.get(b.subcategory_id) || {};
      const coA = catOrderMap.get(sa.category_id) ?? 9999;
      const coB = catOrderMap.get(sb.category_id) ?? 9999;
      if (coA !== coB) return coA - coB;
      if ((sa.order ?? 0) !== (sb.order ?? 0)) return (sa.order ?? 0) - (sb.order ?? 0);
      return (a.order ?? 0) - (b.order ?? 0);
    })
    .map(r => r.id);
}


