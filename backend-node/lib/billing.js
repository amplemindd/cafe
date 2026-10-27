// Server-side bill calculation. The browser is never trusted for prices.
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/**
 * lines: [{ unit_price, qty, tax_rate }]
 * discount: { type: "percent" | "fixed", value }
 * mode: "exclusive" (tax added on top) | "inclusive" (tax already inside price)
 * round: "none" | "nearest1"
 */
function calculate({ lines, discount, mode = "exclusive", round = "none" }) {
  const subtotal = r2(lines.reduce((s, l) => s + l.unit_price * l.qty, 0));
  const dv = Math.max(Number(discount?.value) || 0, 0);
  let discountAmount = discount?.type === "percent" ? (subtotal * Math.min(dv, 100)) / 100 : dv;
  discountAmount = r2(Math.min(Math.max(discountAmount, 0), subtotal));

  let allocated = 0;
  const out = lines.map((l, i) => {
    const lineSub = r2(l.unit_price * l.qty);
    const share = i === lines.length - 1 ? r2(discountAmount - allocated)
      : subtotal > 0 ? r2((discountAmount * lineSub) / subtotal) : 0;
    allocated = r2(allocated + share);
    const gross = r2(lineSub - share);
    const rate = Number(l.tax_rate) || 0;
    let taxable, tax;
    if (mode === "inclusive") { taxable = r2(gross / (1 + rate / 100)); tax = r2(gross - taxable); }
    else { taxable = gross; tax = r2((gross * rate) / 100); }
    return { ...l, line_subtotal: lineSub, discount_amount: share, taxable, tax_rate: rate, tax_amount: tax,
      line_total: mode === "inclusive" ? gross : r2(taxable + tax) };
  });

  const taxable_amount = r2(out.reduce((s, l) => s + l.taxable, 0));
  const tax_amount = r2(out.reduce((s, l) => s + l.tax_amount, 0));
  const raw = r2(out.reduce((s, l) => s + l.line_total, 0));
  const round_off = round === "nearest1" ? r2(Math.round(raw) - raw) : 0;
  const total = r2(raw + round_off);

  const breakdown = {};
  for (const l of out) {
    const b = (breakdown[l.tax_rate] ||= { rate: l.tax_rate, taxable: 0, tax: 0 });
    b.taxable = r2(b.taxable + l.taxable); b.tax = r2(b.tax + l.tax_amount);
  }
  return { lines: out, subtotal, discount_amount: discountAmount, taxable_amount, tax_amount, round_off, total,
    breakdown: Object.values(breakdown).filter((b) => b.rate > 0) };
}

module.exports = { calculate, r2 };
