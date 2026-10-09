import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateEMI,
  calculateLoanSummary,
  compareLoans,
  rateSweep,
  tenureSweep,
  amountSweep,
  cumulativeInterestSeries,
} from '../src/engine/index.js';
import { formatINR } from '../src/format/formatter.js';

const base = { principal: 110_000, annualRate: 9, tenureMonths: 60 };

const assertFinite = (obj) => {
  for (const [k, v] of Object.entries(obj)) if (typeof v === 'number') assert.ok(Number.isFinite(v), `${k}=${v}`);
};

describe('calculateLoanSummary — default ₹1,10,000 @ 9% for 5 years', () => {
  const s = calculateLoanSummary(base);
  test('EMI matches the formula', () => {
    assert.ok(Math.abs(s.emi - calculateEMI(110_000, 9, 60)) < 1e-9);
    assert.equal(formatINR(s.emi), '₹2,283');
  });
  test('total interest = EMI × 60 − principal (from the schedule)', () => {
    assert.ok(Math.abs(s.totalInterest - (s.emi * 60 - 110_000)) < 0.05);
    assert.equal(s.totalPayment, 110_000 + s.totalInterest);
    assertFinite(s);
  });
  test('0% interest', () => {
    const z = calculateLoanSummary({ ...base, annualRate: 0 });
    assert.equal(z.totalInterest, 0);
    assert.ok(Math.abs(z.emi - 110_000 / 60) < 1e-9);
  });
});

describe('compareLoans', () => {
  test('9% vs 8.5%: lower rate saves interest', () => {
    const c = compareLoans(base, { ...base, annualRate: 8.5 });
    assert.ok(c.alt.emi < c.base.emi);
    assert.ok(c.interestDiff < 0);
    assert.ok(Math.abs(c.interestDiff - (c.alt.totalInterest - c.base.totalInterest)) < 1e-9);
    assert.ok(Math.abs(c.totalDiff - c.interestDiff) < 1e-9, 'same principal → total diff = interest diff');
  });
  test('5 yr vs 4 yr: shorter tenure → higher EMI, less interest', () => {
    const c = compareLoans(base, { ...base, tenureMonths: 48 });
    assert.ok(c.alt.emi > c.base.emi);
    assert.ok(c.interestDiff < 0);
  });
  test('larger amount → more EMI and interest', () => {
    const c = compareLoans(base, { ...base, principal: 150_000 });
    assert.ok(c.emiDiff > 0 && c.interestDiff > 0);
  });
});

describe('sweeps', () => {
  test('rateSweep: 8% … 10% in 0.25 steps, base row diff 0', () => {
    const rows = rateSweep(base);
    assert.deepEqual(rows.map((r) => r.annualRate), [8, 8.25, 8.5, 8.75, 9, 9.25, 9.5, 9.75, 10]);
    const baseRow = rows.find((r) => r.isBase);
    assert.equal(baseRow.annualRate, 9);
    assert.equal(baseRow.interestDiff, 0);
    for (let i = 1; i < rows.length; i++) assert.ok(rows[i].totalInterest > rows[i - 1].totalInterest);
    rows.forEach(assertFinite);
  });
  test('rateSweep never goes below 0%', () => {
    const rows = rateSweep({ ...base, annualRate: 0.5 });
    assert.equal(rows[0].annualRate, 0);
    assert.ok(rows.every((r) => r.annualRate >= 0));
  });
  test('tenureSweep: 1 … 7 years, interest grows with tenure', () => {
    const rows = tenureSweep(base);
    assert.deepEqual(rows.map((r) => r.tenureMonths), [12, 24, 36, 48, 60, 72, 84]);
    assert.equal(rows.find((r) => r.isBase).tenureMonths, 60);
    for (let i = 1; i < rows.length; i++) {
      assert.ok(rows[i].totalInterest > rows[i - 1].totalInterest);
      assert.ok(rows[i].emi < rows[i - 1].emi);
    }
  });
  test('tenureSweep includes a non-whole-year base tenure', () => {
    const rows = tenureSweep({ ...base, tenureMonths: 54 });
    assert.ok(rows.some((r) => r.tenureMonths === 54 && r.isBase));
  });
  test('amountSweep: ±10%, ±20% rounded to ₹1,000', () => {
    const rows = amountSweep(base);
    assert.deepEqual(rows.map((r) => r.principal), [88_000, 99_000, 110_000, 121_000, 132_000]);
    assert.equal(rows.find((r) => r.isBase).interestDiff, 0);
    rows.forEach(assertFinite);
  });
});

describe('cumulativeInterestSeries', () => {
  test('starts at 0, rises every month, ends at total interest', () => {
    const series = cumulativeInterestSeries(base);
    assert.equal(series.length, 61);
    assert.deepEqual(series[0], { month: 0, value: 0 });
    series.forEach((p, i) => assert.equal(p.month, i));
    for (let i = 1; i < series.length; i++) assert.ok(series[i].value > series[i - 1].value);
    assert.ok(Math.abs(series.at(-1).value - calculateLoanSummary(base).totalInterest) < 1e-6);
  });
  test('0% interest stays flat at 0', () => {
    assert.ok(cumulativeInterestSeries({ ...base, annualRate: 0 }).every((p) => p.value === 0));
  });
});
