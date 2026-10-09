import { FREQUENCY, STRATEGY } from '../engine/constants.js';
import { formatINR, formatMonths, safeMonths, safeNumber } from './formatter.js';

/**
 * Turns a calculateLoanImpact() result into display-ready strings.
 * Every number passes through formatINR / formatMonths, so nothing here can
 * render NaN, undefined or Infinity.
 */
export function buildImpactView(impact) {
  const isReduceEMI = impact.strategy === STRATEGY.REDUCE_EMI;
  const hasPrepayment = impact.totalPrepaid > 0;
  const afterTenureMonths = safeMonths(impact.afterTenureMonths);
  const beforeTenureMonths = safeMonths(impact.beforeTenureMonths);

  const view = {
    strategyLabel: isReduceEMI ? 'Reduce EMI' : 'Reduce Tenure',
    before: {
      tenure: formatMonths(beforeTenureMonths),
      interest: formatINR(impact.beforeInterest),
    },
    after: {
      tenure: formatMonths(afterTenureMonths),
      interest: formatINR(impact.afterInterest),
    },
    metrics: {
      originalEMI: formatINR(impact.originalEMI),
      newEMI: formatINR(impact.newEMI),
      interestSaved: formatINR(impact.grossInterestSaved),
      newTenure: formatMonths(afterTenureMonths),
    },
    savings: {
      gross: formatINR(impact.grossInterestSaved),
      penalty: formatINR(impact.totalPenalty),
      net: formatINR(impact.netSavings),
      netIsNegative: safeNumber(impact.netSavings) < -0.5,
      hasPenalty: safeNumber(impact.totalPenalty) >= 0.5,
      totalPrepaid: formatINR(impact.totalPrepaid),
    },
    headline: '',
    note: '',
  };

  if (!hasPrepayment) {
    const entered = safeNumber(impact.prepaymentAmount) > 0;
    view.headline = entered
      ? `No ${impact.frequency === FREQUENCY.YEARLY ? 'yearly' : 'monthly'} prepayment falls within a ${beforeTenureMonths}-month tenure, so nothing changes.`
      : 'Add a prepayment amount to see how much interest you can save.';
    view.note = `Your EMI of ${formatINR(impact.originalEMI)} runs for ${formatMonths(beforeTenureMonths)}.`;
    return view;
  }

  if (afterTenureMonths === 0) {
    view.headline = `Your prepayment closes the loan before the first EMI and interest saved by you is ${view.savings.gross}`;
    view.note = 'Note: The prepayment covers the whole outstanding balance, so no EMIs are due.';
    return view;
  }

  // A prepayment that is larger than the balance left closes the loan at that
  // payment point. In Reduce EMI mode that is the only way tenure can shorten.
  const closedEarly = impact.closedByPrepayment && afterTenureMonths < beforeTenureMonths;
  const closingNote = closedEarly
    ? ` Your prepayment after month ${afterTenureMonths} covers the remaining balance, so the loan closes ${formatMonths(
        beforeTenureMonths - afterTenureMonths,
      )} before the original maturity.`
    : '';

  if (isReduceEMI) {
    view.headline = `Your EMI reduces by ${formatINR(impact.emiReduction)} per month and interest saved by you is ${view.savings.gross}`;
    const recurring = impact.frequency !== FREQUENCY.ONE_TIME && impact.emiRecalculations > 1;
    const tenureNote = closedEarly ? closingNote : ` Tenure stays at ${formatMonths(afterTenureMonths)}.`;
    view.note = recurring
      ? `Note: Your EMI reduces from ${formatINR(impact.originalEMI)} to ${formatINR(impact.newEMI)} after the first prepayment ` +
        `and is recalculated after every prepayment (${impact.emiRecalculations} times), reaching ${formatINR(impact.finalEMI)}.` +
        tenureNote
      : `Note: Your EMI reduces from ${formatINR(impact.originalEMI)} to ${formatINR(impact.newEMI)}.` + closingNote;
  } else {
    view.headline = `Your loan finishes ${formatMonths(impact.monthsSaved)} faster and interest saved by you is ${view.savings.gross}`;
    view.note = `Note: Your EMI of ${formatINR(impact.originalEMI)} remains the same.`;
  }
  return view;
}
