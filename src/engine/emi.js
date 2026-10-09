/** Monthly interest rate (decimal) from an annual percentage rate. */
export function monthlyRate(annualRate) {
  return annualRate / 12 / 100;
}

/**
 * Standard reducing-balance EMI.
 *   EMI = P * r * (1+r)^N / ((1+r)^N - 1),  or P / N when r = 0.
 * Returns 0 for a non-positive principal or tenure, never NaN/Infinity.
 */
export function calculateEMI(principal, annualRate, remainingTenureMonths) {
  if (!(principal > 0) || !(remainingTenureMonths >= 1)) return 0;
  const r = monthlyRate(annualRate);
  if (!(r > 0)) return principal / remainingTenureMonths;
  const growth = Math.pow(1 + r, remainingTenureMonths);
  const emi = (principal * r * growth) / (growth - 1);
  return Number.isFinite(emi) ? emi : 0;
}
