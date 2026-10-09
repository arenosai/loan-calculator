import { formatINR, formatINRCompact, formatMonths } from '../format/formatter.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const PAD = { top: 16, right: 18, bottom: 40, left: 56 };

function svgEl(name, attrs = {}) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

/** Rounded "nice" tick step for the y-axis. */
function niceStep(max, targetTicks) {
  const raw = max / targetTicks;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  return nice * mag;
}

function monthStep(maxMonth, width) {
  const target = Math.max(3, Math.floor(width / 70));
  const candidates = [1, 2, 3, 6, 12, 24, 36, 60, 120];
  return candidates.find((c) => maxMonth / c <= target) ?? 120;
}

/**
 * Month-based line chart with a crosshair tooltip.
 * `series` = [{ label, shortLabel, className, color, points: [{ month, value }] }], where points[i].month === i.
 *
 * options.afterEnd    'zero' → a series reads 0 after its last month (a paid-off balance);
 *                     'hold' → it keeps its last value (a running total).
 * options.markEnds    'baseline' → end dot on the x-axis labelled with the month;
 *                     'value'    → end dot on the line labelled with endLabel(series, end).
 * options.ariaLabel   (series) => accessible summary of the chart.
 */
function createLineChart(container, { afterEnd, markEnds, endLabel, ariaLabel }) {
  const tooltip = document.createElement('div');
  tooltip.className = 'tooltip';
  tooltip.hidden = true;
  let current = null;

  function render(series) {
    current = series;
    draw();
  }

  function draw() {
    if (!current) return;
    const width = Math.max(260, container.clientWidth);
    const height = Math.max(200, container.clientHeight);
    const compact = width < 480;
    const pad = { ...PAD, left: compact ? 48 : PAD.left };
    const plotW = width - pad.left - pad.right;
    const plotH = height - pad.top - pad.bottom;

    const maxMonth = Math.max(1, ...current.map((s) => s.points.at(-1)?.month ?? 0));
    const maxValue = Math.max(1, ...current.flatMap((s) => s.points.map((p) => p.value)));
    const yStep = niceStep(maxValue, compact ? 4 : 5);
    const yMax = Math.ceil(maxValue / yStep) * yStep;

    const x = (m) => pad.left + (m / maxMonth) * plotW;
    const y = (b) => pad.top + plotH - (b / yMax) * plotH;

    const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, 'aria-hidden': 'true' });

    // Grid + y-axis labels
    for (let v = 0; v <= yMax + 1e-6; v += yStep) {
      svg.append(svgEl('line', { class: 'grid-line', x1: pad.left, x2: width - pad.right, y1: y(v), y2: y(v) }));
      const label = svgEl('text', { class: 'axis-label', x: pad.left - 8, y: y(v) + 4, 'text-anchor': 'end' });
      label.textContent = formatINRCompact(v);
      svg.append(label);
    }
    // x-axis labels
    const xStep = monthStep(maxMonth, plotW);
    for (let m = 0; m <= maxMonth; m += xStep) {
      const label = svgEl('text', { class: 'axis-label', x: x(m), y: pad.top + plotH + 18, 'text-anchor': 'middle' });
      label.textContent = String(m);
      svg.append(label);
    }
    const xTitle = svgEl('text', { class: 'axis-title', x: pad.left + plotW / 2, y: height - 4, 'text-anchor': 'middle' });
    xTitle.textContent = 'Tenure (months)';
    svg.append(xTitle);

    // Lines (first series underneath, last on top)
    for (const s of current) {
      const d = s.points.map((p, i) => `${i ? 'L' : 'M'}${x(p.month).toFixed(1)},${y(p.value).toFixed(1)}`).join('');
      svg.append(svgEl('path', { class: `line ${s.className}`, d }));
    }

    if (markEnds === 'baseline') drawBaselineEnds(svg, x, y, width);
    else drawValueEnds(svg, x, y);

    // Hover layer
    const crosshair = svgEl('line', { class: 'crosshair', y1: pad.top, y2: pad.top + plotH, visibility: 'hidden' });
    const dots = current.map((s) => svgEl('circle', { class: 'hover-dot', r: 4.5, fill: s.color, visibility: 'hidden' }));
    const hit = svgEl('rect', { x: pad.left, y: pad.top, width: plotW, height: plotH, fill: 'transparent' });
    svg.append(crosshair, ...dots, hit);

    const valueAt = (s, m) => s.points[m]?.value ?? (afterEnd === 'hold' ? s.points.at(-1).value : 0);

    const onMove = (evt) => {
      const rect = svg.getBoundingClientRect();
      const scale = width / rect.width;
      const px = (evt.clientX - rect.left) * scale;
      const m = Math.min(maxMonth, Math.max(0, Math.round(((px - pad.left) / plotW) * maxMonth)));
      crosshair.setAttribute('x1', x(m));
      crosshair.setAttribute('x2', x(m));
      crosshair.setAttribute('visibility', 'visible');
      const rowsHtml = current
        .map((s, i) => {
          const b = valueAt(s, m);
          dots[i].setAttribute('cx', x(m));
          dots[i].setAttribute('cy', y(b));
          dots[i].setAttribute('visibility', 'visible');
          return `<div class="tt-row"><span class="tt-key"><span class="swatch" style="background:${s.color}"></span>${s.label}</span><b>${formatINR(b)}</b></div>`;
        })
        .reverse()
        .join('');
      tooltip.innerHTML = `<div class="tt-title">Month ${m}${m === 0 ? ' (start)' : ''}</div>${rowsHtml}`;
      tooltip.hidden = false;
      const tipW = tooltip.offsetWidth;
      const left = x(m) / scale;
      const flip = left + tipW + 16 > rect.width;
      const preferred = flip ? left - tipW - 12 : left + 12;
      tooltip.style.left = `${Math.max(0, Math.min(rect.width - tipW, preferred))}px`;
      tooltip.style.top = `${pad.top / scale}px`;
    };
    const onLeave = () => {
      tooltip.hidden = true;
      crosshair.setAttribute('visibility', 'hidden');
      dots.forEach((d) => d.setAttribute('visibility', 'hidden'));
    };
    hit.addEventListener('pointermove', onMove);
    hit.addEventListener('pointerdown', onMove);
    hit.addEventListener('pointerleave', onLeave);

    container.replaceChildren(svg, tooltip);
    container.setAttribute('aria-label', ariaLabel(current));
  }

  /** Payoff markers on the x-axis, labelled with the month each line ends. */
  function drawBaselineEnds(svg, x, y, width) {
    const ends = current.map((s) => ({ s, end: s.points.at(-1) }));
    const sameEnd = ends.length === 2 && ends[0].end.month === ends[1].end.month;
    ends.forEach(({ s, end }, i) => {
      svg.append(svgEl('circle', { class: 'end-dot', cx: x(end.month), cy: y(0), r: 4.5, fill: s.color }));
      if (sameEnd && i === 0) return;
      const anchor = x(end.month) > width - 80 ? 'end' : 'middle';
      const label = svgEl('text', {
        class: 'direct-label',
        x: x(end.month),
        y: y(0) - 12 - (sameEnd ? 0 : i * 14),
        'text-anchor': anchor,
      });
      label.textContent = sameEnd ? `Both end · month ${end.month}` : `${s.shortLabel} · month ${end.month}`;
      svg.append(label);
    });
  }

  /** End dots on each line, labelled to the left; labels are pushed apart when they would overlap. */
  function drawValueEnds(svg, x, y) {
    const ends = current
      .map((s) => ({ s, end: s.points.at(-1) }))
      .map((e) => ({ ...e, cx: x(e.end.month), cy: y(e.end.value), ly: y(e.end.value) - 10 }));
    const sorted = [...ends].sort((a, b) => a.ly - b.ly);
    for (let i = 1; i < sorted.length; i++) {
      if (Math.abs(sorted[i].cx - sorted[i - 1].cx) < 140 && sorted[i].ly - sorted[i - 1].ly < 15) {
        sorted[i].ly = sorted[i - 1].ly + 15;
      }
    }
    for (const e of ends) {
      svg.append(svgEl('circle', { class: 'end-dot', cx: e.cx, cy: e.cy, r: 4.5, fill: e.s.color }));
      const roomOnLeft = e.cx > 170; // short lines end near the y-axis: label to the right instead
      const label = svgEl('text', {
        class: 'direct-label',
        x: roomOnLeft ? e.cx - 8 : e.cx + 8,
        y: e.ly + 4,
        'text-anchor': roomOnLeft ? 'end' : 'start',
      });
      label.textContent = endLabel(e.s, e.end);
      svg.append(label);
    }
  }

  let frame = 0;
  new ResizeObserver(() => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(draw);
  }).observe(container);

  return { render };
}

/** Outstanding balance by month for the prepayment calculator. Points are { month, balance }. */
export function createBalanceChart(container) {
  const chart = createLineChart(container, {
    afterEnd: 'zero',
    markEnds: 'baseline',
    ariaLabel: (series) =>
      `Outstanding balance by month. ` +
      series.map((s) => `${s.label} reaches ₹0 at ${formatMonths(s.points.at(-1).month)}`).join('; ') +
      '.',
  });
  return {
    render: (series) =>
      chart.render(series.map((s) => ({ ...s, points: s.points.map((p) => ({ month: p.month, value: p.balance })) }))),
  };
}

/** Interest paid so far by month. Points are { month, value }. */
export function createInterestChart(container) {
  return createLineChart(container, {
    afterEnd: 'hold',
    markEnds: 'value',
    endLabel: (s, end) => `${s.shortLabel} · ${formatINR(end.value)}`,
    ariaLabel: (series) =>
      `Interest paid so far by month. ` +
      series.map((s) => `${s.label} totals ${formatINR(s.points.at(-1).value)} over ${formatMonths(s.points.at(-1).month)}`).join('; ') +
      '.',
  });
}
