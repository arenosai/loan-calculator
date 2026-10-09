/** Balances below this many rupees are treated as fully repaid. */
export const TOLERANCE = 0.01;

export const STRATEGY = Object.freeze({
  REDUCE_TENURE: 'reduce-tenure',
  REDUCE_EMI: 'reduce-emi',
});

export const FREQUENCY = Object.freeze({
  ONE_TIME: 'one-time',
  MONTHLY: 'monthly',
  YEARLY: 'yearly',
});

export const LIMITS = Object.freeze({
  MAX_RATE: 50,
  MAX_PENALTY: 100,
  MAX_TENURE_MONTHS: 600,
});
