// public/js/nav-toggle.js
document.addEventListener('DOMContentLoaded', () => {
  const header = document.querySelector('.site-header');
  const btn    = header?.querySelector('.hamburger');
  const nav    = header?.querySelector('.nav-links');

  if (!header || !btn || !nav) {
    console.warn('[nav-toggle] 必要要素が見つかりません:', {
      hasHeader: !!header, hasBtn: !!btn, hasNav: !!nav, url: location.pathname
    });
    return;
  }

  const mq = window.matchMedia('(min-width: 768px)');

  const setOpen = (open) => {
    btn.setAttribute('aria-label', open ? 'メニューを閉じる' : 'メニューを開く');
    btn.setAttribute('aria-expanded', String(open));
    header.classList.toggle('nav-open', open);
    // PC幅は常時表示、モバイルは開閉でhidden切替
    nav.hidden = mq.matches ? false : !open;
    // 必要ならスクロールロック
    // document.body.classList.toggle('scroll-lock', open);
  };

  btn.setAttribute('type', 'button');                 // 万一の保険
  if (!btn.hasAttribute('aria-controls')) btn.setAttribute('aria-controls', 'site-nav');
  setOpen(false);

  // クリックで開閉
  btn.addEventListener('click', () => {
    const willOpen = btn.getAttribute('aria-expanded') !== 'true';
    setOpen(willOpen);
  });

  // Escapeで閉じてフォーカスを戻す
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && btn.getAttribute('aria-expanded') === 'true') {
      setOpen(false);
      btn.focus();
    }
  });

  // モバイル時のみ、リンククリックで自動クローズ
  nav.addEventListener('click', (e) => {
    if (!mq.matches && e.target.closest('a')) setOpen(false);
  });

  // ブレークポイント変化で状態リセット
  const sync = () => setOpen(false);
  mq.addEventListener ? mq.addEventListener('change', sync) : mq.addListener(sync);
});




