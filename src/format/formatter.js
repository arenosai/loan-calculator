const inrFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
  minimumFractionDigits: 0,
});

const groupFormatter = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

/** Non-finite values (NaN, ±Infinity) become 0 before any rendering. */
export function safeNumber(value) {
  return Number.isFinite(value) ? value : 0;
}

/** ₹80,00,000 — Indian digit grouping, rounded to whole rupees, never "-₹0". */
export function formatINR(value) {
  const rounded = Math.round(safeNumber(value));
  return inrFormatter.format(rounded === 0 ? 0 : rounded);
}

/** 8000000 → "80,00,000" (no symbol), for input hints. */
export function formatIndianNumber(value) {
  return groupFormatter.format(Math.round(safeNumber(value)));
}

/** Always a whole, non-negative month count. */
export function safeMonths(value) {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

/** "240 months", "1 month" — never "NaN months". */
export function formatMonths(value) {
  const safeTenure = safeMonths(value);
  return `${safeTenure} ${safeTenure === 1 ? 'month' : 'months'}`;
}

/** 262 → "21 yr 10 mo"; used as a secondary hint next to month counts. */
export function formatYearsMonths(value) {
  const months = safeMonths(value);
  const years = Math.floor(months / 12);
  const rest = months % 12;
  if (years === 0) return `${rest} mo`;
  return rest === 0 ? `${years} yr` : `${years} yr ${rest} mo`;
}

export function formatPercent(value) {
  return `${safeNumber(value).toLocaleString('en-IN', { maximumFractionDigits: 2 })}%`;
}

/** Compact axis labels: ₹80L, ₹1.2Cr, ₹50K. */
export function formatINRCompact(value) {
  const v = safeNumber(value);
  const abs = Math.abs(v);
  if (abs >= 1e7) return `₹${trim(v / 1e7)}Cr`;
  if (abs >= 1e5) return `₹${trim(v / 1e5)}L`;
  if (abs >= 1e3) return `₹${trim(v / 1e3)}K`;
  return `₹${Math.round(v)}`;
}

function trim(n) {
  return Number(n.toFixed(n >= 10 ? 0 : 1)).toString();
}
