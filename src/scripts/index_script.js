// ─────────────────────────────────────────────────────────────────────
// EEG-like visualisation
// 4 coloured channels in fixed lanes, slow drift + fast jitter,
// flowing right → left like a live strip chart. Purely decorative —
// no real data, kept stylised on purpose.
// ─────────────────────────────────────────────────────────────────────
(function eegViz() {
    const canvas = document.getElementById('eeg-canvas');
    const ctx = canvas.getContext('2d');

    // Each channel: stroke colour, phase offset (so lines don't sync),
    // and temporal speed (how fast the pattern scrolls).
    const channels = [
        { color: '#7A8F7E', phase: Math.random() * 1000, speed: 0.12 },  // sage
        { color: '#C4704B', phase: Math.random() * 1000, speed: 0.14 },  // coral
        { color: '#B8943F', phase: Math.random() * 1000, speed: 0.16 },  // gold
        { color: '#6A8E5B', phase: Math.random() * 1000, speed: 0.10 },  // green
    ];
    const LANE_PADDING = 6; // px of breathing room top/bottom of each lane

    // ── Hi-DPI canvas sizing ────────────────────────────────────────
    // Match the canvas backing store to device pixels so strokes stay
    // crisp on retina displays. clientWidth/Height is what we draw to.
    let W = 0, H = 0, DPR = 1;
    function resize() {
        DPR = window.devicePixelRatio || 1;
        W = canvas.clientWidth;
        H = canvas.clientHeight;
        canvas.width = Math.floor(W * DPR);
        canvas.height = Math.floor(H * DPR);
        ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    }
    resize();
    window.addEventListener('resize', resize);

    // Slow meandering trend + fast zigzag jitter. Normalised to roughly [-1, 1]
    // so we can scale to lane height and stay in our lane.
    function eegSample(t, seed) {
        // Slow trend — overall up/down drift
        const slow = Math.sin(t * 0.55 + seed) * 0.42
                    + Math.sin(t * 1.20 + seed * 1.7) * 0.22;
        // Fast jitter — the second-by-second zigzag riding on top
        const fast = Math.sin(t * 12.0 + seed * 3.1) * 0.16
                    + Math.sin(t * 21.0 + seed * 5.7) * 0.10
                    + Math.sin(t * 34.0 + seed * 7.3) * 0.06;
        let v = slow + fast;
        // Soft clamp so the rare combined peak doesn't punch out of the lane
        if (v > 1) v = 1; else if (v < -1) v = -1;
        return v;
    }

    // ── Render loop ─────────────────────────────────────────────────
    let t0 = performance.now();
    function draw(now) {
        const elapsed = (now - t0) / 1000;
        ctx.clearRect(0, 0, W, H);

        // Divide canvas height into equal lanes, one per channel
        const rowH = H / channels.length;
        const laneAmp = (rowH / 2) - LANE_PADDING; // stay strictly in our lane
        const step = 2; // px between sampled x positions

        channels.forEach((ch, i) => {
            const midY = rowH * (i + 0.5); // vertical centre of this lane
            ctx.beginPath();
            ctx.lineWidth = 1.6;
            ctx.strokeStyle = ch.color;
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';

            for (let x = 0; x <= W; x += step) {
                // tx grows with x so newer samples appear on the right;
                // as elapsed advances, the pattern flows right → left.
                const tx = elapsed * ch.speed + x * 0.018;
                const y = midY + eegSample(tx, ch.phase) * laneAmp;
                if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.stroke();
        });

        requestAnimationFrame(draw);
    }
    requestAnimationFrame(draw);
})();

// ─────────────────────────────────────────────────────────────────────
// About TOC scroll-spy
// Highlights the rail link matching whichever subsection is closest to
// a reference line near the top of the viewport. Also positions the
// coral marker bar to overlay just that link.
// ─────────────────────────────────────────────────────────────────────
(function aboutToc() {
    // Two navs share the same scroll-spy: the desktop vertical rail (#about-toc)
    // and the mobile sticky chip bar (#about-toc-mobile). Either may be absent.
    const desktopToc = document.getElementById('about-toc');
    const mobileToc = document.getElementById('about-toc-mobile');
    const links = Array.from(document.querySelectorAll(
        '#about-toc .toc-link, #about-toc-mobile .toc-chip'));
    if (!links.length) return;

    // Ordered section ids, taken from whichever nav exists.
    const order = Array.from((desktopToc || mobileToc).querySelectorAll('[data-target]'))
        .map(l => l.dataset.target);
    const subsections = order.map(id => document.getElementById(id));

    function setActive(idx) {
        const activeId = idx < 0 ? null : order[idx];
        links.forEach(l => l.classList.toggle('active', l.dataset.target === activeId));

        // Desktop: slide the coral marker bar over the active rail link.
        if (desktopToc) {
            if (activeId === null) {
                desktopToc.classList.remove('has-active');
            } else {
                desktopToc.classList.add('has-active');
                const ul = desktopToc.querySelector('ul');
                const link = desktopToc.querySelector(`.toc-link[data-target="${activeId}"]`);
                if (ul && link) {
                    const ulRect = ul.getBoundingClientRect();
                    const linkRect = link.getBoundingClientRect();
                    ul.style.setProperty('--toc-marker-top', (linkRect.top - ulRect.top) + 'px');
                    ul.style.setProperty('--toc-marker-height', linkRect.height + 'px');
                }
            }
        }

        // Mobile: keep the active chip scrolled into view within the strip.
        if (mobileToc && activeId !== null) {
            const chip = mobileToc.querySelector(`.toc-chip[data-target="${activeId}"]`);
            if (chip) {
                const cRect = chip.getBoundingClientRect();
                const nRect = mobileToc.getBoundingClientRect();
                if (cRect.left < nRect.left || cRect.right > nRect.right) {
                    mobileToc.scrollTo({ left: chip.offsetLeft - 16, behavior: 'smooth' });
                }
            }
        }
    }

    // The "active" section is the last one whose top has passed our reference line.
    // 25% from the top of viewport gives a natural feel — section becomes active
    // shortly after its heading scrolls into the upper portion of the screen.
    function update() {
        const refY = window.innerHeight * 0.25;
        let activeIdx = -1;
        subsections.forEach((sec, i) => {
            if (!sec) return;
            if (sec.getBoundingClientRect().top <= refY) activeIdx = i;
        });
        setActive(activeIdx);
    }

    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    update();
})();

// ─────────────────────────────────────────────────────────────────────
// App gallery lightbox
// Click/tap a .gallery-item thumbnail to open the #lightbox overlay.
// Desktop: side arrows, keyboard (←/→/Esc), click the backdrop to close.
// Mobile: swipe left/right to navigate, swipe down or tap backdrop to close.
// ─────────────────────────────────────────────────────────────────────
(function lightbox() {
    const lb = document.getElementById('lightbox');
    const groups = Array.from(document.querySelectorAll('.gallery'));
    if (!lb || !groups.length) return;

    const imgEl = lb.querySelector('.lightbox-img');
    // Navigation is scoped to the gallery that was clicked, so the App and
    // Console galleries each cycle through only their own images.
    let sources = [];
    let current = 0;

    function show(i) {
        current = (i + sources.length) % sources.length;
        imgEl.src = sources[current].src;
        imgEl.alt = sources[current].alt;
    }
    function open(groupSources, i) {
        sources = groupSources;
        show(i);
        lb.classList.add('is-open');
        lb.setAttribute('aria-hidden', 'false');
        document.body.classList.add('lightbox-open');
    }
    function close() {
        lb.classList.remove('is-open');
        lb.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('lightbox-open');
    }
    const isOpen = () => lb.classList.contains('is-open');

    groups.forEach(group => {
        const items = Array.from(group.querySelectorAll('.gallery-item'));
        const groupSources = items.map(it => {
            const img = it.querySelector('img');
            return { src: img.getAttribute('src'), alt: img.getAttribute('alt') || '' };
        });
        items.forEach((it, i) => it.addEventListener('click', () => open(groupSources, i)));
    });

    lb.querySelector('.lightbox-prev').addEventListener('click', e => { e.stopPropagation(); show(current - 1); });
    lb.querySelector('.lightbox-next').addEventListener('click', e => { e.stopPropagation(); show(current + 1); });
    lb.querySelector('.lightbox-close').addEventListener('click', close);

    // Click anywhere that isn't the image or a control closes the viewer.
    lb.addEventListener('click', e => {
        if (e.target === lb || e.target.classList.contains('lightbox-stage')) close();
    });

    document.addEventListener('keydown', e => {
        if (!isOpen()) return;
        if (e.key === 'Escape') close();
        else if (e.key === 'ArrowLeft') show(current - 1);
        else if (e.key === 'ArrowRight') show(current + 1);
    });

    // Touch: horizontal swipe = prev/next, downward swipe = close.
    let startX = 0, startY = 0, tracking = false;
    lb.addEventListener('touchstart', e => {
        const t = e.changedTouches[0];
        startX = t.clientX; startY = t.clientY; tracking = true;
    }, { passive: true });
    lb.addEventListener('touchend', e => {
        if (!tracking) return;
        tracking = false;
        const t = e.changedTouches[0];
        const dx = t.clientX - startX, dy = t.clientY - startY;
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) show(dx < 0 ? current + 1 : current - 1);
        else if (dy > 90 && Math.abs(dy) > Math.abs(dx)) close();
    }, { passive: true });
})();