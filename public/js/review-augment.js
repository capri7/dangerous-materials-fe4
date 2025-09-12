// /js/review-augment.js
document.addEventListener('DOMContentLoaded', () => {
  // 3分野の判定（あなたのパス構成に合わせています）
  const CATEGORY_RULES = [
    { test: /^\/contents\/law\//i,                   name: '危険物に関する法令' },
    { test: /^\/contents\/physical_chemistry\//i,    name: '物理と化学' },
    { test: /^\/contents\/properties_prevention\//i, name: '性質と火災予防' }
  ];

  const detectCategoryName = () => {
    const fromBody = (document.body.dataset.category || '').trim();
    if (fromBody) return fromBody;
    const p = location.pathname;
    for (const r of CATEGORY_RULES) if (r.test?.test(p)) return r.name;
    return '';
  };

  const detectSubcategoryName = () => {
    const fromBody = (document.body.dataset.subcategory || '').trim();
    if (fromBody) return fromBody;
    // /contents/<category>/<subcategory>/xxx.html
    const parts = location.pathname.split('/').filter(Boolean);
    const idx = parts.indexOf('contents');
    const subSlug = (idx >= 0 && parts[idx + 2]) ? parts[idx + 2] : '';
    return decodeURIComponent(subSlug).replace(/_/g, ' ');
  };

  // 問題ID（=ファイル名ベース）、タイトル、戻りURL
  const qid = (location.pathname.split('/').pop() || '').replace(/\.html.*$/,'');
  const titleEl = document.getElementById('title');
  const title = (titleEl?.textContent || '').trim() || `問題 ${qid}`;
  const cat = detectCategoryName();
  const sub = detectSubcategoryName();
  const path = `${location.pathname}#q=${encodeURIComponent(qid)}`;

  // --- ボタン（既存があればそれをクローンして専用化。無ければ新規作成） ---
  const host =
    document.querySelector('.question-actions') ||
    document.getElementById('question')?.parentElement ||
    titleEl?.parentElement ||
    document.body;

  // すでに専用ボタンがあるか
  let btn = document.querySelector('.add-to-review[data-review-augment="1"]');

  if (!btn) {
    // 「復習リスト」を含む既存ボタン候補を探す（button / a.btn / .btn）
    const candidate = [...document.querySelectorAll('button, a.btn, .btn')]
      .find(el => /復習リスト/.test((el.textContent || '').trim()));

    if (candidate) {
      // 既存イベントを除去するためクローンで置換
      const clone = candidate.cloneNode(true);
      candidate.replaceWith(clone);
      btn = clone;
    }
  }

  if (!btn) {
    // 既存が無かったので新規作成
    btn = document.createElement('button');
    btn.className = 'btn btn--secondary'; // サイトの見た目に合わせる
    btn.textContent = '復習リストに追加';
    host.appendChild(btn);
  }

  // 専用印とクラスを付与（イベント委譲の対象にする）
  btn.classList.add('add-to-review');
  btn.setAttribute('data-review-augment', '1');

  // 必須 data-* を付与
  btn.dataset.questionId  = qid;
  btn.dataset.title       = title;
  btn.dataset.category    = cat;
  btn.dataset.subcategory = sub;
  btn.dataset.contentPath = path;
});

