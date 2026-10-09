import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateEMI,
  calculateOriginalLoan,
  calculateReduceTenure,
  calculateReduceEMI,
  calculateInterestSaved,
  calculateLoanImpact,
  validateLoanInput,
  STRATEGY,
  FREQUENCY,
} from '../src/engine/index.js';
import { formatINR, formatMonths } from '../src/format/formatter.js';
import { buildImpactView } from '../src/format/resultView.js';

const base = {
  principal: 1_000_000,
  annualRate: 12,
  tenureMonths: 24,
  prepayment: 200_000,
  frequency: FREQUENCY.ONE_TIME,
  strategy: STRATEGY.REDUCE_TENURE,
  penaltyPercent: 0,
};

/** Every numeric leaf in the result must be finite; no balance may go negative. */
function assertSane(schedule) {
  const walk = (value, path) => {
    if (typeof value === 'number') assert.ok(Number.isFinite(value), `${path} is not finite: ${value}`);
    else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) walk(v, `${path}.${k}`);
  };
  walk(schedule, 'schedule');
  for (const row of schedule.rows) {
    assert.ok(row.closingBalance >= 0, `negative balance at month ${row.month}`);
    assert.ok(row.interest >= 0, `negative interest at month ${row.month}`);
    assert.ok(row.principalPaid >= 0, `negative principal at month ${row.month}`);
  }
  assert.ok(Number.isInteger(schedule.tenureMonths) && schedule.tenureMonths >= 0);
  const last = schedule.rows.at(-1);
  if (last) assert.equal(last.closingBalance, 0, 'loan must end at exactly 0');
}

const sumInterest = (s) => s.rows.reduce((acc, r) => acc + r.interest, 0);

describe('calculateEMI', () => {
  test('matches the reducing-balance formula', () => {
    // ₹10,00,000 @ 12% for 24 months → ₹47,073.47
    assert.ok(Math.abs(calculateEMI(1_000_000, 12, 24) - 47073.47) < 0.01);
    // ₹80,00,000 @ 8% for 240 months → ₹66,915.20
    assert.ok(Math.abs(calculateEMI(8_000_000, 8, 240) - 66915.2) < 0.01);
  });
  test('guards degenerate input', () => {
    assert.equal(calculateEMI(0, 8, 12), 0);
    assert.equal(calculateEMI(1000, 8, 0), 0);
    assert.equal(calculateEMI(NaN, 8, 12), 0);
  });
});

describe('original loan', () => {
  test('amortizes to exactly zero at the original tenure', () => {
    const original = calculateOriginalLoan(base);
    assertSane(original);
    assert.equal(original.tenureMonths, 24);
    assert.ok(Math.abs(original.totalInterest - sumInterest(original)) < 1e-6);
    // Total interest = EMI * N - P (within rounding)
    assert.ok(Math.abs(original.totalInterest - (original.originalEMI * 24 - 1_000_000)) < 0.05);
  });
});

describe('TEST 1 — Reduce Tenure, one-time ₹2,00,000 before first EMI', () => {
  const impact = calculateLoanImpact({ ...base, strategy: STRATEGY.REDUCE_TENURE });
  test('EMI unchanged', () => {
    assert.equal(impact.newEMI, impact.originalEMI);
    // Every EMI except the capped final one equals the original EMI.
    for (const row of impact.scenario.rows.slice(0, -1)) assert.ok(Math.abs(row.payment - impact.originalEMI) < 1e-6);
    assert.ok(impact.scenario.rows.at(-1).payment <= impact.originalEMI + 1e-6);
  });
  test('tenure shorter, integer; interest lower', () => {
    assert.ok(impact.afterTenureMonths < 24);
    assert.ok(Number.isInteger(impact.afterTenureMonths));
    assert.equal(impact.afterTenureMonths, 19);
    assert.ok(impact.afterInterest < impact.beforeInterest);
    assert.ok(Math.abs(impact.grossInterestSaved - (impact.beforeInterest - impact.afterInterest)) < 1e-6);
  });
  test('prepayment is applied before the first EMI', () => {
    assert.equal(impact.scenario.rows[0].openingBalance, 800_000);
  });
  test('no NaN', () => assertSane(impact.scenario));
});

