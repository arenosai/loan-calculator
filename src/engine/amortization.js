import { TOLERANCE } from './constants.js';
import { calculateEMI, monthlyRate } from './emi.js';
import { applyPrepayment, isPrepaymentMonth } from './prepayment.js';

/**
 * Month-by-month amortization simulation shared by every scenario.
 *
 * Each month:  interest = balance * r;  principalPaid = EMI - interest;  balance -= principalPaid
 * then, if a prepayment event falls on that month, the prepayment reduces the balance.
 *
 * @param {object} params
 * @param {number} params.principal       Outstanding principal (INR)
 * @param {number} params.annualRate      Annual interest rate (%)
 * @param {number} params.tenureMonths    Original remaining tenure (months, integer >= 1)
 * @param {number} params.prepayment      Amount per prepayment event (0 = none)
 * @param {string} params.frequency       FREQUENCY value
 * @param {number} params.penaltyPercent  Penalty as % of each applied prepayment
 * @param {boolean} params.recalculateEMI true → Reduce EMI (re-derive EMI over the
 *        months left after every prepayment); false → Reduce Tenure (EMI fixed).
 */
export function generateSchedule({
  principal,
  annualRate,
  tenureMonths,
  prepayment,
  frequency,
  penaltyPercent,
  recalculateEMI,
}) {
  const r = monthlyRate(annualRate);
  const originalEMI = calculateEMI(principal, annualRate, tenureMonths);

  let balance = principal;
  let emi = originalEMI;
  let totalInterest = 0;
  let totalPrepaid = 0;
  let totalPenalty = 0;
  let totalEMIPaid = 0;
  const rows = [];
  const emiChanges = [];
  const prepaymentEvents = [];

  const prepayAt = (month) => {
    if (!(prepayment > 0) || !isPrepaymentMonth(frequency, month) || !(balance > 0)) return 0;
    const { applied, penalty, closingBalance } = applyPrepayment(balance, prepayment, penaltyPercent);
    balance = closingBalance;
    totalPrepaid += applied;
    totalPenalty += penalty;
    prepaymentEvents.push({ month, applied, penalty, balanceAfter: balance });

    if (recalculateEMI && balance > 0) {
      const remainingTenureMonths = tenureMonths - month;
      emi = calculateEMI(balance, annualRate, remainingTenureMonths);
      emiChanges.push({ month, remainingTenureMonths, emi });
    }
    return applied;
  };

  // One-time prepayment lands before the first EMI.
  const upfrontPrepayment = prepayAt(0);
  const balanceSeries = [{ month: 0, balance }];

  for (let month = 1; month <= tenureMonths && balance > 0; month++) {
    const openingBalance = balance;
    const interest = openingBalance * r;
    let principalPaid = Math.max(0, emi - interest);

    // Final payment is capped so the balance lands on exactly 0. Closing at the
    // original maturity also absorbs floating-point drift in both strategies.
    if (principalPaid >= openingBalance - TOLERANCE || month === tenureMonths) {
      principalPaid = openingBalance;
    }

    const payment = principalPaid + interest;
    balance = openingBalance - principalPaid;
    if (balance < TOLERANCE) balance = 0;

    totalInterest += interest;
    totalEMIPaid += payment;

    const scheduledEMI = emi;
    const prepaid = prepayAt(month);
    const lastEvent = prepaid > 0 ? prepaymentEvents[prepaymentEvents.length - 1] : null;

    rows.push({
      month,
      openingBalance,
      emi: scheduledEMI,
      payment,
      interest,
      principalPaid,
      prepayment: prepaid,
      penalty: lastEvent ? lastEvent.penalty : 0,
      closingBalance: balance,
    });
    balanceSeries.push({ month, balance });
  }

  const actualTenureMonths = rows.length;
  const closedByPrepayment =
    prepaymentEvents.length > 0 && prepaymentEvents[prepaymentEvents.length - 1].balanceAfter === 0;

  let newEMI;
  if (actualTenureMonths === 0) newEMI = 0;
  else if (emiChanges.length > 0) newEMI = emiChanges[0].emi;
  else newEMI = originalEMI;

  const finalEMI = emiChanges.length > 0 ? emiChanges[emiChanges.length - 1].emi : newEMI;

  return {
    rows,
    balanceSeries,
    emiChanges,
    prepaymentEvents,
    originalEMI,
    newEMI,
    finalEMI,
    upfrontPrepayment,
    tenureMonths: actualTenureMonths,
    totalInterest,
    totalPrepaid,
    totalPenalty,
    totalEMIPaid,
    closedByPrepayment,
  };
}
