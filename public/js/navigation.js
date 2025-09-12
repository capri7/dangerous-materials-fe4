// /js/navigation.js
import { supabase } from '/js/supabaseClient.js';
import {
  fetchQuestionData,
  isPaidUser,
  getNextForUser,
  getCategoryPath,
  getUIMode,
  getSectionTopUrl,
} from '/js/dataLoader.js';

document.addEventListener('DOMContentLoaded', () => void main());

const QUESTIONS_BASE = '/contents';

async function main() {
  // 現在の問題ID（ファイル名）
  const currentId = location.pathname.split('/').pop()?.replace(/\.html$/, '') || '';


  // 問題データ取得（失敗時は安全に抜ける）
  let q = null;
  try {
    q = await fetchQuestionData();
  } catch (e) {
    console.error('[nav] fetchQuestionData failed:', e);
    return;
  }

  // 「次へ」ボタン（<button id="btn-next"> or <a id="btn-next">）
  const nextBtn = document.getElementById('btn-next');
  if (!nextBtn) return;

  // クリック抑止用ヘルパーを先に用意
  const setBusy = (busy) => {
    if (busy) {
      nextBtn.setAttribute('aria-busy', 'true');
      nextBtn.setAttribute('disabled', 'true');
    } else {
      nextBtn.removeAttribute('aria-busy');
      nextBtn.removeAttribute('disabled');
    }
  };

  // a要素なら、初期hrefを無効化して誤ナビを防止
  if (nextBtn.tagName.toLowerCase() === 'a') {
    nextBtn.removeAttribute('href');
  }

  // 初期はローディング中として無効化
  setBusy(true);

  // 無料ユーザーの有料問題直リンクをガード
  const mode = getUIMode(); // ?mode=free/all（検証用）
  if (q?.is_paid === true && mode !== 'all') {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const paid = user ? await isPaidUser() : false;
      if (!paid) {
        location.href = `/pricing.html?next=${encodeURIComponent(location.href)}`;
        return;
      }
    } catch (e) {
      console.warn('[nav] paid check failed:', e);
      location.href = `/pricing.html?next=${encodeURIComponent(location.href)}`;
      return;
    }
  }

  // ここまで来たらボタンを有効化
  setBusy(false);

    const backBtn = document.getElementById('btn-change');
    if (backBtn) {
        backBtn.addEventListener('click', (e) => {
         e.preventDefault();
         const url = getSectionTopUrl();
         if (url) location.href = url;
         else history.back();
        });
     }

  // URL生成ヘルパー（/contents に統一）
    const buildUrl = async (qid) => {
      const p = await getCategoryPath(qid);
      if (!p) throw new Error('Could not resolve next path');
      // mode パラメータは維持（free/all）
      return `${QUESTIONS_BASE}/${p}/${qid}.html${mode ? `?mode=${mode}` : ''}`;
    };

  nextBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (nextBtn.hasAttribute('disabled')) return;

    setBusy(true);
    try {
      const nextId = await getNextForUser(currentId);
      const nextHref = nextId ? await buildUrl(nextId) : '/complete.html';

    // <a> の場合は href も上書き（将来の中クリック等にも備える）
    if (nextBtn.tagName.toLowerCase() === 'a') {
      nextBtn.setAttribute('href', nextHref);
    }

    location.assign(nextHref);
    // 成功時は復帰しない（連打防止）
  } catch (err) {
    console.error('[nav] go-next failed:', err);
    setBusy(false); // 失敗時のみ復帰
    }
  }, true); // ← capture
}











