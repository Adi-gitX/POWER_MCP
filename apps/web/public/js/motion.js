/**
 * Motion. GSAP + ScrollTrigger for everything that moves, Lenis for the scroll
 * itself. One module, every page.
 *
 * Rules it keeps:
 *   - Content is never hidden by CSS. Initial states are set here, in JS, so a
 *     page with scripts blocked is a complete page that simply does not move.
 *   - prefers-reduced-motion turns off smooth scroll, pinning, parallax and
 *     scrubbing. Reveals collapse to a short opacity fade.
 *   - Nothing animates on layout properties. Transforms and opacity only.
 */
(() => {
  // ?static=1 disables everything: for layout audits and screenshots.
  // ?audit=1 lists every element that spills past the viewport, in the page, for screenshots.
  if (new URLSearchParams(location.search).has('audit')) {
    addEventListener('load', () => {
      const w = document.documentElement.clientWidth; const bad = [];
      document.querySelectorAll('body *').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width && (r.right > w + 1 || r.left < -1)) bad.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).join('.') : ''}  l=${Math.round(r.left)} r=${Math.round(r.right)}`);
      });
      const d = document.createElement('pre');
      d.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;background:#000;color:#0f0;font:10px/1.3 monospace;max-height:100vh;overflow:auto;margin:0;padding:6px;max-width:100vw;white-space:pre-wrap';
      d.textContent = `vw=${w} scrollW=${document.documentElement.scrollWidth} bodyW=${document.body.scrollWidth}\n` + bad.slice(0, 60).join('\n');
      document.body.appendChild(d);
    });
  }
  if (new URLSearchParams(location.search).has('static')) { document.querySelectorAll('.manifesto-wrap').forEach((m) => m.classList.add('static')); document.querySelector('header.top')?.classList.add('scrolled'); return; }
  if (!window.gsap) return;
  const { gsap } = window;
  if (window.ScrollTrigger) gsap.registerPlugin(window.ScrollTrigger);
  const ST = window.ScrollTrigger;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ease = 'power3.out';
  const $ = (s, r = document) => Array.from(r.querySelectorAll(s));

  // ---- smooth scroll (Lenis), driven by GSAP's ticker so ScrollTrigger stays in sync
  let lenis = null;
  if (!reduced && window.Lenis) {
    lenis = new window.Lenis({ lerp: 0.09, wheelMultiplier: 0.95, smoothWheel: true });
    lenis.on('scroll', () => ST && ST.update());
    gsap.ticker.add((t) => lenis.raf(t * 1000));
    gsap.ticker.lagSmoothing(0);
    // In-page anchors go through Lenis.
    document.addEventListener('click', (e) => {
      const a = e.target.closest('a[href^="#"]');
      if (!a) return;
      const el = document.querySelector(a.getAttribute('href'));
      if (el) { e.preventDefault(); lenis.scrollTo(el, { offset: -72 }); }
    });
  }

  // ---- split a heading into masked words, once
  const split = (el) => {
    if (!el || el.dataset.split) return [];
    el.dataset.split = '1';
    const nodes = Array.from(el.childNodes);
    el.textContent = '';
    const words = [];
    for (const n of nodes) {
      if (n.nodeType === 3) {
        for (const w of n.textContent.split(/(\s+)/)) {
          if (!w) continue;
          if (/^\s+$/.test(w)) { el.appendChild(document.createTextNode(' ')); continue; }
          const m = document.createElement('span'); m.className = 'w';
          const i = document.createElement('span'); i.className = 'wi'; i.textContent = w;
          m.appendChild(i); el.appendChild(m); words.push(i);
        }
      } else if (n.nodeName === 'BR') {
        el.appendChild(document.createElement('br'));
      } else {
        // <em> etc: keep the element, split its text inside
        const clone = n.cloneNode(false); el.appendChild(clone);
        for (const w of n.textContent.split(/(\s+)/)) {
          if (!w) continue;
          if (/^\s+$/.test(w)) { clone.appendChild(document.createTextNode(' ')); continue; }
          const m = document.createElement('span'); m.className = 'w';
          const i = document.createElement('span'); i.className = 'wi'; i.textContent = w;
          m.appendChild(i); clone.appendChild(m); words.push(i);
        }
      }
    }
    return words;
  };

  // ---- page enter
  const header = document.querySelector('header.top');
  const hero = document.querySelector('.hero');
  const enter = gsap.timeline({ defaults: { ease, duration: reduced ? 0.3 : 1 } });
  if (header) enter.from(header, { yPercent: -100, autoAlpha: 0, duration: reduced ? 0.3 : 0.7 }, 0);
  if (hero) {
    const h1 = hero.querySelector('h1');
    const words = reduced ? [] : split(h1);
    if (words.length) enter.from(words, { yPercent: 110, rotate: 2, stagger: 0.06, duration: 1.1 }, 0.15);
    else if (h1) enter.from(h1, { autoAlpha: 0, y: 20 }, 0.15);
    enter.from($('.hero .eyebrow, .hero .lead, .hero .prompt, .hero .prompt-hint, .hero .clients', hero).filter(Boolean), { autoAlpha: 0, y: 18, stagger: 0.08 }, 0.35);
    const panel = hero.querySelector('.console, .stats');
    if (panel) enter.from(panel, { autoAlpha: 0, y: 40, scale: 0.97, duration: 1.2 }, 0.6);
  } else {
    const first = document.querySelector('main h1');
    if (first) enter.from(first, { autoAlpha: 0, y: 20 }, 0.1);
  }

  if (!ST) return;

  // ---- header: glass once scrolled; hides on scroll down, returns on scroll up
  if (header) {
    let lastY = 0;
    ST.create({
      start: 0, end: 'max',
      onUpdate: (self) => {
        const y = self.scroll();
        header.classList.toggle('scrolled', y > 40);
        if (reduced) return;
        const down = y > lastY && y > 160;
        gsap.to(header, { yPercent: down ? -140 : 0, duration: 0.4, ease: 'power2.out', overwrite: 'auto' });
        lastY = y;
      },
    });
    header.classList.toggle('scrolled', window.scrollY > 40);
  }

  // ---- hero on scroll: headline recedes, console drifts slower, scene breathes
  if (hero && !reduced) {
    const h1 = hero.querySelector('h1');
    const panel = hero.querySelector('.console, .stats');
    const tl = gsap.timeline({ scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: 0.6 } });
    if (h1) tl.to(h1, { yPercent: 30, autoAlpha: 0.2, scale: 0.96, transformOrigin: 'center top', ease: 'none' }, 0);
    tl.to($('.hero .lead, .hero .prompt, .hero .prompt-hint, .hero .clients, .hero .eyebrow'), { yPercent: 40, autoAlpha: 0, ease: 'none', stagger: 0.02 }, 0);
    if (panel) tl.to(panel, { yPercent: -8, ease: 'none' }, 0);
  }






  // ---- feature cards: entrance
  $('.feats .feat').forEach((c, i) => gsap.from(c, { autoAlpha: 0, y: reduced ? 0 : 20, duration: 0.7, ease, delay: i * 0.08, scrollTrigger: { trigger: c, start: 'top 88%' } }));

  // ---- manifesto: words light up as you scroll; the last line arrives in signal
  const manifesto = document.getElementById('manifesto');
  if (manifesto && !reduced && matchMedia('(min-width: 721px)').matches) {
    const words = manifesto.textContent.trim().split(/\s+/);
    manifesto.innerHTML = words.map((w) => `<span class="mw">${w}</span>`).join(' ');
    const spans = $('.mw', manifesto);
    const wrap = manifesto.closest('.manifesto-wrap');
    const end = wrap.querySelector('.manifesto-end');
    ST.create({
      trigger: wrap, start: 'top 60%', end: 'bottom bottom', scrub: true,
      onUpdate: (self) => {
        const n = Math.floor(self.progress * 1.15 * spans.length);
        spans.forEach((sp, i) => sp.classList.toggle('on', i < n));
        if (end) gsap.set(end, { opacity: gsap.utils.clamp(0, 1, (self.progress - 0.82) / 0.15), y: (1 - gsap.utils.clamp(0, 1, (self.progress - 0.82) / 0.15)) * 14 });
      },
    });
  }

  // ---- section headings: masked word reveal on enter
  $('section h2').forEach((h2) => {
    if (h2.closest('.hero') || h2.closest('.manifesto')) return;
    const words = reduced ? [] : split(h2);
    if (words.length) gsap.from(words, { yPercent: 110, stagger: 0.04, duration: 0.9, ease, scrollTrigger: { trigger: h2, start: 'top 88%' } });
    else gsap.from(h2, { autoAlpha: 0, y: 16, duration: 0.5, scrollTrigger: { trigger: h2, start: 'top 88%' } });
  });
  $('section .eyebrow').forEach((e) => gsap.from(e, { autoAlpha: 0, x: reduced ? 0 : -16, duration: 0.6, ease, scrollTrigger: { trigger: e, start: 'top 92%' } }));

  // ---- staggered groups
  const groups = [
    ['.steps', '.step', { y: 18 }],
    ['.compare tbody', 'tr', { x: -24 }],
    ['.hairlist', ':scope > div', { y: 24 }],
    ['.plans', '.plan', { y: 40, scale: 0.97 }],
    ['.grid2', '.card', { y: 24 }],
    ['.grid3', '.card', { y: 24 }],
    ['.tx', ':scope > div', { x: -16 }],
    ['.doc', ':scope > h2, :scope > p, :scope > ul, :scope > ol, :scope > pre, :scope > .callout, :scope > .tablewrap, :scope > details', { y: 16 }],
  ];
  for (const [parent, child, vars] of groups) {
    $(parent).forEach((p) => {
      const kids = $(child, p);
      if (!kids.length) return;
      gsap.from(kids, { autoAlpha: 0, ...(reduced ? {} : vars), duration: reduced ? 0.3 : 0.8, ease, stagger: reduced ? 0 : Math.min(0.08, 0.6 / kids.length), scrollTrigger: { trigger: p, start: 'top 85%' } });
    });
  }

  // ---- steps: draw the connecting line as they arrive
  $('.steps').forEach((s) => {
    const line = s.querySelector('.steps-line');
    if (!line) return;
    gsap.from(line, { scaleX: 0, transformOrigin: 'left center', duration: 1.2, ease: 'power2.inOut', scrollTrigger: { trigger: s, start: 'top 80%' } });
  });

  // ---- numbers count up
  $('.stat').forEach((el) => {
    const end = parseFloat(el.textContent.replace(/[^\d.]/g, ''));
    if (Number.isNaN(end)) return;
    const suffix = el.textContent.replace(/[\d.,\s]/g, '');
    const o = { v: 0 };
    gsap.to(o, { v: end, duration: reduced ? 0.01 : 1.6, ease: 'power2.out', scrollTrigger: { trigger: el, start: 'top 90%' }, onUpdate: () => { el.textContent = Math.round(o.v).toLocaleString() + suffix; } });
  });
  $('.plan .price').forEach((el) => {
    const m = el.textContent.match(/\$(\d+)/); if (!m) return;
    const small = el.querySelector('small'); const end = Number(m[1]); const o = { v: 0 };
    gsap.to(o, { v: end, duration: reduced ? 0.01 : 1.2, ease: 'power2.out', scrollTrigger: { trigger: el, start: 'top 90%' }, onUpdate: () => { el.firstChild.textContent = `$${Math.round(o.v)}`; if (small) el.appendChild(small); } });
  });

  // ---- parallax accents
  if (!reduced) {
    $('.cta-band').forEach((b) => gsap.fromTo(b, { y: 60, scale: 0.98 }, { y: -20, scale: 1, ease: 'none', scrollTrigger: { trigger: b, start: 'top bottom', end: 'bottom top', scrub: true } }));
    $('.receipt, .console').forEach((c) => { if (c.closest('.hero')) return; gsap.to(c, { y: -30, ease: 'none', scrollTrigger: { trigger: c, start: 'top bottom', end: 'bottom top', scrub: true } }); });
  }

  // ---- magnetic buttons + hover lift
  if (!reduced && matchMedia('(pointer: fine)').matches) {
    $('.btn').forEach((b) => {
      const x = gsap.quickTo(b, 'x', { duration: 0.4, ease }), y = gsap.quickTo(b, 'y', { duration: 0.4, ease });
      b.addEventListener('pointermove', (e) => { const r = b.getBoundingClientRect(); x((e.clientX - r.left - r.width / 2) * 0.18); y((e.clientY - r.top - r.height / 2) * 0.28); });
      b.addEventListener('pointerleave', () => { x(0); y(0); });
    });
    $('.card, .plan').forEach((c) => {
      c.addEventListener('pointerenter', () => gsap.to(c, { y: -4, duration: 0.35, ease }));
      c.addEventListener('pointerleave', () => gsap.to(c, { y: 0, duration: 0.5, ease }));
    });
  }

  // ---- page leave: fade out before following an internal link
  if (!reduced) {
    document.addEventListener('click', (e) => {
      const a = e.target.closest('a[href]');
      if (!a || a.target === '_blank' || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const href = a.getAttribute('href');
      if (!href || href.startsWith('#') || /^(https?:|mailto:)/.test(href) || a.hasAttribute('download')) return;
      e.preventDefault();
      gsap.to('main, footer', { autoAlpha: 0, y: -10, duration: 0.28, ease: 'power2.in', onComplete: () => { location.href = href; } });
    });
    window.addEventListener('pageshow', (e) => { if (e.persisted) gsap.set('main, footer', { clearProps: 'all' }); });
  }

  // ---- for the run console
  window.PowerMotion = {
    enter(node) {
      if (!node || reduced) return;
      gsap.from(node, { autoAlpha: 0, y: 10, duration: 0.45, ease });
    },
    burst(node) {
      if (!node || reduced) return;
      gsap.fromTo(node, { scale: 0.96 }, { scale: 1, duration: 0.5, ease: 'back.out(2)' });
    },
    refresh() { ST.refresh(); },
  };
  window.addEventListener('load', () => ST.refresh());
})();
