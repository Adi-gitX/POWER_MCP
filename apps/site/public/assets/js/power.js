(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const scrollToY = (top) => {
    if (window.__lenis) {
      window.__lenis.scrollTo(top, { duration: reduceMotion ? 0 : 1.05 });
      return;
    }
    window.scrollTo({ top, behavior: reduceMotion ? 'auto' : 'smooth' });
  };

  /* Scroll reveals --------------------------------------------------------- */
  const revealEls = $$('.reveal');
  revealEls.forEach((el) => {
    const siblings = el.parentElement ? Array.from(el.parentElement.children) : [];
    const idx = Math.max(0, siblings.indexOf(el));
    el.style.setProperty('--rd', `${Math.min(idx, 4) * 60}ms`);
  });
  if ('IntersectionObserver' in window) {
    const revealObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        revealObserver.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
    revealEls.forEach((el) => revealObserver.observe(el));
  } else {
    revealEls.forEach((el) => el.classList.add('is-visible'));
  }

  /* FAQ accordions --------------------------------------------------------- */
  $$('.acc').forEach((acc) => {
    const btn = $('.acc-btn', acc);
    const panel = $('.acc-panel', acc);
    if (!btn || !panel) return;
    btn.addEventListener('click', () => {
      const isOpen = acc.classList.contains('is-open');
      const group = acc.closest('.faq-panel');
      if (group) {
        $$('.acc.is-open', group).forEach((other) => {
          if (other === acc) return;
          other.classList.remove('is-open');
          const otherBtn = $('.acc-btn', other);
          const otherPanel = $('.acc-panel', other);
          if (otherBtn) otherBtn.setAttribute('aria-expanded', 'false');
          if (otherPanel) otherPanel.style.height = '0px';
        });
      }
      acc.classList.toggle('is-open', !isOpen);
      btn.setAttribute('aria-expanded', String(!isOpen));
      panel.style.height = isOpen ? '0px' : `${panel.scrollHeight}px`;
    });
  });
  window.addEventListener('resize', () => {
    $$('.acc.is-open .acc-panel').forEach((panel) => {
      panel.style.height = 'auto';
      const h = panel.scrollHeight;
      panel.style.height = `${h}px`;
    });
  });

  /* Anchor scrolling offset ------------------------------------------------
     Delegated, so links in client-rendered pages work too. Handles both
     `#section` and `/#section` when the path is already the current one. */
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const el = e.target instanceof Element ? e.target.closest('a[href]') : null;
    if (!el) return;
    const href = el.getAttribute('href');
    if (!href || href === '#' || el.target === '_blank') return;

    let url;
    try { url = new URL(el.href, window.location.href); } catch { return; }
    if (url.origin !== window.location.origin || !url.hash) return;
    if (url.pathname !== window.location.pathname) return;

    const id = decodeURIComponent(url.hash.slice(1));
    const target = document.getElementById(id);
    if (!target) return;
    e.preventDefault();
    const top = target.getBoundingClientRect().top + window.scrollY - 76;
    scrollToY(top);
    history.pushState(null, '', url.hash);
  });
})();
