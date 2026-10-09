import {
  amountSweep,
  calculateLoanSummary,
  compareLoans,
  cumulativeInterestSeries,
  FREQUENCY,
  rateSweep,
  STRATEGY,
  tenureSweep,
  validateLoanInput,
} from '../engine/index.js';
import { formatIndianNumber, formatINR, formatPercent, safeNumber } from '../format/formatter.js';
import { attachAmountFormatting, parseAmount } from './form.js';
import { createInterestChart } from './chart.js';

const DEFAULTS = Object.freeze({
  loan: { principal: 110_000, annualRate: 9, tenureMonths: 60 },
  compare: { principal: 110_000, annualRate: 8.5, tenureMonths: 60 },
});

const $ = (id) => document.getElementById(id);
const outs = Object.fromEntries([...document.querySelectorAll('[data-out]')].map((n) => [n.dataset.out, n]));
const set = (key, text) => {
  if (outs[key]) outs[key].textContent = text;
};

const main = {
  form: $('loan-form'),
  errorId: 'loan-error',
  principal: $('principal'),
  annualRate: $('annualRate'),
  years: $('tenureYears'),
  months: $('tenureExtraMonths'),
};
const cmp = {
  form: $('compare-form'),
  errorId: 'compare-error',
  principal: $('cmpPrincipal'),
  annualRate: $('cmpRate'),
  years: $('cmpYears'),
  months: $('cmpMonths'),
};

// Loan B's amount and tenure track Loan A until the user edits them.
const linked = { principal: true, tenure: true };
let activeSweep = 'rate';

document.querySelectorAll('[data-format="inr"]').forEach(attachAmountFormatting);

const interestChart = createInterestChart($('interest-chart'));
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/* ---------- Reading & writing inputs ---------- */

function parseWhole(input) {
  const text = input.value.trim();
  if (text === '') return 0;
  const n = Number(text);
  return Number.isInteger(n) && n >= 0 ? n : NaN;
}

function readLoan(fields) {
  const years = parseWhole(fields.years);
  const months = parseWhole(fields.months);
  return {
    loan: {
      principal: parseAmount(fields.principal.value),
      annualRate: parseAmount(fields.annualRate.value),
      tenureMonths: years * 12 + months,
    },
    tenureFieldsValid: Number.isFinite(years) && Number.isFinite(months) && months <= 11,
  };
}

function writeLoan(fields, { principal, annualRate, tenureMonths }) {
  fields.principal.value = formatIndianNumber(principal);
  fields.annualRate.value = String(annualRate);
  writeTenure(fields, tenureMonths);
}

function writeTenure(fields, tenureMonths) {
  fields.years.value = String(Math.floor(tenureMonths / 12));
  fields.months.value = String(tenureMonths % 12);
}

/** Validates a loan using the engine's shared limits. Returns field-keyed errors. */
function validate({ loan, tenureFieldsValid }) {
  const { errors } = validateLoanInput({
    ...loan,
    prepayment: 0,
    penaltyPercent: 0,
    frequency: FREQUENCY.ONE_TIME,
    strategy: STRATEGY.REDUCE_TENURE,
  });
  if (!tenureFieldsValid) errors.tenureMonths = 'Use whole years and 0–11 extra months.';
  else if (errors.tenureMonths) errors.tenureMonths = 'Tenure must be between 1 month and 50 years.';
  return errors;
}

/** Shows the first error under a loan box and highlights the fields at fault. */
function showErrors(fields, errors) {
  const messages = Object.values(errors);
  $(fields.errorId).textContent = messages[0] ?? '';
  const bad = {
    principal: [fields.principal],
    annualRate: [fields.annualRate],
    tenureMonths: [fields.years, fields.months],
  };
  for (const [field, inputs] of Object.entries(bad)) {
    for (const input of inputs) {
      input.closest('.input-wrap').classList.toggle('invalid', Boolean(errors[field]));
      input.setAttribute('aria-invalid', errors[field] ? 'true' : 'false');
    }
  }
  return messages.length === 0;
}

/* ---------- Formatting helpers ---------- */

/** 60 → "5 years", 54 → "4 years 6 months", 13 → "1 year 1 month" */
function tenureText(totalMonths) {
  const years = Math.floor(totalMonths / 12);
  const months = totalMonths % 12;
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  if (years === 0) return plural(months, 'month');
  return months === 0 ? plural(years, 'year') : `${plural(years, 'year')} ${plural(months, 'month')}`;
}

