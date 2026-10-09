# Loan Calculators

Two pages sharing one amortization engine. No dependencies, no build step.

- **EMI Calculator** (`emi.html`): monthly EMI, total interest and total payable
  for a loan (default ₹1,10,000 at 9% for 5 years). It compares your loan side by side with
  a second loan (a different rate, tenure or amount) and shows the difference in EMI and
  interest. Tables show how interest changes with rate (±1% in 0.25% steps), tenure
  (1 year up to your tenure + 2 years) and loan amount (±10%, ±20%).
- **Prepayment Calculator** (`index.html`): compares the **Reduce Tenure** and
  **Reduce EMI** prepayment strategies using a month-by-month amortization simulation.

```
npm start     # http://localhost:5173  (EMI calculator at /emi.html)
npm test      # node:test unit tests for the engine and formatter
```

## Structure

| Layer | File | Responsibility |
|---|---|---|
| Loan calculation engine | `src/engine/emi.js`, `src/engine/loan.js` | `calculateEMI`, validation, `calculateOriginalLoan`, `calculateReduceTenure`, `calculateReduceEMI`, `calculateInterestSaved`, `calculateLoanImpact` |
| Amortization schedule generator | `src/engine/amortization.js` | `generateSchedule` — the single simulator every scenario runs through |
| Loan comparison | `src/engine/compare.js` | `calculateLoanSummary`, `compareLoans`, `rateSweep`, `tenureSweep`, `amountSweep` |
| Prepayment engine | `src/engine/prepayment.js` | when an event happens (`isPrepaymentMonth`) and how it applies (`applyPrepayment`) |
| Result formatter | `src/format/formatter.js`, `src/format/resultView.js` | `formatINR`, `formatMonths`, headline/note text |
| UI components | `src/ui/*.js`, `index.html`, `emi.html`, `styles.css` | forms, results cards, SVG balance chart, comparison tables |

The engine has no DOM access and is fully testable in Node.

## Calculation rules

- `r = annualRate / 12 / 100`; `EMI = P·r·(1+r)^N / ((1+r)^N − 1)`, or `P / N` at 0%.
- Each month: `interest = balance·r`, `principalPaid = EMI − interest`, `balance −= principalPaid`.
  The final payment is capped so the balance ends at exactly ₹0 (0.01 tolerance).
- Prepayment timing: **one-time** before the first EMI; **monthly** after every EMI;
  **yearly** after every 12th EMI.
- Prepayment reduces principal, capped at the outstanding balance. The penalty is
  `% × amount actually applied`, never reduces principal, and is reported separately:
  `netSavings = grossInterestSaved − totalPenalty`.
- **Reduce Tenure** – EMI is fixed; the loan simply ends sooner.
- **Reduce EMI** – after each prepayment at month *m*, `EMI = calculateEMI(balance, rate, N − m)`,
  so the loan still matures at month *N*.
- Interest totals are the sum of the monthly interest actually charged.

### Edge case: a prepayment that clears the balance
If a prepayment is ≥ the remaining balance, the loan closes at that point in both
strategies (`closedByPrepayment: true`). In Reduce EMI mode this is the only way the
tenure can come out shorter than the original. With recurring prepayments it can
happen near the end of the loan, when the shrinking balance falls below the
prepayment amount. The result note says so explicitly.

### "New EMI" with recurring prepayments
In Reduce EMI mode the EMI changes after every prepayment. **New EMI** is the EMI in
effect after the *first* prepayment; the note also shows the final EMI it reaches.
