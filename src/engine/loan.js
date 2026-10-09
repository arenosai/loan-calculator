import { FREQUENCY, LIMITS, STRATEGY } from './constants.js';
import { calculateEMI } from './emi.js';
import { generateSchedule } from './amortization.js';

const finiteOr = (value, fallback = 0) => (Number.isFinite(value) ? value : fallback);

/**
 * Validates raw calculator input. Returns field-keyed error messages so the UI
 * can show them inline. An empty `errors` object means the input is usable.
 */
export function validateLoanInput(input) {
  const { principal, annualRate, tenureMonths, prepayment, frequency, strategy, penaltyPercent } = input ?? {};
  const errors = {};

  if (!Number.isFinite(principal) || principal <= 0) errors.principal = 'Enter a principal greater than ₹0.';

  if (!Number.isFinite(tenureMonths) || tenureMonths < 1) errors.tenureMonths = 'Tenure must be at least 1 month.';
  else if (!Number.isInteger(tenureMonths)) errors.tenureMonths = 'Tenure must be a whole number of months.';
  else if (tenureMonths > LIMITS.MAX_TENURE_MONTHS)
    errors.tenureMonths = `Tenure can be at most ${LIMITS.MAX_TENURE_MONTHS} months.`;

  if (!Number.isFinite(annualRate) || annualRate < 0) errors.annualRate = 'Interest rate cannot be negative.';
  else if (annualRate > LIMITS.MAX_RATE) errors.annualRate = `Interest rate can be at most ${LIMITS.MAX_RATE}%.`;

  if (!Number.isFinite(prepayment) || prepayment < 0) errors.prepayment = 'Prepayment cannot be negative.';

  if (!Number.isFinite(penaltyPercent) || penaltyPercent < 0) errors.penaltyPercent = 'Penalty cannot be negative.';
  else if (penaltyPercent > LIMITS.MAX_PENALTY) errors.penaltyPercent = 'Penalty can be at most 100%.';

  if (!Object.values(FREQUENCY).includes(frequency)) errors.frequency = 'Choose a prepayment frequency.';
  if (!Object.values(STRATEGY).includes(strategy)) errors.strategy = 'Choose a strategy.';

  return { valid: Object.keys(errors).length === 0, errors };
}

/** Baseline schedule with no prepayment at all. */
export function calculateOriginalLoan({ principal, annualRate, tenureMonths }) {
  return generateSchedule({
    principal,
    annualRate,
    tenureMonths,
    prepayment: 0,
    frequency: FREQUENCY.ONE_TIME,
    penaltyPercent: 0,
    recalculateEMI: false,
  });
}

/** Prepayments shorten the loan; the EMI stays at the original amount. */
export function calculateReduceTenure({ principal, annualRate, tenureMonths, prepayment, frequency, penaltyPercent }) {
  return generateSchedule({
    principal,
    annualRate,
    tenureMonths,
    prepayment,
    frequency,
    penaltyPercent,
    recalculateEMI: false,
  });
}

/** Prepayments lower the EMI; the original maturity month is kept. */
export function calculateReduceEMI({ principal, annualRate, tenureMonths, prepayment, frequency, penaltyPercent }) {
  return generateSchedule({
    principal,
    annualRate,
    tenureMonths,
    prepayment,
    frequency,
    penaltyPercent,
    recalculateEMI: true,
  });
}

/** Interest saved from actual schedules (sum of monthly interest), net of penalty. */
export function calculateInterestSaved(original, scenario) {
  const grossInterestSaved = Math.max(0, finiteOr(original.totalInterest) - finiteOr(scenario.totalInterest));
  const totalPenalty = Math.max(0, finiteOr(scenario.totalPenalty));
  return { grossInterestSaved, totalPenalty, netSavings: grossInterestSaved - totalPenalty };
}

/**
 * Full comparison for the UI: baseline vs. the selected strategy.
 * Input: { principal, annualRate, tenureMonths, prepayment, frequency, strategy, penaltyPercent }
 */
export function calculateLoanImpact(input) {
  const { principal, annualRate, tenureMonths, prepayment, frequency, strategy, penaltyPercent } = input;
  const validation = validateLoanInput(input);
  if (!validation.valid) return { ok: false, errors: validation.errors };

  const original = calculateOriginalLoan({ principal, annualRate, tenureMonths });
  const scenarioInput = { principal, annualRate, tenureMonths, prepayment, frequency, penaltyPercent };
  const scenario =
    strategy === STRATEGY.REDUCE_EMI ? calculateReduceEMI(scenarioInput) : calculateReduceTenure(scenarioInput);
  const savings = calculateInterestSaved(original, scenario);

  const beforeTenureMonths = original.tenureMonths;
  const afterTenureMonths = scenario.tenureMonths;

  return {
    ok: true,
    strategy,
    frequency,
    original,
    scenario,
    originalEMI: finiteOr(original.originalEMI),
    newEMI: finiteOr(scenario.newEMI),
    finalEMI: finiteOr(scenario.finalEMI),
    emiReduction: Math.max(0, finiteOr(original.originalEMI) - finiteOr(scenario.newEMI)),
    beforeTenureMonths,
    afterTenureMonths,
    monthsSaved: Math.max(0, beforeTenureMonths - afterTenureMonths),
    beforeInterest: finiteOr(original.totalInterest),
    afterInterest: finiteOr(scenario.totalInterest),
    ...savings,
    prepaymentAmount: finiteOr(prepayment),
    totalPrepaid: finiteOr(scenario.totalPrepaid),
    prepaymentCount: scenario.prepaymentEvents.length,
    emiRecalculations: scenario.emiChanges.length,
    closedByPrepayment: scenario.closedByPrepayment,
  };
}

export { calculateEMI };
