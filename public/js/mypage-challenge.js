// /js/mypage-challenge.js
import { supabase } from './supabaseClient.js';
const { getCategoryPath } = await import('./dataLoader.js');

// law の最初の無料問題を返す
async function findFirstFreeQuestion() {
  const { data: cat, error: e0 } = await supabase
    .from('categories').select('id').eq('slug', 'law').single();
  if (e0 || !cat) throw e0 || new Error('law category not found');

  const { data: subs, error: e1 } = await supabase
    .from('subcategories')
    .select('id, "order"')
    .eq('category_id', cat.id)
    .order('order', { ascending: true });
  if (e1) throw e1;

  const subOrder = new Map((subs || []).map(s => [s.id, s.order ?? 9999]));
  const subIds   = (subs || []).map(s => s.id);

  const { data: qs, error: e2 } = await supabase
    .from('questions')
    .select('id, subcategory_id, "order", is_paid')
    .eq('is_paid', false)
    .in('subcategory_id', subIds);
  if (e2) throw e2;

  (qs || []).sort((a, b) => {
    const sa = subOrder.get(a.subcategory_id) ?? 9999;
    const sb = subOrder.get(b.subcategory_id) ?? 9999;
    return sa - sb || (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id);
  });

  return (qs || [])[0] || null;
}


// 「チャレンジする」ボタン（既存のリスナーを除去してから、自分のを1回だけ付ける）
const _btn = document.getElementById('challenge-btn');
if (_btn) {
  const btn = _btn.cloneNode(true);     // ← これで既存のリスナーを全部剥がす
  _btn.replaceWith(btn);
  btn.addEventListener('click', async (ev) => {
    ev.preventDefault();
    // 追加：他の（親・documentの）クリックリスナーを止める
    ev.stopPropagation();
    ev.stopImmediatePropagation();
    btn.disabled = true; // 二重起動の保険
    try {
      const first = await findFirstFreeQuestion();
      if (!first) { alert('無料問題が見つかりません'); return; }
      const path = getCategoryPath(first.id); // 例: law/defined_substances
      location.href = `/contents/${path}/${first.id}.html?mode=free`;
    } catch (err) {
      console.error('challenge start error', err);
      alert('開始に失敗しました');
    }
   }, { once: true });
  }