describe('TEST 2 — Reduce EMI, one-time ₹2,00,000', () => {
  const impact = calculateLoanImpact({ ...base, strategy: STRATEGY.REDUCE_EMI });
  const view = buildImpactView(impact);
  test('tenure stays 24 months', () => {
    assert.equal(impact.afterTenureMonths, 24);
    assert.equal(view.after.tenure, '24 months');
    assert.equal(view.metrics.newTenure, '24 months');
  });
  test('EMI lower and equals EMI(8,00,000, 12%, 24)', () => {
    assert.ok(impact.newEMI < impact.originalEMI);
    assert.ok(Math.abs(impact.newEMI - calculateEMI(800_000, 12, 24)) < 1e-6);
  });
  test('interest lower', () => assert.ok(impact.afterInterest < impact.beforeInterest));
  test('no NaN', () => {
    assertSane(impact.scenario);
    assert.ok(!JSON.stringify(view).includes('NaN'));
  });
});

describe('TEST 3 — no prepayment', () => {
  for (const strategy of Object.values(STRATEGY)) {
    test(`${strategy} keeps the original loan`, () => {
      const impact = calculateLoanImpact({ ...base, prepayment: 0, strategy });
      assert.equal(impact.afterTenureMonths, 24);
      assert.equal(impact.newEMI, impact.originalEMI);
      assert.equal(impact.grossInterestSaved, 0);
      assert.equal(impact.netSavings, 0);
      assertSane(impact.scenario);
    });
  }
});

describe('TEST 4 — prepayment larger than balance', () => {
  for (const strategy of Object.values(STRATEGY)) {
    test(`${strategy}: one-time ₹50,00,000 closes the loan before the first EMI`, () => {
      const impact = calculateLoanImpact({ ...base, prepayment: 5_000_000, strategy, penaltyPercent: 2 });
      assertSane(impact.scenario);
      assert.equal(impact.afterTenureMonths, 0);
      assert.equal(impact.afterInterest, 0);
      assert.equal(impact.totalPrepaid, 1_000_000, 'principal reduction capped at outstanding');
      assert.equal(impact.totalPenalty, 20_000, 'penalty on the amount actually applied');
      assert.ok(impact.closedByPrepayment);
      assert.equal(buildImpactView(impact).after.tenure, '0 months');
    });
    test(`${strategy}: monthly prepayment that overshoots closes at that payment point`, () => {
      const impact = calculateLoanImpact({
        ...base,
        frequency: FREQUENCY.MONTHLY,
        prepayment: 400_000,
        strategy,
      });
      assertSane(impact.scenario);
      assert.ok(impact.closedByPrepayment);
      assert.ok(impact.afterTenureMonths < 24);
      const last = impact.scenario.prepaymentEvents.at(-1);
      assert.equal(last.balanceAfter, 0);
      assert.equal(last.month, impact.afterTenureMonths);
    });
  }
});

describe('TEST 5 — 0% interest', () => {
  test('EMI = principal / tenure; both strategies work', () => {
    assert.equal(calculateEMI(1_200_000, 0, 24), 50_000);
    const rt = calculateLoanImpact({ ...base, annualRate: 0, principal: 1_200_000 });
    const re = calculateLoanImpact({ ...base, annualRate: 0, principal: 1_200_000, strategy: STRATEGY.REDUCE_EMI });
    assert.equal(rt.originalEMI, 50_000);
    assert.equal(rt.beforeInterest, 0);
    assert.equal(rt.afterTenureMonths, 20); // ₹10,00,000 left / ₹50,000
    assert.equal(re.afterTenureMonths, 24);
    assert.ok(Math.abs(re.newEMI - 1_000_000 / 24) < 1e-9);
    assertSane(rt.scenario);
    assertSane(re.scenario);
  });
});

describe('TEST 6 — monthly prepayment, Reduce EMI', () => {
  const input = { ...base, prepayment: 10_000, frequency: FREQUENCY.MONTHLY, strategy: STRATEGY.REDUCE_EMI };
  const s = calculateReduceEMI(input);
  test('EMI recalculated after every monthly prepayment', () => {
    assertSane(s);
    assert.equal(s.tenureMonths, 24);
    // Prepayments after months 1..23 (balance is 0 after month 24).
    assert.equal(s.emiChanges.length, 23);
    s.emiChanges.forEach((c, i) => {
      assert.equal(c.month, i + 1);
      assert.equal(c.remainingTenureMonths, 24 - (i + 1));
      const balanceAfter = s.prepaymentEvents[i].balanceAfter;
      assert.ok(Math.abs(c.emi - calculateEMI(balanceAfter, 12, c.remainingTenureMonths)) < 1e-6);
      if (i > 0) assert.ok(c.emi < s.emiChanges[i - 1].emi, 'EMI keeps falling');
    });
    // The EMI paid in month m+1 is the one recalculated after month m.
    for (let m = 2; m <= 23; m++) assert.ok(Math.abs(s.rows[m - 1].emi - s.emiChanges[m - 2].emi) < 1e-9);
  });
  test('Reduce Tenure with the same monthly prepayment keeps EMI fixed and ends sooner', () => {
    const t = calculateReduceTenure({ ...input, strategy: STRATEGY.REDUCE_TENURE });
    assertSane(t);
    assert.equal(t.emiChanges.length, 0);
    assert.ok(t.tenureMonths < 24);
    for (const row of t.rows) assert.equal(row.emi, t.originalEMI);
    assert.ok(t.totalInterest < s.totalInterest, 'reduce tenure saves more interest than reduce EMI');
  });
});

