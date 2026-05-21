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
    const toc = document.getElementById('about-toc');
    if (!toc) return;
    const links = Array.from(toc.querySelectorAll('.toc-link'));
    const subsections = links.map(l => document.getElementById(l.dataset.target));

    function setActive(idx) {
        links.forEach((l, i) => l.classList.toggle('active', i === idx));
        if (idx < 0) { toc.classList.remove('has-active'); return; }
        toc.classList.add('has-active');
        // Position the marker bar over the active link (relative to the <ul>)
        const ul = toc.querySelector('ul');
        const link = links[idx];
        const ulRect = ul.getBoundingClientRect();
        const linkRect = link.getBoundingClientRect();
        ul.style.setProperty('--toc-marker-top', (linkRect.top - ulRect.top) + 'px');
        ul.style.setProperty('--toc-marker-height', linkRect.height + 'px');
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