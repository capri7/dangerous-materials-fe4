// /js/review-actions.js
import { supabase } from '/js/supabaseClient.js';

function hereWithQuery() {
  return location.pathname + location.search + location.hash;
}

async function ensureAuth() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    const next = encodeURIComponent(hereWithQuery());
    window.location.href = `/login.html?next=${next}`;
    return null;
  }
  return session.user;
}

async function addToReview({ question_id, title, category, subcategory, content_path }) {
  const user = await ensureAuth();
  if (!user) return { ok: false, reason: 'auth' };

  const payload = {
    user_id: user.id,
    question_id,
    title: title || null,
    category: category || null,
    subcategory: subcategory || null,
    content_path: content_path || (location.pathname + location.hash),
    status: 'active'
  };

  // まず insert。重複 (23505) なら成功扱い or 更新で同期
  let { error } = await supabase.from('user_review_items').insert(payload);

  if (error && (error.code === '23505' || /duplicate key/i.test(error.message || ''))) {
    // 既に active 行がある → 内容を同期（任意）
    const { error: upErr } = await supabase
      .from('user_review_items')
      .update({
        title: payload.title,
        category: payload.category,
        subcategory: payload.subcategory,
        content_path: payload.content_path,
        status: 'active'
      })
      .eq('user_id', user.id)
      .eq('question_id', question_id)
      .eq('status', 'active');

    error = upErr || null; // 同期に失敗しなければOK扱い
  }

  if (error) {
    console.error('[review-actions] insert/upsert error', error);
    return { ok: false, error };
  }
  return { ok: true };
}

// ボタン状態の簡易フィードバック
function setBtnState(btn, state) {
  if (!btn) return;
  if (state === 'loading') {
    btn.disabled = true;
    btn.dataset.prevText = btn.textContent;
    btn.textContent = '追加中…';
  } else if (state === 'done') {
    btn.disabled = false;
    btn.textContent = '追加済み';
  } else if (state === 'reset') {
    btn.disabled = false;
    if (btn.dataset.prevText) btn.textContent = btn.dataset.prevText;
  }
}

// ▼ 専用ボタン（data-review-augment="1"）だけを拾う。多重クリック防止も追加
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('.add-to-review[data-review-augment="1"]');
  if (!btn) return;

  e.preventDefault();
  e.stopPropagation();
  if (e.stopImmediatePropagation) e.stopImmediatePropagation();

  if (btn.dataset.busy === '1') return;
  btn.dataset.busy = '1';

  const ds = btn.dataset || {};
  const question_id = ds.questionId;
  if (!question_id) {
    btn.dataset.busy = '0';
    alert('問題IDが見つかりませんでした。');
    return;
  }

  setBtnState(btn, 'loading');

  const res = await addToReview({
    question_id,
    title: ds.title,
    category: ds.category,
    subcategory: ds.subcategory,
    content_path: ds.contentPath
  });

  if (res.ok) {
    setBtnState(btn, 'done');
  } else if (res.reason === 'auth') {
    // 未ログイン時は ensureAuth 内でリダイレクト済み
  } else {
    setBtnState(btn, 'reset');
    alert('復習リストに追加できませんでした。通信状況をご確認ください。');
  }

  btn.dataset.busy = '0';
});

export { addToReview };



