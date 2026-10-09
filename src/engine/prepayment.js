import { FREQUENCY, TOLERANCE } from './constants.js';

/**
 * Whether a prepayment event falls at `month`.
 * Month 0 means "immediately before the first EMI"; month m >= 1 means
 * "right after the m-th regular EMI".
 *   One-time → month 0 only
 *   Monthly  → after every EMI (1, 2, 3, …)
 *   Yearly   → after every 12th EMI (12, 24, 36, …)
 */
export function isPrepaymentMonth(frequency, month) {
  switch (frequency) {
    case FREQUENCY.ONE_TIME:
      return month === 0;
    case FREQUENCY.MONTHLY:
      return month >= 1;
    case FREQUENCY.YEARLY:
      return month >= 12 && month % 12 === 0;
    default:
      return false;
  }
}

/**
 * Applies one prepayment to a balance.
 * The principal reduction is capped at the outstanding balance. The penalty is
 * a charge on the amount actually applied and never reduces the principal.
 */
export function applyPrepayment(balance, prepayment, penaltyPercent) {
  if (!(balance > 0) || !(prepayment > 0)) {
    return { applied: 0, penalty: 0, closingBalance: Math.max(0, balance || 0) };
  }
  const applied = Math.min(prepayment, balance);
  let closingBalance = balance - applied;
  if (closingBalance < TOLERANCE) closingBalance = 0;
  const penalty = applied * (Math.max(0, penaltyPercent || 0) / 100);
  return { applied, penalty, closingBalance };
}
