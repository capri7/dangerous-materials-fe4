// public/js/question-main.js
import { supabase } from '/js/supabaseClient.js';
import { saveProgress } from './progress-writer.js';
import { recordMistake } from '/js/mistakes-rpc.js';

// 解答1回 = 1つのnonce（ブラウザ標準API）
const makeNonce = () => crypto.randomUUID();

let __mistakeInFlight = false;


async function probeExists(url) {
  try {
    const r = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    if (r.ok) return true;
  } catch (_) {}
  try {
    const r2 = await fetch(url, { method: 'GET', cache: 'no-store' });
    return r2.ok;
  } catch (_) {
    return false;
  }
}

(async () => {
  // ---- questionId は URL を唯一の情報源にする ----
  const idFromPath = location.pathname.split('/').pop().replace(/\.html$/, '');
  let currentQuestionId = idFromPath;
  const dataAttr = document.body.dataset.questionId;
  if (dataAttr && dataAttr !== idFromPath) {
    console.warn('[ID] data-question-id mismatch. override with path', { dataAttr, idFromPath });
  }
  // 常に同期（ズレていても上書き）
  document.body.dataset.questionId = idFromPath;
  if (!currentQuestionId) {
    console.error('question-main.js: questionId not found', location.pathname + location.search);
    return;
  }

  const { showToast } = await import('/js/utils.js?v=toast-anchors-3');

  // ---- URL の scope を唯一の情報源とする ----
  function readScopeFromURL() {
    const p = new URLSearchParams(location.search);
    return {
      mode: (p.get('mode') === 'free') ? 'free' : 'all',
      scope: (p.get('scope') || '').trim(),   // 'cat' | 'sub' | 'free' | ''(all)
      sid:   p.get('sid') || null,
      cid:   p.get('cid') || null,
    };
  }

  function seedBackHistoryOnce() {
    try {
      const ref = document.referrer || '';
      const blankRef = ref === '' || ref === 'about:blank';
      const st = history.state || {};
      if (st && st.__seeded) return; // 既に実施済み

      if (blankRef) {
        // 直前履歴が about:blank と推定できる場合は push で 1 件積む
        history.pushState({ ...st, __seeded: true }, '', location.href);
        console.debug('[HIST] push seeded to avoid about:blank on back');
      } else {
        // それ以外は履歴を汚さずフラグだけ立てる
        history.replaceState({ ...st, __seeded: true }, '', location.href);
        console.debug('[HIST] replace mark as seeded');
      }
    } catch (_) {}
  }
seedBackHistoryOnce();

  function buildSiblingUrl(nextId, qs) {
    const dir = location.pathname.replace(/\/[^\/]+\.html(?:$|\?.*)/, '');
    return `${dir}/${nextId}.html?${qs.toString()}${location.hash || ''}`;
  }

// --- 初期クリックの取りこぼし対策（キュー & 早期キャプチャ）---
let __queuedNextClick = false;
let __navigated = false;       // ← 早期で遷移済みなら本体は何もしない
let navInFlight = false;


// 早期スタブ：cat だけは“同ディレクトリの連番→なければ001”で即遷移
let goNext = async (src = 'early-stub') => {
  if (__navigated) return;

  const { mode, scope } = readScopeFromURL();
  if (scope === 'cat') {
    const m = String(currentQuestionId).match(/^(.*_)(\d+)$/);
    if (m) {
      const [, pre, numStr] = m;
      const width = numStr.length;
      const qs = new URLSearchParams(location.search);
      qs.set('mode', mode === 'all' ? 'all' : 'free');

      // まずは +1 候補（存在すればそれへ）
      const nextNum = String(parseInt(numStr, 10) + 1).padStart(width, '0');
      const urlNext = buildSiblingUrl(pre + nextNum, qs);
      if (await probeExists(urlNext)) {
        __navigated = true;
        location.assign(urlNext);
        return;
      }

      // 無ければ 001 にラップ
      const url001 = buildSiblingUrl(pre + '1'.padStart(width, '0'), qs);
      __navigated = true;
      location.assign(url001);
      return;
    }
  }

  // cat 以外は後で本体に渡す
  __queuedNextClick = true;
};

// 早期キャプチャ：必ずこちらが先に受け取り、自前で遷移まで持っていく
document.addEventListener('click', (e) => {
  const btn = e.target?.closest?.('#btn-next');
  if (!btn) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  goNext('early-capture');
}, { capture: true });


  async function resolveCurrentCid() {
    try {
      const { data: q } = await supabase
        .from('questions')
        .select('subcategory_id')
        .eq('id', currentQuestionId)
        .maybeSingle();
      if (!q?.subcategory_id) return null;

      const { data: sc } = await supabase
        .from('subcategories')
        .select('category_id')
        .eq('id', q.subcategory_id)
        .maybeSingle();
      return sc?.category_id ?? null;
    } catch (e) {
      console.warn('[resolveCurrentCid] failed', e);
      return null;
    }
  }

  // ★ recordProgress 等が参照する可能性があるキーを同期
  const SCOPE_KEYS = ['practice_scope_v1', 'practice_scope'];
  function syncScopeLockFromURL() {
    const { scope, sid, cid } = readScopeFromURL();
    const payload = scope ? JSON.stringify({ scope, sid, cid }) : null;
    try {
      for (const k of SCOPE_KEYS) {
        if (payload) {
          sessionStorage.setItem(k, payload);
          localStorage.setItem(k, payload);
        } else {
          sessionStorage.removeItem(k);
          localStorage.removeItem(k);
        }
      }
    } catch (_) {}
  }

  function readScopeLock() {
  try {
    for (const k of SCOPE_KEYS) {
      const v = sessionStorage.getItem(k) || localStorage.getItem(k);
      if (v) return JSON.parse(v);
    }
  } catch (_) {}
  return null;
}


  // ---- 依存（※一度だけ）----
  const {
    fetchQuestionData,
    getNextForUser,
    getCategoryPath,
    getNextRandomQuestionId,
    getOrderedFreeQuestionIds,   // ★追加：厳選32問
  } = await import('/js/dataLoader.js?v=dl-6');
  const { getSectionTopUrl } = await import('/js/dataLoader.js?v=dl-6');
  const { renderTable } = await import('/js/renderTable.js?v=rt-1');
  const { attachEventHandlers } = await import('/js/eventHandlers.js?v=evh-4');

  // ---- プール作成（URL 準拠）----
  async function getScopedPoolIds(includePaid) {
    const { scope, sid } = readScopeFromURL();
    console.info('[POOL]', { scope, sid, includePaid });

    const base = supabase.from('questions').select('id').order('id', { ascending: true });

    // ★ 練習（無料32問）：URLが ?scope=free のときは厳選32問だけ
    if (scope === 'free') {
      try {
        const ids = await getOrderedFreeQuestionIds();
        return (ids || []).map(String);
      } catch (e) {
        console.warn('[POOL/free] fallback to is_paid=false', e);
        const { data } = await supabase
          .from('questions').select('id')
          .eq('is_paid', false).order('id', { ascending: true });
        return (data || []).map(r => String(r.id));
      }
    }

    // sub 固定
    if (scope === 'sub' && sid) {
      let q = base.eq('subcategory_id', sid);
      if (!includePaid) q = q.eq('is_paid', false);
      const { data, error } = await q;
      if (error) { console.warn('[POOL/sub] error', error); return []; }
      let ids = (data || []).map(r => String(r.id));

      // 同じシリーズ（…_001, …_002, …）に限定
      const curPrefix = String(currentQuestionId).replace(/_\d+$/, '_');
      const sameGroup = ids.filter(id => id.startsWith(curPrefix));
      if (sameGroup.length) ids = sameGroup;

      // 数値サフィックスで昇順に正規化
      ids.sort((a, b) => {
        const na = parseInt(a.match(/_(\d+)$/)?.[1] || '0', 10);
        const nb = parseInt(b.match(/_(\d+)$/)?.[1] || '0', 10);
        return na - nb;
      });
      console.info('[POOL/sub]', { sid, ids });
      return ids;
    }

    // cat 固定：現在設問の実カテゴリから束ねる
    if (scope === 'cat') {
      let ids = [];
      try {
        const { data: qrow } = await supabase
          .from('questions').select('subcategory_id').eq('id', currentQuestionId).maybeSingle();
        const subId = qrow?.subcategory_id || null;
        if (subId) {
          const { data: sc } = await supabase
            .from('subcategories').select('category_id').eq('id', subId).maybeSingle();
          const realCid = sc?.category_id || null;
          if (realCid) {
            const { data: subs } = await supabase
              .from('subcategories').select('id').eq('category_id', realCid);
            const subIds = (subs || []).map(s => s.id);
            if (subIds.length) {
              let q = supabase.from('questions').select('id')
                .in('subcategory_id', subIds).order('id', { ascending: true });
              if (!includePaid) q = q.eq('is_paid', false);
              const { data } = await q;
              ids = (data || []).map(r => String(r.id));
            }
          }
        }
      } catch (_) {
        // RLS等で読めない場合は無音
      }

      // 取れなかったら ID 接頭辞でフォールバック
      if (ids.length === 0) {
        const prefix = String(currentQuestionId).replace(/_\d+$/, '_');
        let q2 = supabase.from('questions').select('id').ilike('id', `${prefix}%`).order('id', { ascending: true });
        if (!includePaid) q2 = q2.eq('is_paid', false);
        const { data: rows2 } = await q2;
        ids = (rows2 || []).map(r => String(r.id));
      }

      // 同じ接頭辞（同ディレクトリ相当）に限定
      const curPrefix = String(currentQuestionId).replace(/_\d+$/, '_');
      const sameGroup = ids.filter(id => id.startsWith(curPrefix));
      if (sameGroup.length) ids = sameGroup;

      // 末尾番号で数値昇順（001, 002, …）
      ids.sort((a, b) => {
        const na = parseInt(a.match(/_(\d+)$/)?.[1] || '0', 10);
        const nb = parseInt(b.match(/_(\d+)$/)?.[1] || '0', 10);
        return na - nb;
      });

      return ids;
    }

    // ★ 有料会員の全体練習（scope=''）
    if (!scope && includePaid) {
      const { data, error } = await base;
      if (error) { console.warn('[POOL/all] error', error); return []; }
      return (data || []).map(r => String(r.id));
    }

    // 万一 scope='' かつ includePaid=false で来た場合の保険（無料だけ）
    const { data } = await supabase
      .from('questions').select('id')
      .eq('is_paid', false).order('id', { ascending: true });
    return (data || []).map(r => String(r.id));
   }

   // ガードの多重遷移防止
   let __guardNavigating = false;

  // === ページが URL のスコープ外なら即補正するガード ===
  async function redirectToInScope() {
    if (__guardNavigating) return;
    __guardNavigating = true;
    const { mode, scope } = readScopeFromURL();
    let { cid, sid } = readScopeFromURL();
    const includePaid = (mode === 'all');

    // cat で cid が無ければ自己修復
    if (scope === 'cat' && !cid) {
      cid = await resolveCurrentCid();
      if (cid) {
        const u = new URL(location.href);
        u.searchParams.set('cid', cid);
        history.replaceState(null, '', u.toString());
      }
    }

    const poolIds = await getScopedPoolIds(includePaid);
    if (!poolIds.length) { __guardNavigating = false; return; }

    const nextId = poolIds[Math.floor(Math.random() * poolIds.length)];
    const path = await getCategoryPath(nextId);

    const qs = new URLSearchParams();
    qs.set('mode', includePaid ? 'all' : 'free');
    if (scope === 'sub' && sid) { qs.set('scope', 'sub'); qs.set('sid', sid); }
    else if (scope === 'cat' && cid) { qs.set('scope', 'cat'); qs.set('cid', cid); }
    else if (scope === 'free') { qs.set('scope', 'free'); }

    const parts = location.pathname.split('/');
    const i = parts.indexOf('contents');
    const base = (i >= 0 ? parts.slice(0, i + 1).join('/') : '/contents');


    const url = `${base}/${path}/${nextId}.html?${qs.toString()}${location.hash || ''}`;
    console.info('[GUARD] redirectToInScope ->', nextId, url);

    // ★ 履歴を増やさずに置き換えることで「戻る」ループを遮断
    if (url !== location.href) {
      location.replace(url);
    }
    __guardNavigating = false;
  }

  async function ensurePageInScope() {  
    let { scope, sid, cid } = readScopeFromURL();

    // ★ back直後で ?scope= が消えていたら、直前のロックから復元
    if (!scope) {
      const lock = readScopeLock();
      if (lock?.scope) {
        const u = new URL(location.href);
        u.searchParams.set('scope', lock.scope);
        if (lock.scope === 'sub' && lock.sid) u.searchParams.set('sid', lock.sid);
        if (lock.scope === 'cat' && lock.cid) u.searchParams.set('cid', lock.cid);
        history.replaceState(null, '', u.toString()); // ここでは遷移しない
        scope = lock.scope;
        sid   = lock.sid ?? sid;
        cid   = lock.cid ?? cid;
      } else {
        // 本当にスコープ無し=全体
        return;
      }
    }


    // cat なのに cid が無ければ現在ページから補完（URLを書き換えるだけ）
    if (scope === 'cat' && !cid) {
      const fixed = await resolveCurrentCid();
      if (fixed) {
        const u = new URL(location.href);
        u.searchParams.set('cid', fixed);
        history.replaceState(null, '', u.toString());
        cid = fixed;
      }
    }

    try {
      // 今のページがどの小分野か確認
      const { data: q } = await supabase
        .from('questions')
        .select('subcategory_id, is_paid')
        .eq('id', currentQuestionId)
        .maybeSingle();
      if (!q) return;

      // sub 固定
      if (scope === 'sub' && sid && String(q.subcategory_id) !== String(sid)) {
        return redirectToInScope();
      }

      // free 固定（有料が混ざったら戻す）
      if (scope === 'free' && q.is_paid) {
        return redirectToInScope();
      }
    } catch (e) {
      console.warn('[GUARD] ensurePageInScope failed', e);
    }
  }

  window.addEventListener('popstate', async () => {
    console.info('[POPSTATE]', { href: location.href, state: history.state });
  let { scope, sid, cid } = readScopeFromURL();
  if (!scope) {
    const lock = readScopeLock();
    if (lock?.scope) {
      const u = new URL(location.href);
      u.searchParams.set('scope', lock.scope);
      if (lock.scope === 'sub' && lock.sid) u.searchParams.set('sid', lock.sid);
      if (lock.scope === 'cat' && lock.cid) u.searchParams.set('cid', lock.cid);
      history.replaceState(null, '', u.toString());
    }
  }

  // ★ 描画前に 1回だけチェック（もし迷い込んでいれば即補正）
  await ensurePageInScope();

});

  syncScopeLockFromURL();

  // ---- データ取得＆描画 ----
  const data = await fetchQuestionData();
  console.log('[PAGE]', currentQuestionId, location.pathname + location.search);
  console.log('[DATA]', data);

  let container = document.getElementById('choices');
  if (!container) {
    const main = document.querySelector('main.site-main') || document.body;
    container = document.createElement('div');
    container.id = 'choices';
    main.appendChild(container);
  }
  container.innerHTML = '';

  function setChoicesHeader(tableEl, data) {
    const thead = tableEl?.querySelector('thead');
    if (!thead) return;
    const ths = Array.from(thead.querySelectorAll('th'));
    if (ths.length <= 1) return;
    const headers = Array.isArray(data?.headers) ? data.headers : (data?.headers ? [data.headers] : []);
    const fields  = Array.isArray(data?.fields)  ? data.fields  : [];
    const labels = (headers.length ? headers : ['選択肢'])
      .slice(0, Math.max(1, fields.length))
      .map(h => (typeof h === 'string' || typeof h === 'number') ? String(h)
                : (h?.choices ?? h?.choice ?? h?.label ?? h?.title ?? h?.name ?? '選択肢'));
    for (let i = 0; i < labels.length && i + 1 < ths.length; i++) ths[i + 1].textContent = labels[i];
  }

  let table;
  try {
    table = renderTable(data);
  } catch (e) {
    console.warn('renderTable failed', e, data);
    const pre = document.createElement('pre');
    pre.style.whiteSpace = 'pre-wrap';
    pre.style.font = '12px/1.5 ui-monospace, monospace';
    pre.textContent = 'データ構造エラー。受け取ったデータ:\n\n' + JSON.stringify(data, null, 2);
    container.appendChild(pre);
    return;
  }
  container.appendChild(table);
  setChoicesHeader(table, data);

  const titleEl = document.getElementById('title');
  if (titleEl && data.title) titleEl.textContent = data.title;

  const qEl = document.getElementById('question');
  if (qEl) {
    qEl.classList.add('question-body');
    qEl.textContent = String(data.question ?? '').replace(/\r\n?/g, '\n');
  }

// === goNext 本体（ここでスタブを上書き） ===
goNext = async function (source = 'manual') {
  if (__navigated) return;      // 早期で飛んでたら何もしない
  if (navInFlight) return;
  navInFlight = true;
  console.debug('[NEXT] start', { source, href: location.href });

  syncScopeLockFromURL();

  const btn = document.getElementById('btn-next');
  if (btn) btn.disabled = true;

  try {
    const { mode, scope } = readScopeFromURL();
    const includePaid = (mode === 'all');
    const cur = String(currentQuestionId);

    // --- cat 高速パス：同ディレクトリの連番へ（無ければ001にラップ） ---
    if (scope === 'cat') {
      const m = cur.match(/^(.*_)(\d+)$/);
      if (m) {
        const [, pre, numStr] = m;
        const width = numStr.length;
        const qs = new URLSearchParams(location.search);
        qs.set('mode', includePaid ? 'all' : 'free');

        // まず +1 を試す
        const nextNum = String(parseInt(numStr, 10) + 1).padStart(width, '0');
        const urlNext = buildSiblingUrl(pre + nextNum, qs);
        if (await probeExists(urlNext)) {
          __navigated = true;
          console.info('[NEXT] goto(sibling-fast,next)', pre + nextNum);
          location.assign(urlNext);
          return;
        }

        // 無ければ 001
        const url001 = buildSiblingUrl(pre + '1'.padStart(width, '0'), qs);
        __navigated = true;
        console.info('[NEXT] goto(sibling-fast,wrap->001)', pre + '1'.padStart(width, '0'));
        location.assign(url001);
        return;
      }
      // 連番でないIDなら以下の従来ロジックにフォールバック
    }

    // --- 従来ロジック（プール→candidate→遷移） ---
    const poolIds = await getScopedPoolIds(includePaid);
    console.debug('[NEXT] pool', {
      cur, scope, size: poolIds?.length,
      first: poolIds?.[0], last: poolIds?.[poolIds.length - 1],
      pos: poolIds?.indexOf(cur)
    });

    // プールが空 → cat 最終保険（005→001） or トースト
    if (!poolIds.length) {
      if (scope === 'cat' && /_\d+$/.test(cur)) {
        const prefix = cur.replace(/_\d+$/, '_');
        const nextIdFallback = `${prefix}001`;
        const qs = new URLSearchParams(location.search);
        qs.set('mode', includePaid ? 'all' : 'free');
        const url = buildSiblingUrl(nextIdFallback, qs);
        console.info('[NEXT] fallback(cat->001)', url);
        __navigated = true;
        location.assign(url);
        return;
      }
      showToast('次の問題プールが見つかりません');
      return;
    }

  // ★ 練習モードは完全ランダム（現在IDは除外）
  let nextId = null;
  if (scope === '' || scope === 'free') {
    const selectable = poolIds.filter(id => id !== cur);
    nextId = selectable.length
      ? selectable[Math.floor(Math.random() * selectable.length)]
      : null;
  } else {
    // sub / cat は従来の順送り
    const pos = poolIds.indexOf(cur);
    const candidate = (pos >= 0) ? poolIds[(pos + 1) % poolIds.length] : poolIds[0];
    if (candidate && candidate !== cur) {
      nextId = candidate;
    } else if (scope === 'cat' && /_\d+$/.test(cur)) {
      const prefix = cur.replace(/_\d+$/, '_');
      nextId = `${prefix}001`;
    }
    if (!nextId && scope === 'cat' && /_\d+$/.test(cur)) {
      const prefix = cur.replace(/_\d+$/, '_');
      nextId = `${prefix}001`;
    }
  }

    // 予備保険
    if (!nextId) {
      const fb = await getNextForUser(currentQuestionId);
      if (fb && poolIds.includes(String(fb)) && fb !== currentQuestionId) nextId = fb;
    }
    if (!nextId) {
      const fb1 = await getNextRandomQuestionId(currentQuestionId, includePaid ? 'all' : 'free');
      if (fb1 && poolIds.includes(String(fb1)) && fb1 !== currentQuestionId) nextId = fb1;
    }

    if (!nextId || nextId === currentQuestionId) {
      showToast('次の問題に移動できませんでした');
      return;
    }

    // URL生成
    const qs = new URLSearchParams(location.search);
    qs.set('mode', includePaid ? 'all' : 'free');

    if (scope === 'cat') {
      const url = buildSiblingUrl(nextId, qs);
      console.info('[NEXT] goto(sibling)', { nextId, url });
      __navigated = true;
      location.assign(url);
      return;
    }

    // ★ スコープ維持の原則：free/'' はそのまま、sub/cat はそのまま
    {
      const { scope: scInUrl, sid: sidInUrl, cid: cidInUrl } = readScopeFromURL();
      if (scInUrl === 'sub' && sidInUrl) {
        qs.set('scope', 'sub'); qs.set('sid', sidInUrl);
      } else if (scInUrl === 'cat' && cidInUrl) {
        qs.set('scope', 'cat'); qs.set('cid', cidInUrl);
      } else if (scInUrl === 'free') {
        qs.set('scope', 'free');
      } // scope=='' のときは何も付けない
    }

    // それ以外は categoryPath
    const path = await getCategoryPath(nextId);
    const parts = location.pathname.split('/');
    const i = parts.indexOf('contents');
    const base = (i >= 0 ? parts.slice(0, i + 1).join('/') : '/contents');
    const url = `${base}/${path}/${nextId}.html?${qs.toString()}${location.hash || ''}`;
    console.info('[NEXT] goto(by-path)', { nextId, url });
    __navigated = true;
    location.assign(url);

  } catch (err) {
    console.warn('[goNext] error:', err);
    showToast('次の問題に移動できませんでした');
  } finally {
    navInFlight = false;
    const btn2 = document.getElementById('btn-next');
    if (btn2) btn2.disabled = false;
  }
};

  // ★ 初期化前に押されていたら、まだ遷移していない場合だけドレイン
  if (__queuedNextClick && !__navigated) {
    __queuedNextClick = false;
    queueMicrotask(() => { console.debug('[NEXT] drain'); goNext('drain'); });
  }

  const hintBtn    = document.getElementById('showHintBtn');
  const hintEl     = document.getElementById('hint');
  const explBtn    = document.getElementById('showExplanationBtn');
  const explEl     = document.getElementById('explanation');
  const feedbackEl = document.getElementById('feedback');

  attachEventHandlers(table, data, {
    hintBtn, hintEl, explBtn, explEl, feedbackEl,
    onJudged: async (isCorrect) => {
      try {
        const clientNonce = makeNonce();
        await saveProgress({
          questionId: currentQuestionId,
          isCorrect,
          clientNonce,
        });

        // 誤答なら mistakes を +1（1回だけ）
        if (!isCorrect) {
          if (__mistakeInFlight) return;
          __mistakeInFlight = true;
          try {
            await recordMistake(currentQuestionId, clientNonce);
          } catch (e) {
            console.error('[mistakes] record failed', e);
          } finally {
            __mistakeInFlight = false;
          }
        }
      } catch (e) {
        console.error('[progress] save failed', e);
        showToast?.('記録に失敗しました（ネットワークをご確認ください）', 'error');
      }
    },
    goNext, // 正解時は「次の問題へ」のボタンを押して次に進む
  });

  // “次へ” の既存リスナーを無効化して差し替え
  const nextBtn = document.getElementById('btn-next');
  if (nextBtn) {
    // 既存の inline onclick だけ消す（他は触らない）
    nextBtn.removeAttribute('onclick');
    nextBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      console.info('[NAV] next clicked'); // デバッグ用
      await goNext('manual');
    }, { capture: false });
  }

  // 戻る
  const backBtn = document.getElementById('btn-change');
  backBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (history.length > 1) {
      history.back();
    } else {
      const url = getSectionTopUrl();
      location.href = url;
    }
  });

  // ---- 復習リスト ----
  function addToReviewList(questionId) {
    const list = JSON.parse(localStorage.getItem('reviewList') || '[]');
    if (list.includes(questionId)) return false;
    list.push(questionId);
    localStorage.setItem('reviewList', JSON.stringify(list));
    return true;
  }

  const reviewBtn = document.getElementById('btn-review-later');
  if (reviewBtn) {
    const saved = JSON.parse(localStorage.getItem('reviewList') || '[]');
    const already = saved.includes(currentQuestionId);
    reviewBtn.textContent = already ? '復習リストに追加済み' : '復習リストに追加';
    reviewBtn.setAttribute('aria-label', reviewBtn.textContent);
    reviewBtn.addEventListener('click', () => {
      const added = addToReviewList(currentQuestionId);
      if (added) {
        reviewBtn.textContent = '復習リストに追加済み';
        reviewBtn.setAttribute('aria-label', '復習リストに追加済み');
        reviewBtn.disabled = true;
        showToast('復習リストに追加しました', 'success');
      } else {
        showToast('すでにリストに入っています', 'info');
      }
    });
  }
})();
