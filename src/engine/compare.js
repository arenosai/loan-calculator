import { LIMITS } from './constants.js';
import { calculateOriginalLoan } from './loan.js';

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * EMI, total interest and total payable for a loan with no prepayment.
 * Totals come from the month-by-month schedule, not a shortcut formula.
 */
export function calculateLoanSummary({ principal, annualRate, tenureMonths }) {
  const schedule = calculateOriginalLoan({ principal, annualRate, tenureMonths });
  const totalInterest = schedule.totalInterest;
  return {
    principal,
    annualRate,
    tenureMonths,
    emi: schedule.originalEMI,
    totalInterest,
    totalPayment: principal + totalInterest,
    interestShare: principal > 0 ? (totalInterest / principal) * 100 : 0,
  };
}

/** Differences are alt − base: a negative interestDiff means `alt` is cheaper. */
export function compareLoans(base, alt) {
  const b = calculateLoanSummary(base);
  const a = calculateLoanSummary(alt);
  return {
    base: b,
    alt: a,
    emiDiff: a.emi - b.emi,
    interestDiff: a.totalInterest - b.totalInterest,
    totalDiff: a.totalPayment - b.totalPayment,
  };
}

function sweep(base, variants) {
  const baseSummary = calculateLoanSummary(base);
  return variants.map((loan) => {
    const summary = calculateLoanSummary(loan);
    return {
      ...summary,
      emiDiff: summary.emi - baseSummary.emi,
      interestDiff: summary.totalInterest - baseSummary.totalInterest,
      isBase:
        loan.principal === base.principal &&
        loan.annualRate === base.annualRate &&
        loan.tenureMonths === base.tenureMonths,
    };
  });
}

/** Same loan at rates from base − span to base + span (clamped to 0–50%). */
export function rateSweep(base, step = 0.25, span = 1) {
  const rates = new Set();
  const steps = Math.round(span / step);
  for (let i = -steps; i <= steps; i++) {
    const rate = round2(base.annualRate + i * step);
    if (rate >= 0 && rate <= LIMITS.MAX_RATE) rates.add(i === 0 ? base.annualRate : rate);
  }
  return sweep(
    base,
    [...rates].sort((x, y) => x - y).map((annualRate) => ({ ...base, annualRate })),
  );
}

/** Same loan over every whole year from 1 to max(base years + 2, 5), plus the base tenure. */
export function tenureSweep(base) {
  const maxYears = Math.min(
    Math.floor(LIMITS.MAX_TENURE_MONTHS / 12),
    Math.max(Math.ceil(base.tenureMonths / 12) + 2, 5),
  );
  const months = new Set([base.tenureMonths]);
  for (let y = 1; y <= maxYears; y++) months.add(y * 12);
  return sweep(
    base,
    [...months].sort((x, y) => x - y).map((tenureMonths) => ({ ...base, tenureMonths })),
  );
}

/** Same rate and tenure for the base amount ±10% and ±20% (rounded to ₹1,000). */
export function amountSweep(base) {
  const amounts = new Set([base.principal]);
  for (const factor of [0.8, 0.9, 1.1, 1.2]) {
    const amount = Math.round((base.principal * factor) / 1000) * 1000;
    if (amount > 0) amounts.add(amount);
  }
  return sweep(
    base,
    [...amounts].sort((x, y) => x - y).map((principal) => ({ ...base, principal })),
  );
}

/** Interest paid so far at the end of each month: [{ month: 0, value: 0 }, …, { month: N, value: totalInterest }]. */
export function cumulativeInterestSeries({ principal, annualRate, tenureMonths }) {
  const { rows } = calculateOriginalLoan({ principal, annualRate, tenureMonths });
  let total = 0;
  return [{ month: 0, value: 0 }, ...rows.map((r) => ({ month: r.month, value: (total += r.interest) }))];
}
