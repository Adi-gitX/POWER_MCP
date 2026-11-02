(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const clamp = (n, min, max) => Math.min(Math.max(n, min), max);
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isDesktop = () => window.innerWidth > 900;

  const scrollToY = (top) => {
    if (window.__lenis) {
      window.__lenis.scrollTo(top, { duration: reduceMotion ? 0 : 1.05 });
      return;
    }
    window.scrollTo({ top, behavior: reduceMotion ? 'auto' : 'smooth' });
  };

  /* Page load reveals ------------------------------------------------------ */
  const ready = () => document.body.classList.add('is-ready');
  window.addEventListener('load', ready, { once: true });
  setTimeout(ready, 120);
  if (document.readyState === 'complete') ready();

  /* Header ----------------------------------------------------------------- */
  const header = $('#siteHeader');
  const onScrollHeader = () => {
    if (!header) return;
    header.classList.toggle('is-scrolled', window.scrollY > 24);
  };
  onScrollHeader();

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

  /* Hero parallax ---------------------------------------------------------- */
  const hero = $('#hero');
  const heroChat = $('#heroChat');
  const heroThread = heroChat ? $('.chat-thread', heroChat) : null;
  const hills = $$('.hill');
  const statement = $('#statement');
  const statementParas = statement ? $$('p', statement) : [];

  const updateHero = () => {
    if (!hero || !isDesktop()) return;
    const y = clamp(window.scrollY, 0, hero.offsetHeight);
    if (heroChat) {
      heroChat.style.transform = `translate3d(0, ${(y * 0.125).toFixed(2)}px, 0)`;
    }
    if (heroThread) {
      heroThread.style.transform = `translate3d(0, ${(-Math.min(y, 900) * 0.06).toFixed(2)}px, 0)`;
    }
    hills.forEach((hill) => {
      const lag = parseFloat(hill.dataset.lag || '0');
      hill.style.transform = `translate3d(-50%, ${(y * lag).toFixed(2)}px, 0)`;
    });
  };

  /* Integrations orbit ----------------------------------------------------- */
  const orbit = $('.orbit');
  const orbitNodes = $$('.orbit-node');
  const orbitArcs = $('#orbitArcs');
  const orbitRays = $('#orbitRays');

  const updateOrbit = () => {
    if (!orbit || !orbitNodes.length) return;
    const deg = -2;
    const angle = (deg * Math.PI) / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const mobile = !isDesktop();
    const sx = mobile ? 0.5 : 1;
    const sy = mobile ? 0.62 : 1;
    const scale = 1;
    orbitNodes.forEach((node) => {
      const x = Number(node.dataset.x || 0);
      const y = Number(node.dataset.y || 0);
      const rx = (x * cos - y * sin) * sx;
      const ry = (x * sin + y * cos) * sy;
      node.style.setProperty('--ox', `${(rx * scale).toFixed(2)}px`);
      node.style.setProperty('--oy', `${(ry * scale).toFixed(2)}px`);
    });
    const transform = `translate(720 650) rotate(${deg}) scale(${(sx * scale).toFixed(4)} ${(sy * scale).toFixed(4)}) translate(-720 -650)`;
    if (orbitArcs) orbitArcs.setAttribute('transform', transform);
    if (orbitRays) orbitRays.setAttribute('transform', transform);
  };

  /* Cursor proximity glow (Border Glow Card) ------------------------------- */
  const glowCards = $$('.cap-card, .why-card, .stack-card, .price-card, .post, .design-card, .built-card');
  glowCards.forEach((card) => card.classList.add('glow-card'));
  let pointerX = -9999;
  let pointerY = -9999;
  let glowRaf = 0;

  const paintGlow = () => {
    glowRaf = 0;
    const vh = window.innerHeight;
    glowCards.forEach((card) => {
      const r = card.getBoundingClientRect();
      if (r.bottom < -120 || r.top > vh + 120) {
        card.classList.remove('is-glowing');
        return;
      }
      const inside = pointerX >= r.left && pointerX <= r.right && pointerY >= r.top && pointerY <= r.bottom;
      let dist;
      if (inside) {
        dist = Math.min(pointerX - r.left, r.right - pointerX, pointerY - r.top, r.bottom - pointerY);
      } else {
        const dx = Math.max(r.left - pointerX, 0, pointerX - r.right);
        const dy = Math.max(r.top - pointerY, 0, pointerY - r.bottom);
        dist = Math.hypot(dx, dy);
      }
      const proximity = 150;
      const opacity = clamp(1 - Math.max(0, dist - 1) / proximity, 0, 1);
      card.style.setProperty('--gx', `${(pointerX - r.left).toFixed(1)}px`);
      card.style.setProperty('--gy', `${(pointerY - r.top).toFixed(1)}px`);
      card.classList.toggle('is-glowing', opacity > 0.01);
    });
  };

  document.addEventListener('pointermove', (e) => {
    pointerX = e.clientX;
    pointerY = e.clientY;
    if (!glowRaf) glowRaf = requestAnimationFrame(paintGlow);
  }, { passive: true });
  document.addEventListener('pointerleave', () => {
    pointerX = -9999;
    pointerY = -9999;
    if (!glowRaf) glowRaf = requestAnimationFrame(paintGlow);
  });
  window.addEventListener('scroll', () => {
    if (!glowRaf) glowRaf = requestAnimationFrame(paintGlow);
  }, { passive: true });

  const updateStatement = () => {
    if (!statementParas.length) return;
    const vh = window.innerHeight;
    const mid = vh * 0.52;
    statementParas.forEach((p) => {
      const r = p.getBoundingClientRect();
      if (r.bottom < -100 || r.top > vh + 100) return;
      const center = r.top + r.height / 2;
      const dist = Math.abs(center - mid);
      const t = clamp(1 - dist / (vh * 0.42), 0, 1);
      const alpha = (0.2 + 0.8 * t * t).toFixed(3);
      p.style.color = `rgba(255,255,255,${alpha})`;
    });
  };

  /* By-design parallax ----------------------------------------------------- */
  const designCards = $$('.design-card');
  const updateDesign = () => {
    if (!designCards.length || reduceMotion) return;
    const vh = window.innerHeight;
    designCards.forEach((card) => {
      const r = card.getBoundingClientRect();
      if (r.bottom < -120 || r.top > vh + 120) return;
      const p = clamp((vh - r.top) / (vh + r.height), 0, 1);
      $$('.dune', card).forEach((dune, i) => {
        const shift = (0.5 - p) * (i === 0 ? 96 : 144);
        dune.style.transform = `translate3d(0, ${shift.toFixed(2)}px, 0)`;
      });
      const cloud = $('.design-cloud', card);
      if (cloud) {
        const drift = (0.5 - p) * 58;
        cloud.style.transform = `translate3d(${drift.toFixed(2)}px, ${(drift * 0.42).toFixed(2)}px, 0)`;
      }
    });
  };

  /* Stack imagery ---------------------------------------------------------- */
  const stackMedia = $$('.stack-media img');
  const updateStack = () => {
    if (!stackMedia.length || reduceMotion) return;
    const vh = window.innerHeight;
    stackMedia.forEach((img) => {
      const card = img.closest('.stack-card');
      if (!card) return;
      const r = card.getBoundingClientRect();
      if (r.bottom < -120 || r.top > vh + 120) return;
      const p = clamp((vh - r.top) / (vh + r.height), 0, 1);
      const shift = (p - 0.5) * 38;
      img.style.transform = `translate3d(0, ${shift.toFixed(2)}px, 0)`;
    });
  };

  let ticking = false;
  const onScroll = () => {
    onScrollHeader();
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      updateHero();
      updateOrbit();
      updateStatement();
      updateDesign();
      updateStack();
      ticking = false;
    });
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', () => {
    updateHero();
    updateOrbit();
    updateStatement();
    updateDesign();
    updateStack();
    if (!glowRaf) glowRaf = requestAnimationFrame(paintGlow);
  });
  updateHero();
  updateOrbit();
  updateStatement();
  updateDesign();
  updateStack();

  /* How it works carousel --------------------------------------------------- */
  const demoFrame = $('#demoFrame');
  const demoTabs = $$('.demo-tab');
  const demoSlides = $$('.demo-slide');
  const demoBgs = $$('.demo-bg-img');
  const demoCaption = $('#demoCaption');
  const demoPrev = $('#demoPrev');
  const demoNext = $('#demoNext');
  const demoOrder = ['connect', 'contract', 'execute', 'approve'];
  const demoCopy = {
    connect: 'Add one MCP endpoint to your agent client.',
    contract: 'Approve the plan before any code is written.',
    execute: 'Watch the build run: files, checks and tests in order.',
    approve: 'Review the exact change and target before anything reaches production.'
  };
  let demoIndex = 0;
  let demoInView = false;
  let demoTimer = null;
  let demoHovered = false;

  const setDemo = (name, focusTab = false) => {
    const idx = demoOrder.indexOf(name);
    if (idx < 0) return;
    demoIndex = idx;
    demoTabs.forEach((tab, i) => {
      const active = i === idx;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.setAttribute('tabindex', active ? '0' : '-1');
      if (active && focusTab) tab.focus({ preventScroll: true });
    });
    demoSlides.forEach((slide) => {
      const active = slide.dataset.demoPanel === name;
      slide.hidden = false;
      slide.classList.toggle('is-active', active);
      slide.toggleAttribute('inert', !active);
      slide.setAttribute('aria-hidden', String(!active));
    });
    demoBgs.forEach((bg) => bg.classList.toggle('is-active', bg.dataset.demoBg === name));
    if (demoCaption) demoCaption.textContent = demoCopy[name];
    restartDemoTimer();
  };

  const restartDemoTimer = () => {
    if (demoTimer) clearInterval(demoTimer);
    if (reduceMotion) return;
    demoTimer = setInterval(() => {
      if (!demoInView || demoHovered || document.hidden) return;
      const next = (demoIndex + 1) % demoOrder.length;
      setDemo(demoOrder[next]);
    }, 6200);
  };

  demoTabs.forEach((tab) => {
    tab.addEventListener('click', () => setDemo(tab.dataset.demoTab));
    tab.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      const dir = e.key === 'ArrowRight' ? 1 : -1;
      const next = (demoIndex + dir + demoOrder.length) % demoOrder.length;
      setDemo(demoOrder[next], true);
    });
  });
  if (demoPrev) demoPrev.addEventListener('click', () => setDemo(demoOrder[(demoIndex - 1 + demoOrder.length) % demoOrder.length]));
  if (demoNext) demoNext.addEventListener('click', () => setDemo(demoOrder[(demoIndex + 1) % demoOrder.length]));
  if (demoFrame) {
    demoFrame.addEventListener('mouseenter', () => { demoHovered = true; });
    demoFrame.addEventListener('mouseleave', () => { demoHovered = false; });
    if ('IntersectionObserver' in window) {
      const demoObserver = new IntersectionObserver((entries) => {
        demoInView = entries[0].isIntersecting;
      }, { threshold: 0.2 });
      demoObserver.observe(demoFrame);
    } else {
      demoInView = true;
    }
  }
  setDemo('connect');

  /* Why carousel ----------------------------------------------------------- */
  const whyRail = $('#whyRail');
  const whyTrack = $('#whyTrack');
  const whyPrev = $('#whyPrev');
  const whyNext = $('#whyNext');
  const whyProgress = $('#whyProgress');
  const whyCards = $$('.why-card');

  const whyStep = () => {
    if (!whyCards.length) return 454;
    const first = whyCards[0];
    const second = whyCards[1];
    return second ? second.offsetLeft - first.offsetLeft : first.offsetWidth + 16;
  };

  const updateWhyProgress = () => {
    if (!whyRail || !whyProgress) return;
    const max = whyRail.scrollWidth - whyRail.clientWidth;
    const ratio = max > 0 ? whyRail.scrollLeft / max : 0;
    const widthPct = Math.min(46, (whyRail.clientWidth / whyRail.scrollWidth) * 100);
    whyProgress.style.width = `${Math.max(16, widthPct)}%`;
    whyProgress.style.transform = `translateX(${(ratio * (100 / Math.max(16, widthPct) - 1)) * 100}%)`;
    if (!whyRail.dataset.bound) {
      whyRail.dataset.bound = '1';
      whyRail.addEventListener('scroll', () => {
        const max = whyRail.scrollWidth - whyRail.clientWidth;
        const ratio = max > 0 ? whyRail.scrollLeft / max : 0;
        whyProgress.style.transform = `translateX(${ratio * (100 / Math.max(16, widthPct) - 1) * 100}%)`;
      }, { passive: true });
    }
  };
  if (whyRail) {
    whyRail.addEventListener('scroll', updateWhyProgress, { passive: true });
    window.addEventListener('resize', updateWhyProgress);
    updateWhyProgress();
  }
  if (whyPrev && whyRail) whyPrev.addEventListener('click', () => whyRail.scrollBy({ left: -whyStep(), behavior: reduceMotion ? 'auto' : 'smooth' }));
  if (whyNext && whyRail) whyNext.addEventListener('click', () => whyRail.scrollBy({ left: whyStep(), behavior: reduceMotion ? 'auto' : 'smooth' }));

  if (whyRail && whyTrack) {
    let dragging = false;
    let startX = 0;
    let startLeft = 0;
    whyTrack.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      dragging = true;
      startX = e.clientX;
      startLeft = whyRail.scrollLeft;
      whyTrack.setPointerCapture?.(e.pointerId);
      whyRail.style.scrollSnapType = 'none';
    });
    whyTrack.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      if (Math.abs(dx) > 4) whyRail.scrollLeft = startLeft - dx;
    });
    const endDrag = () => {
      dragging = false;
      whyRail.style.scrollSnapType = '';
    };
    whyTrack.addEventListener('pointerup', endDrag);
    whyTrack.addEventListener('pointercancel', endDrag);
    whyTrack.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') { e.preventDefault(); whyRail.scrollBy({ left: whyStep(), behavior: 'smooth' }); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); whyRail.scrollBy({ left: -whyStep(), behavior: 'smooth' }); }
    });
  }

  /* Counters --------------------------------------------------------------- */
  const animateCount = (el) => {
    if (el.dataset.counted === '1') return;
    el.dataset.counted = '1';
    const target = parseFloat(el.dataset.count || el.textContent || '0');
    if (!Number.isFinite(target)) return;
    if (reduceMotion || target === 0) { el.textContent = String(target); return; }
    const duration = 1500;
    const start = performance.now();
    const tick = (now) => {
      const p = clamp((now - start) / duration, 0, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      el.textContent = String(Math.round(target * eased));
      if (p < 1) requestAnimationFrame(tick);
      else el.textContent = String(target);
    };
    requestAnimationFrame(tick);
  };
  const countEls = $$('[data-count]');
  if ('IntersectionObserver' in window) {
    const countObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        animateCount(entry.target);
        countObserver.unobserve(entry.target);
      });
    }, { threshold: 0.6 });
    countEls.forEach((el) => {
      if (el.dataset.count !== '0') el.textContent = '0';
      countObserver.observe(el);
    });
  } else {
    countEls.forEach(animateCount);
  }

  /* FAQ -------------------------------------------------------------------- */
  const faqTabs = $$('.faq-tab');
  const faqPanels = $$('.faq-panel');
  const setFaq = (name) => {
    faqTabs.forEach((tab) => {
      const active = tab.dataset.faqTab === name;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    faqPanels.forEach((panel) => {
      const active = panel.dataset.faqPanel === name;
      panel.hidden = !active;
      panel.classList.toggle('is-active', active);
    });
  };
  faqTabs.forEach((tab) => tab.addEventListener('click', () => setFaq(tab.dataset.faqTab)));

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
