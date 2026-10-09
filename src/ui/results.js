import { buildImpactView } from '../format/resultView.js';
import { formatINR } from '../format/formatter.js';

export function createResults(root) {
  const outs = Object.fromEntries([...root.querySelectorAll('[data-out]')].map((n) => [n.dataset.out, n]));
  const set = (key, text) => {
    if (outs[key]) outs[key].textContent = text;
  };
  const scheduleBody = root.querySelector('#schedule-body');
  const savings = root.querySelector('#savings-breakdown');

  function render(impact) {
    const view = buildImpactView(impact);

    set('originalEMI', view.metrics.originalEMI);
    set('newEMI', view.metrics.newEMI);
    set('interestSaved', view.metrics.interestSaved);
    set('newTenure', view.metrics.newTenure);

    set('strategyLabel', view.strategyLabel);
    set('strategyLegend', view.strategyLabel);
    set('beforeTenure', view.before.tenure);
    set('beforeInterest', view.before.interest);
    set('afterTenure', view.after.tenure);
    set('afterInterest', view.after.interest);
    set('headline', view.headline);
    set('note', view.note);

    set('totalPrepaid', view.savings.totalPrepaid);
    set('grossSaved', view.savings.gross);
    set('penalty', view.savings.penalty);
    set('netSavings', view.savings.net);
    savings.querySelector('.net').classList.toggle('negative', view.savings.netIsNegative);

    renderSchedule(impact);
  }

  function renderSchedule(impact) {
    const baseline = impact.original.balanceSeries;
    const rows = [];
    const upfront = impact.scenario.upfrontPrepayment;
    if (upfront > 0) {
      rows.push(
        `<tr class="prepay"><td>0 (before 1st EMI)</td><td>—</td><td>—</td><td>—</td><td>${formatINR(upfront)}</td>` +
          `<td>${formatINR(impact.scenario.balanceSeries[0].balance)}</td><td>${formatINR(baseline[0].balance)}</td></tr>`,
      );
    }
    for (const r of impact.scenario.rows) {
      rows.push(
        `<tr${r.prepayment > 0 ? ' class="prepay"' : ''}><td>${r.month}</td><td>${formatINR(r.payment)}</td>` +
          `<td>${formatINR(r.interest)}</td><td>${formatINR(r.principalPaid)}</td>` +
          `<td>${r.prepayment > 0 ? formatINR(r.prepayment) : '—'}</td><td>${formatINR(r.closingBalance)}</td>` +
          `<td>${formatINR(baseline[r.month]?.balance ?? 0)}</td></tr>`,
      );
    }
    if (rows.length === 0) rows.push('<tr><td colspan="7">No EMIs due — the loan is fully prepaid.</td></tr>');
    scheduleBody.innerHTML = rows.join('');
  }

  return { render };
}