describe('TEST 7 — yearly prepayment, Reduce EMI', () => {
  test('EMI recalculated after every 12th EMI only, maturity preserved', () => {
    const s = calculateReduceEMI({
      principal: 8_000_000,
      annualRate: 8,
      tenureMonths: 240,
      prepayment: 100_000,
      frequency: FREQUENCY.YEARLY,
      penaltyPercent: 2,
    });
    assertSane(s);
    assert.equal(s.tenureMonths, 240);
    assert.deepEqual(
      s.emiChanges.map((c) => c.month),
      Array.from({ length: 19 }, (_, i) => (i + 1) * 12),
    );
    assert.equal(s.emiChanges[0].remainingTenureMonths, 228);
    assert.equal(s.emiChanges[1].remainingTenureMonths, 216);
    // EMI constant within each year
    for (const row of s.rows) {
      const year = Math.floor((row.month - 1) / 12);
      const expected = year === 0 ? s.originalEMI : s.emiChanges[year - 1].emi;
      assert.ok(Math.abs(row.emi - expected) < 1e-9, `month ${row.month}`);
    }
    assert.ok(Math.abs(s.totalPenalty - 19 * 2_000) < 1e-6);
  });
});

describe('spec example — ₹80L @ 8% for 240 months', () => {
  test('original EMI ₹66,915', () => {
    const original = calculateOriginalLoan({ principal: 8_000_000, annualRate: 8, tenureMonths: 240 });
    assert.equal(formatINR(original.originalEMI), '₹66,915');
  });
  test('prepayment does not reduce principal by the penalty', () => {
    const s = calculateReduceTenure({
      principal: 8_000_000,
      annualRate: 8,
      tenureMonths: 240,
      prepayment: 500_000,
      frequency: FREQUENCY.ONE_TIME,
      penaltyPercent: 2,
    });
    assert.equal(s.rows[0].openingBalance, 7_500_000);
    assert.equal(s.totalPenalty, 10_000);
  });
});

describe('savings & penalty', () => {
  test('net savings = gross interest saved − penalty', () => {
    const impact = calculateLoanImpact({ ...base, penaltyPercent: 2 });
    assert.equal(impact.totalPenalty, 4_000);
    assert.ok(Math.abs(impact.netSavings - (impact.grossInterestSaved - 4_000)) < 1e-9);
    const direct = calculateInterestSaved(impact.original, impact.scenario);
    assert.equal(direct.netSavings, impact.netSavings);
  });
});

describe('validation', () => {
  const cases = [
    ['principal', { principal: 0 }],
    ['tenureMonths', { tenureMonths: 0 }],
    ['tenureMonths', { tenureMonths: 12.5 }],
    ['annualRate', { annualRate: -1 }],
    ['annualRate', { annualRate: 51 }],
    ['prepayment', { prepayment: -5 }],
    ['penaltyPercent', { penaltyPercent: 101 }],
    ['principal', { principal: NaN }],
  ];
  for (const [field, patch] of cases) {
    test(`rejects ${JSON.stringify(patch)}`, () => {
      const { valid, errors } = validateLoanInput({ ...base, ...patch });
      assert.equal(valid, false);
      assert.ok(errors[field]);
      assert.equal(calculateLoanImpact({ ...base, ...patch }).ok, false);
    });
  }
  test('accepts boundaries', () => {
    assert.equal(validateLoanInput({ ...base, annualRate: 0, penaltyPercent: 100, tenureMonths: 1 }).valid, true);
    assert.equal(validateLoanInput({ ...base, annualRate: 50 }).valid, true);
  });
});

