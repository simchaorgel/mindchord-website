/* Mindchord Console — shared UI helpers
   ────────────────────────────────────────────────────────────────────────
   Formatting and chart primitives used by more than one page. Loaded in
   <head> by base.njk, so page-level inline <script> can destructure it:

       const { escapeHtml, fullName, renderSpark } = window.consoleUI;

   Everything here is pure — no DOM reads, no Supabase — except renderAxis,
   which writes into an element you hand it.
   ──────────────────────────────────────────────────────────────────────── */
(function () {
    'use strict';

    const DAY = 86400000;
    const MAX_POINTS = 70;   // widen the bucket rather than plot more than this

    /* Plot geometry. PAD is the inset above and below the data band, in the
       same 0–100 viewBox units renderSpark draws in. renderAxis positions its
       ticks off these same numbers, which is the only reason the labels line
       up with the line — they must stay in one place. */
    const W = 600, H = 100, PAD = 8;

    // ── Formatting ──────────────────────────────────────────────────────────

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    }

    function fullName(p) {
        const parts = [p.display_name, p.surname].filter(Boolean);
        return parts.length ? parts.join(' ') : '(unnamed)';
    }

    function initials(p) {
        const a = (p.display_name || '').trim();
        const b = (p.surname || '').trim();
        const i = (a[0] || '') + (b[0] || '');
        return i.toUpperCase() || '–';
    }

    /* Past dates. Switches to an absolute date past a week, where "23 days ago"
       stops being easier to read than the date itself.

       Returns a bare time expression with no leading preposition, so it reads
       correctly after "last" — "last today" would be wrong, but so would "last
       on 3 Aug". Callers supply their own framing. */
    function formatRelativeDate(d) {
        const now = new Date();
        const diffMs = now - d;
        if (diffMs < DAY && now.getDate() === d.getDate()) return 'today';
        if (diffMs < 2 * DAY) return 'yesterday';
        const days = Math.floor(diffMs / DAY);
        if (days < 7) return days + ' days ago';
        return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    }

    // Future dates, for deadlines.
    function formatUntil(d) {
        const days = Math.ceil((d - new Date()) / DAY);
        if (days <= 0) return 'today';
        if (days === 1) return 'tomorrow';
        return `in ${days} days`;
    }

    // ── Client status ───────────────────────────────────────────────────────

    /* The thresholds live here, not on the pages, so the dashboard and the
       clients list cannot disagree about what "expiring" or "quiet" means. */
    const EXPIRY_DAYS = 12;  // licence expiring within this → warn
    const QUIET_DAYS = 14;   // no completed session in this long → "Quiet"

    /* What, if anything, needs doing about a client. Returns null when nothing
       does. First match wins, and `rank` doubles as a sort order.

       `urgency` breaks ties *within* a rank, ascending, and is only meaningful
       against others of the same rank — never compare it across ranks. Where a
       rank carries a date it is that timestamp, so the soonest deadline (or the
       longest silence) floats to the top; ranks with no such signal use 0 and
       fall through to whatever the caller's next tiebreak is.

       `last` is the client's most recent completed session as a Date, or
       undefined. `hasProtocol` is whether they hold an un-archived protocol. */
    function classifyClient(c, hasProtocol, last) {
        const now = Date.now();
        const expires = c.licence_expires_at ? new Date(c.licence_expires_at) : null;

        if (expires && expires.getTime() < now)
            return { rank: 0, urgency: expires.getTime(), chip: 'chip-danger', label: 'Licence lapsed', detail: `Offline licence expired ${formatRelativeDate(expires)}` };
        if (expires && expires.getTime() - now <= EXPIRY_DAYS * DAY)
            return { rank: 1, urgency: expires.getTime(), chip: 'chip-warn', label: 'Licence expiring', detail: `Offline licence expires ${formatUntil(expires)}` };
        if (!hasProtocol)
            return { rank: 2, urgency: 0, chip: 'chip-info', label: 'No protocol', detail: 'No active protocol assigned' };

        // Offline clients write no `sessions` rows at all, so session recency
        // says nothing about whether they are training — only the licence
        // rules above can flag them. Same trap `isProtocolInUse()` guards
        // against on the client page.
        if (c.licence_issued_at) return null;

        if (!last)
            return { rank: 3, urgency: 0, chip: 'chip-info', label: 'Never started', detail: 'Protocol assigned, no sessions yet' };
        if (now - last.getTime() >= QUIET_DAYS * DAY)
            return { rank: 4, urgency: last.getTime(), chip: 'chip-neutral', label: 'Quiet', detail: `Last session ${formatRelativeDate(last)}` };

        return null;
    }

    // ── Time bucketing ──────────────────────────────────────────────────────

    // Widen the bucket until the series is a readable number of points. Without
    // this a two-year history would draw 700 daily points into 600 units.
    function pickStep(spanMs) {
        const ladder = [
            { ms: DAY, label: 'Per day' },
            { ms: 7 * DAY, label: 'Per week' },
            { ms: 28 * DAY, label: 'Per 4 weeks' },
        ];
        return ladder.find(s => spanMs / s.ms <= MAX_POINTS) || ladder[ladder.length - 1];
    }

    // ── Scale ───────────────────────────────────────────────────────────────

    function seriesPeak(series) {
        let peak = 1;
        for (const s of series) for (const v of s.values) if (v > peak) peak = v;
        return peak;
    }

    // Round the top of a scale up to an even number, so an axis reads in whole
    // values and its midpoint is whole too. Deliberately tight rather than a
    // 1/2/5 ladder: at a realistic caseload a 1/2/5 scale sends 12 clients to a
    // max of 20 and wastes half the plot on empty headroom.
    // Only needed when ticks are drawn — a plot with no axis should scale to
    // its own peak instead.
    function niceCeil(v) {
        if (v <= 1) return 1;
        if (v <= 10) return Math.ceil(v / 2) * 2;
        // One order of magnitude down, so the step stays proportionate.
        const step = 2 * Math.pow(10, Math.floor(Math.log10(v)) - 1);
        return Math.ceil(v / step) * step;
    }

    // ── Plotting ────────────────────────────────────────────────────────────

    /* Smooth cubic through every point, using monotone (Fritsch–Carlson)
       tangents rather than plain Catmull-Rom.

       Catmull-Rom overshoots around a sharp change in slope. On a count series
       that means a quiet period between two busy ones bows the curve below zero
       — drawing negative sessions — and an isolated spike invents a taller
       phantom peak than any real bucket. Clamping the tangents guarantees each
       segment stays within its own two endpoints, so the curve is smooth but
       never claims a value the data does not contain. */
    function monotonePath(xs, ys) {
        const n = xs.length;
        if (n < 2) return `M${xs[0].toFixed(2)},${ys[0].toFixed(2)}`;

        const dx = [], d = [];
        for (let i = 0; i < n - 1; i++) {
            dx[i] = xs[i + 1] - xs[i];
            d[i] = (ys[i + 1] - ys[i]) / dx[i];
        }

        // Tangents: average of neighbouring secants, flattened at any turn.
        const m = [d[0]];
        for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
        m[n - 1] = d[n - 2];

        // Fritsch–Carlson: pull tangents back inside the circle of radius 3
        // around each secant. This is the step that kills the overshoot.
        for (let i = 0; i < n - 1; i++) {
            if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
            const a = m[i] / d[i], b = m[i + 1] / d[i];
            const s = a * a + b * b;
            if (s > 9) {
                const t = 3 / Math.sqrt(s);
                m[i] = t * a * d[i];
                m[i + 1] = t * b * d[i];
            }
        }

        let p = `M${xs[0].toFixed(2)},${ys[0].toFixed(2)}`;
        for (let i = 0; i < n - 1; i++) {
            const c1x = xs[i] + dx[i] / 3, c1y = ys[i] + (m[i] * dx[i]) / 3;
            const c2x = xs[i + 1] - dx[i] / 3, c2y = ys[i + 1] - (m[i + 1] * dx[i]) / 3;
            p += ` C${c1x.toFixed(2)},${c1y.toFixed(2)} ${c2x.toFixed(2)},${c2y.toFixed(2)} ${xs[i + 1].toFixed(2)},${ys[i + 1].toFixed(2)}`;
        }
        return p;
    }

    /* Takes [{values, cls}, ...] drawn back-to-front, so pass the context line
       first and the accent line last.

       `max` is always explicit, never derived: every series must share one
       scale or the gap between lines means nothing, and where an axis is drawn
       its ticks have to agree with it. Callers pass seriesPeak(series) for a
       bare plot, or niceCeil(seriesPeak(series)) when ticks are shown.

       Arbitrary viewBox units — the SVG stretches to fit its container, and
       .spark's non-scaling-stroke keeps the stroke a true 1.5px through it. */
    function renderSpark(series, max, ariaLabel) {
        const n = series[0].values.length;
        const xs = series[0].values.map((_, i) => (i / (n - 1)) * W);
        const paths = series.map(s => {
            const ys = s.values.map(v => H - PAD - (v / max) * (H - PAD * 2));
            return `<path class="${s.cls}" d="${monotonePath(xs, ys)}"/>`;
        }).join('');

        return `
        <svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img"
             aria-label="${escapeHtml(ariaLabel)}, peak ${max}">
            ${paths}
        </svg>`;
    }

    /* Y-axis ticks at the top, middle and bottom of the plot band, written into
       a .plot-axis element. The midpoint is dropped when it would be fractional
       — a "2.5 clients" gridline is worse than no gridline.

       These are HTML, never SVG <text>: the plot stretches non-uniformly, which
       would squash any text inside it. They align because the percentages are
       derived from the same PAD the plot uses. */
    function renderAxis(el, max) {
        const ticks = max >= 2 && max % 2 === 0 ? [max, max / 2, 0] : [max, 0];
        const top = (PAD / H) * 100;
        const span = ((H - PAD * 2) / H) * 100;
        el.innerHTML = ticks
            .map(v => `<span style="top:${(top + (1 - v / max) * span).toFixed(2)}%">${v.toLocaleString()}</span>`)
            .join('');
    }

    window.consoleUI = {
        DAY,
        escapeHtml, fullName, initials, formatRelativeDate, formatUntil,
        classifyClient,
        pickStep, seriesPeak, niceCeil, monotonePath, renderSpark, renderAxis,
    };
})();
