import { calculateLoanImpact, STRATEGY } from '../engine/index.js';
import { createForm } from './form.js';
import { createResults } from './results.js';
import { createBalanceChart } from './chart.js';

const formEl = document.getElementById('loan-form');
const resultsBody = document.getElementById('results-body');
const invalidState = document.getElementById('invalid-state');

const form = createForm(formEl);
const results = createResults(resultsBody);
const chart = createBalanceChart(document.getElementById('chart'));

const seriesColor = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function calculate() {
  const input = form.read();
  form.updateHints(input);
  const impact = calculateLoanImpact(input);

  if (!impact.ok) {
    form.showErrors(impact.errors);
    resultsBody.hidden = true;
    invalidState.hidden = false;
    return;
  }
  form.showErrors({});
  invalidState.hidden = true;
  resultsBody.hidden = false;

  results.render(impact);
  const strategyLabel = impact.strategy === STRATEGY.REDUCE_EMI ? 'Reduce EMI' : 'Reduce Tenure';
  chart.render([
    {
      label: 'Without Prepayment',
      shortLabel: 'Without prepayment',
      className: 'line-baseline',
      color: seriesColor('--series-2'),
      points: impact.original.balanceSeries,
    },
    {
      label: strategyLabel,
      shortLabel: strategyLabel,
      className: 'line-strategy',
      color: seriesColor('--series-1'),
      points: impact.scenario.balanceSeries,
    },
  ]);
}

formEl.addEventListener('input', calculate);
formEl.addEventListener('change', calculate);
formEl.addEventListener('submit', (e) => {
  e.preventDefault();
  calculate();
});
document.getElementById('reset-btn').addEventListener('click', () => {
  form.reset();
  calculate();
});
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', calculate);

form.reset();
calculate();