describe('formatter', () => {
  test('Indian grouping with ₹', () => {
    assert.equal(formatINR(8_000_000), '₹80,00,000');
    assert.equal(formatINR(26_603.4), '₹26,603');
    assert.equal(formatINR(114_955), '₹1,14,955');
    assert.equal(formatINR(NaN), '₹0');
    assert.equal(formatINR(-0.2), '₹0');
  });
  test('months never NaN', () => {
    assert.equal(formatMonths(240), '240 months');
    assert.equal(formatMonths(NaN), '0 months');
    assert.equal(formatMonths(undefined), '0 months');
    assert.equal(formatMonths(Infinity), '0 months');
    assert.equal(formatMonths(1), '1 month');
  });
});

describe('fuzz — both strategies across many inputs', () => {
  test('always finite, non-negative, Reduce EMI keeps maturity unless closed by prepayment', () => {
    let seed = 42;
    const rand = () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
    for (let i = 0; i < 400; i++) {
      const input = {
        principal: Math.round(10_000 + rand() * 20_000_000),
        annualRate: Math.round(rand() * 5000) / 100,
        tenureMonths: 1 + Math.floor(rand() * 360),
        prepayment: rand() < 0.15 ? 0 : Math.round(rand() * 2_000_000),
        frequency: Object.values(FREQUENCY)[Math.floor(rand() * 3)],
        penaltyPercent: Math.round(rand() * 500) / 100,
      };
      const original = calculateOriginalLoan(input);
      const rt = calculateReduceTenure(input);
      const re = calculateReduceEMI(input);
      [original, rt, re].forEach(assertSane);
      assert.equal(original.tenureMonths, input.tenureMonths);
      assert.ok(rt.tenureMonths <= input.tenureMonths);
      if (!re.closedByPrepayment) assert.equal(re.tenureMonths, input.tenureMonths, JSON.stringify(input));
      assert.ok(rt.totalInterest <= original.totalInterest + 1e-6);
      assert.ok(re.totalInterest <= original.totalInterest + 1e-6);
      for (const row of rt.rows) assert.equal(row.emi, rt.originalEMI);
      const view = buildImpactView(calculateLoanImpact({ ...input, strategy: STRATEGY.REDUCE_EMI }));
      assert.ok(!/NaN|undefined|Infinity/.test(JSON.stringify(view)), JSON.stringify(input));
    }
  });
});

describe('result view messages', () => {
  test('Reduce Tenure headline and note', () => {
    const view = buildImpactView(calculateLoanImpact({ ...base, strategy: STRATEGY.REDUCE_TENURE }));
    assert.match(view.headline, /^Your loan finishes 5 months faster and interest saved by you is ₹/);
    assert.equal(view.note, 'Note: Your EMI of ₹47,073 remains the same.');
  });
  test('Reduce EMI spec example: ₹66,915 → ₹62,733 with a ₹5,00,000 one-time prepayment', () => {
    const view = buildImpactView(
      calculateLoanImpact({
        principal: 8_000_000,
        annualRate: 8,
        tenureMonths: 240,
        prepayment: 500_000,
        frequency: FREQUENCY.ONE_TIME,
        strategy: STRATEGY.REDUCE_EMI,
        penaltyPercent: 2,
      }),
    );
    assert.equal(view.before.tenure, '240 months');
    assert.equal(view.after.tenure, '240 months');
    assert.equal(view.note, 'Note: Your EMI reduces from ₹66,915 to ₹62,733.');
    assert.match(view.headline, /^Your EMI reduces by ₹4,182 per month/);
  });
  test('Reduce EMI keeps its headline when a late prepayment clears the balance', () => {
    const impact = calculateLoanImpact({
      principal: 8_000_000,
      annualRate: 8,
      tenureMonths: 240,
      prepayment: 10_000,
      frequency: FREQUENCY.MONTHLY,
      strategy: STRATEGY.REDUCE_EMI,
      penaltyPercent: 0,
    });
    const view = buildImpactView(impact);
    assert.ok(impact.closedByPrepayment);
    assert.equal(view.after.tenure, `${impact.afterTenureMonths} months`);
    assert.match(view.headline, /^Your EMI reduces by/);
    assert.match(view.note, /closes 1 month before the original maturity/);
  });
});

describe('prepayment that never falls within tenure', () => {
  test('yearly prepayment on a 10-month loan explains why nothing changes', () => {
    const impact = calculateLoanImpact({ ...base, tenureMonths: 10, frequency: FREQUENCY.YEARLY, prepayment: 100_000 });
    assert.equal(impact.prepaymentCount, 0);
    assert.equal(impact.afterTenureMonths, 10);
    assert.equal(buildImpactView(impact).headline, 'No yearly prepayment falls within a 10-month tenure, so nothing changes.');
  });
});