/** "+₹1,200", "−₹597", "No change" */
function signedINR(value) {
  const rounded = Math.round(safeNumber(value));
  if (rounded === 0) return 'No change';
  return `${rounded > 0 ? '+' : '−'}${formatINR(Math.abs(rounded))}`;
}

function toneClass(value) {
  const rounded = Math.round(safeNumber(value));
  return rounded < 0 ? 'diff-good' : rounded > 0 ? 'diff-bad' : 'diff-neutral';
}

function describeChange(base, alt) {
  const parts = [];
  if (alt.annualRate !== base.annualRate) parts.push(`at ${formatPercent(alt.annualRate)}`);
  if (alt.tenureMonths !== base.tenureMonths) parts.push(`over ${tenureText(alt.tenureMonths)}`);
  if (alt.principal !== base.principal) parts.push(`for ${formatINR(alt.principal)}`);
  return parts.join(' ');
}

function compareHeadline(c) {
  const change = describeChange(c.base, c.alt);
  if (!change) return 'Loan A and Loan B are the same. Change the rate, tenure or amount of either loan to compare.';
  const interest = Math.round(c.interestDiff);
  const emi = Math.round(c.emiDiff);
  const interestPart =
    interest === 0
      ? 'Loan B costs the same interest'
      : `Loan B costs ${formatINR(Math.abs(interest))} ${interest < 0 ? 'less' : 'more'} interest`;
  const emiPart =
    emi === 0
      ? 'with the same EMI'
      : `and its EMI is ${formatINR(Math.abs(emi))} ${emi < 0 ? 'lower' : 'higher'} each month`;
  return `${change.charAt(0).toUpperCase()}${change.slice(1)}, ${interestPart} ${emiPart}.`;
}

/* ---------- Rendering ---------- */

const DIFF_KEYS = ['emiDiff', 'interestDiff', 'totalDiff'];

function renderLoan(prefix, summary) {
  set(`${prefix}Emi`, summary ? formatINR(summary.emi) : '—');
  set(`${prefix}Interest`, summary ? formatINR(summary.totalInterest) : '—');
  set(`${prefix}Total`, summary ? formatINR(summary.totalPayment) : '—');
}

function renderDifference(c) {
  const diffBlock = $('difference');
  diffBlock.querySelectorAll('[data-diff]').forEach((n) => n.classList.remove('diff-good', 'diff-bad', 'diff-neutral'));
  if (!c) {
    DIFF_KEYS.forEach((k) => set(k, '—'));
    set('compareHeadline', 'Fix the highlighted fields to see the difference.');
    return;
  }
  set('emiDiff', signedINR(c.emiDiff));
  set('interestDiff', signedINR(c.interestDiff));
  set('totalDiff', signedINR(c.totalDiff));
  set('compareHeadline', compareHeadline(c));
  for (const [key, value] of [['emi', c.emiDiff], ['interest', c.interestDiff], ['total', c.totalDiff]]) {
    diffBlock.querySelector(`[data-diff="${key}"]`).classList.add(toneClass(value));
  }
}

/** Cumulative interest for each valid loan. Loan A is drawn last so it sits on top. */
function renderInterestChart(a, b) {
  const series = [];
  if (b) series.push({ label: 'Loan B', shortLabel: 'B', className: 'line-loan-b', color: cssVar('--loan-b'), points: cumulativeInterestSeries(b) });
  if (a) series.push({ label: 'Loan A', shortLabel: 'A', className: 'line-loan-a', color: cssVar('--loan-a'), points: cumulativeInterestSeries(a) });

  if (series.length === 0) {
    $('interest-chart').replaceChildren();
    set('chartSummary', 'Fix the highlighted fields to see the chart.');
    return;
  }
  interestChart.render(series);
  if (a && b) {
    const diff = Math.round(series[0].points.at(-1).value - series[1].points.at(-1).value);
    set(
      'chartSummary',
      diff === 0
        ? 'Both loans cost the same total interest.'
        : `Loan B pays ${formatINR(Math.abs(diff))} ${diff < 0 ? 'less' : 'more'} interest in total than Loan A.`,
    );
  } else {
    set('chartSummary', `Fix Loan ${a ? 'B' : 'A'} to compare both lines.`);
  }
}

