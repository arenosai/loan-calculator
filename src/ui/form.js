import { FREQUENCY, STRATEGY } from '../engine/constants.js';
import { formatIndianNumber, formatINR, formatYearsMonths } from '../format/formatter.js';

export const DEFAULT_INPUT = Object.freeze({
  principal: 370_000,
  tenureMonths: 30,
  annualRate: 10.85,
  frequency: FREQUENCY.ONE_TIME,
  prepayment: 100_000,
  penaltyPercent: 2,
  strategy: STRATEGY.REDUCE_TENURE,
});

const FIELDS = ['principal', 'tenureMonths', 'annualRate', 'prepayment', 'penaltyPercent'];

/** "80,00,000" / "₹ 5,00,000" / "" → number (NaN when not a number). */
export function parseAmount(text) {
  const cleaned = String(text ?? '').replace(/[₹,\s]/g, '');
  if (cleaned === '') return NaN;
  return /^-?\d*\.?\d+$/.test(cleaned) ? Number(cleaned) : NaN;
}

/** Amount fields show Indian grouping when idle and raw digits while editing. */
export function attachAmountFormatting(input) {
  input.addEventListener('focus', () => {
    const n = parseAmount(input.value);
    if (Number.isFinite(n)) input.value = String(n);
  });
  input.addEventListener('blur', () => {
    const n = parseAmount(input.value);
    if (Number.isFinite(n) && n >= 0) input.value = formatIndianNumber(n);
  });
}

export function createForm(form) {
  const el = (id) => form.querySelector(`#${id}`);
  const inputs = Object.fromEntries(FIELDS.map((f) => [f, el(f)]));
  const frequency = el('frequency');
  const strategyRadios = [...form.querySelectorAll('input[name="strategy"]')];

  form.querySelectorAll('[data-format="inr"]').forEach(attachAmountFormatting);

  /** Builds the explicit engine input object. */
  function read() {
    return {
      principal: parseAmount(inputs.principal.value),
      annualRate: parseAmount(inputs.annualRate.value),
      tenureMonths: parseAmount(inputs.tenureMonths.value),
      prepayment: inputs.prepayment.value.trim() === '' ? 0 : parseAmount(inputs.prepayment.value),
      frequency: frequency.value,
      strategy: strategyRadios.find((r) => r.checked)?.value ?? STRATEGY.REDUCE_TENURE,
      penaltyPercent: inputs.penaltyPercent.value.trim() === '' ? 0 : parseAmount(inputs.penaltyPercent.value),
    };
  }

  function write(values) {
    inputs.principal.value = formatIndianNumber(values.principal);
    inputs.tenureMonths.value = String(values.tenureMonths);
    inputs.annualRate.value = String(values.annualRate);
    inputs.prepayment.value = formatIndianNumber(values.prepayment);
    inputs.penaltyPercent.value = String(values.penaltyPercent);
    frequency.value = values.frequency;
    for (const r of strategyRadios) r.checked = r.value === values.strategy;
  }

  function showErrors(errors = {}) {
    for (const field of FIELDS) {
      const message = errors[field] ?? '';
      el(`${field}-error`).textContent = message;
      inputs[field].closest('.input-wrap').classList.toggle('invalid', Boolean(message));
      inputs[field].setAttribute('aria-invalid', message ? 'true' : 'false');
    }
  }

  function updateHints(values) {
    el('tenureMonths-hint').textContent = Number.isInteger(values.tenureMonths) && values.tenureMonths > 0
      ? formatYearsMonths(values.tenureMonths)
      : '';
    el('frequency-hint').textContent = {
      [FREQUENCY.ONE_TIME]: 'Paid once, before the first EMI.',
      [FREQUENCY.MONTHLY]: 'Paid after every EMI.',
      [FREQUENCY.YEARLY]: 'Paid after every 12th EMI.',
    }[values.frequency] ?? '';
    el('prepayment-label').textContent =
      values.frequency === FREQUENCY.ONE_TIME ? 'Prepayment amount' : 'Prepayment amount (each time)';
    // Hint shows the most a single event can cost; the engine charges on the
    // amount actually applied, which is capped at the outstanding balance.
    const cappedPrepayment = Math.min(values.prepayment, values.principal);
    const penalty = Number.isFinite(cappedPrepayment) && Number.isFinite(values.penaltyPercent)
      ? (cappedPrepayment * values.penaltyPercent) / 100
      : 0;
    el('prepayment-hint').textContent = penalty > 0
      ? `Penalty of up to ${formatINR(penalty)} per prepayment, charged separately.`
      : '';
    el('strategy-hint').textContent = values.strategy === STRATEGY.REDUCE_EMI
      ? 'Keeps your tenure; lowers the EMI after each prepayment.'
      : 'Keeps your EMI; closes the loan sooner.';
  }

  return { read, write, showErrors, updateHints, reset: () => write(DEFAULT_INPUT) };
}