const SWEEPS = {
  rate: { column: 'Rate', rows: (b) => rateSweep(b), label: (r) => formatPercent(r.annualRate) },
  tenure: { column: 'Tenure', rows: (b) => tenureSweep(b), label: (r) => tenureText(r.tenureMonths) },
  amount: { column: 'Loan amount', rows: (b) => amountSweep(b), label: (r) => formatINR(r.principal) },
};

function renderSweep(baseLoan) {
  const sweep = SWEEPS[activeSweep];
  $('sweep-col').textContent = sweep.column;
  const rows = sweep.rows(baseLoan);
  $('sweep-body').innerHTML = rows
    .map((r, i) => {
      const label = sweep.label(r);
      const first = r.isBase
        ? label
        : `<button type="button" class="link-btn" data-row="${i}" aria-label="Load ${label} into Loan B">${label}</button>`;
      const diff = r.isBase ? 'Loan A' : signedINR(r.interestDiff);
      const tone = r.isBase ? '' : toneClass(r.interestDiff);
      return (
        `<tr${r.isBase ? ' class="is-base" aria-current="true"' : ''}>` +
        `<td>${first}</td><td>${formatINR(r.emi)}</td><td>${formatINR(r.totalInterest)}</td>` +
        `<td class="${tone}">${diff}</td></tr>`
      );
    })
    .join('');
  $('sweep-body').dataset.rows = JSON.stringify(
    rows.map(({ principal, annualRate, tenureMonths }) => ({ principal, annualRate, tenureMonths })),
  );
}

function calculate() {
  const a = readLoan(main);
  const aValid = showErrors(main, validate(a));
  if (aValid) {
    if (linked.principal) cmp.principal.value = formatIndianNumber(a.loan.principal);
    if (linked.tenure) writeTenure(cmp, a.loan.tenureMonths);
  }
  const b = readLoan(cmp);
  const bValid = showErrors(cmp, validate(b));

  renderLoan('a', aValid ? calculateLoanSummary(a.loan) : null);
  renderLoan('b', bValid ? calculateLoanSummary(b.loan) : null);
  renderDifference(aValid && bValid ? compareLoans(a.loan, b.loan) : null);
  renderInterestChart(aValid ? a.loan : null, bValid ? b.loan : null);

  if (aValid) renderSweep(a.loan);
  else $('sweep-body').innerHTML = '<tr><td colspan="4">Fix Loan A to see this table.</td></tr>';
}

/* ---------- Events ---------- */

main.form.addEventListener('input', calculate);
main.form.addEventListener('submit', (e) => e.preventDefault());

cmp.form.addEventListener('input', (e) => {
  if (e.target === cmp.principal) linked.principal = false;
  if (e.target === cmp.years || e.target === cmp.months) linked.tenure = false;
  calculate();
});
cmp.form.addEventListener('submit', (e) => e.preventDefault());

$('reset-btn').addEventListener('click', () => {
  writeLoan(main, DEFAULTS.loan);
  writeLoan(cmp, DEFAULTS.compare);
  linked.principal = true;
  linked.tenure = true;
  calculate();
});

$('swap-btn').addEventListener('click', () => {
  const a = readLoan(main);
  const b = readLoan(cmp);
  if (Object.keys(validate(a)).length || Object.keys(validate(b)).length) return;
  writeLoan(main, b.loan);
  writeLoan(cmp, a.loan);
  linked.principal = false;
  linked.tenure = false;
  calculate();
});

$('sweep-body').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-row]');
  if (!btn) return;
  const loan = JSON.parse($('sweep-body').dataset.rows)[Number(btn.dataset.row)];
  writeLoan(cmp, loan);
  linked.principal = false;
  linked.tenure = false;
  calculate();
  $('compare-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

const tabs = [...document.querySelectorAll('[role="tab"]')];
function selectTab(tab) {
  for (const t of tabs) {
    const selected = t === tab;
    t.setAttribute('aria-selected', String(selected));
    t.tabIndex = selected ? 0 : -1;
  }
  $('panel').setAttribute('aria-labelledby', tab.id);
  activeSweep = tab.dataset.sweep;
  calculate();
}
tabs.forEach((tab, i) => {
  tab.addEventListener('click', () => selectTab(tab));
  tab.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    next.focus();
    selectTab(next);
  });
});

// Line colours come from CSS tokens, so redraw when the colour scheme flips.
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', calculate);

writeLoan(main, DEFAULTS.loan);
writeLoan(cmp, DEFAULTS.compare);
calculate();
