import React from "react";
import { money, num } from "./api";

export const COLORS = ["#14532D", "#22C55E", "#86EFAC", "#D97706", "#2563EB", "#9333EA", "#DC2626"];

export function Combo({ points = [], height = 230 }) {
  const W = 640, H = height, L = 46, R = 36, T = 14, B = 28, w = W - L - R, h = H - T - B;
  if (!points.length) return <div className="empty"><p>No data for this period.</p></div>;
  const maxS = Math.max(...points.map((p) => p.sales), 1), maxO = Math.max(...points.map((p) => p.orders), 1);
  const nice = (v) => { const p = 10 ** Math.floor(Math.log10(v)); return Math.ceil(v / p) * p; }, ms = nice(maxS), mo = Math.max(Math.ceil(maxO / 4) * 4, 4);
  const x = (i) => L + (points.length === 1 ? w / 2 : (i * w) / (points.length - 1)), bw = Math.max(Math.min(w / points.length - 4, 16), 3);
  const ys = (v) => T + h - (v / ms) * h, yo = (v) => T + h - (v / mo) * h;
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${ys(p.sales).toFixed(1)}`).join(" ");
  const step = Math.ceil(points.length / 9);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Sales and orders chart">
      {[0, 1, 2, 3, 4].map((i) => { const y = T + (h * i) / 4; return <g key={i}><line x1={L} x2={W - R} y1={y} y2={y} className="grid" /><text x={L - 6} y={y + 3} textAnchor="end" className="ax">{num(Math.round(ms - (ms * i) / 4))}</text><text x={W - R + 6} y={y + 3} className="ax">{Math.round(mo - (mo * i) / 4)}</text></g>; })}
      {points.map((p, i) => <rect key={"b" + i} x={x(i) - bw / 2} y={yo(p.orders)} width={bw} height={T + h - yo(p.orders)} className="bar2"><title>{`${p.label}: ${p.orders} orders`}</title></rect>)}
      <path d={line} className="ln" />
      {points.map((p, i) => <circle key={"c" + i} cx={x(i)} cy={ys(p.sales)} r="3.2" className="dot"><title>{`${p.label}: ${money(p.sales)} · ${p.orders} orders`}</title></circle>)}
      {points.map((p, i) => (i % step === 0 ? <text key={"t" + i} x={x(i)} y={H - 8} textAnchor="middle" className="ax">{p.label}</text> : null))}
    </svg>
  );
}

export function Donut({ data = [], center, size = 170 }) {
  const total = data.reduce((s, d) => s + d.value, 0), r = 56, C = 2 * Math.PI * r;
  let acc = 0;
  return (
    <div className="donut">
      <svg viewBox="0 0 160 160" width={size} height={size} role="img" aria-label="Distribution chart">
        <circle cx="80" cy="80" r={r} fill="none" className="donut-bg" strokeWidth="22" />
        {total > 0 && data.map((d, i) => { const len = (d.value / total) * C, el = <circle key={i} cx="80" cy="80" r={r} fill="none" stroke={d.color || COLORS[i % COLORS.length]} strokeWidth="22" strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-acc} transform="rotate(-90 80 80)"><title>{`${d.label}: ${d.value}`}</title></circle>; acc += len; return el; })}
        {center && <><text x="80" y="78" textAnchor="middle" className="dn-big">{center.big}</text><text x="80" y="95" textAnchor="middle" className="dn-sm">{center.small}</text></>}
      </svg>
      <ul className="legend">
        {data.map((d, i) => <li key={i}><i style={{ background: d.color || COLORS[i % COLORS.length] }} /><span>{d.label}</span><b>{d.text ?? d.value}</b></li>)}
        {!data.length && <li className="muted">No data</li>}
      </ul>
    </div>
  );
}

export function Bars({ data = [], height = 200, fmt = (v) => num(v), color = "#166534", highlight }) {
  const W = 560, H = height, L = 44, T = 22, B = 26, w = W - L - 8, h = H - T - B;
  if (!data.length) return <div className="empty"><p>No data for this period.</p></div>;
  const max = Math.max(...data.map((d) => d.value), 1), p = 10 ** Math.floor(Math.log10(max)), top = Math.ceil(max / p) * p, bw = Math.min(w / data.length - 6, 40);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Bar chart">
      {[0, 1, 2, 3, 4].map((i) => { const y = T + (h * i) / 4; return <g key={i}><line x1={L} x2={W - 8} y1={y} y2={y} className="grid" /><text x={L - 6} y={y + 3} textAnchor="end" className="ax">{fmt(top - (top * i) / 4)}</text></g>; })}
      {data.map((d, i) => { const cx = L + (w / data.length) * (i + 0.5), bh = (d.value / top) * h, last = highlight === "last" && i === data.length - 1; return <g key={i}>
        <rect x={cx - bw / 2} y={T + h - bh} width={bw} height={bh} rx="3" fill={d.color || (last ? "#14532D" : color)} opacity={last || d.color ? 1 : 0.75}><title>{`${d.label}: ${fmt(d.value)}`}</title></rect>
        {data.length <= 8 && d.value > 0 && <text x={cx} y={T + h - bh - 4} textAnchor="middle" className="ax b">{fmt(d.value)}</text>}
        <text x={cx} y={H - 8} textAnchor="middle" className="ax">{d.label}</text></g>; })}
    </svg>
  );
}

export function GroupBars({ data = [], keys, colors, height = 200 }) {
  const W = 560, H = height, L = 46, T = 14, B = 26, w = W - L - 8, h = H - T - B;
  const max = Math.max(...data.flatMap((d) => keys.map((k) => d[k] || 0)), 1), p = 10 ** Math.floor(Math.log10(max)), top = Math.ceil(max / p) * p, gw = w / Math.max(data.length, 1), bw = Math.min(gw / (keys.length + 1), 24);
  if (!data.length) return <div className="empty"><p>No data for this period.</p></div>;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Comparison chart">
      {[0, 1, 2, 3, 4].map((i) => { const y = T + (h * i) / 4; return <g key={i}><line x1={L} x2={W - 8} y1={y} y2={y} className="grid" /><text x={L - 6} y={y + 3} textAnchor="end" className="ax">{num(top - (top * i) / 4)}</text></g>; })}
      {data.map((d, i) => keys.map((k, j) => { const bh = ((d[k] || 0) / top) * h; return <rect key={i + k} x={L + gw * i + gw / 2 - (keys.length * bw) / 2 + j * bw} y={T + h - Math.max(bh, 0)} width={bw - 2} height={Math.max(bh, 0)} rx="2" fill={colors[j]}><title>{`${d.label} ${k}: ${money(d[k])}`}</title></rect>; }))}
      {data.map((d, i) => <text key={"l" + i} x={L + gw * (i + 0.5)} y={H - 8} textAnchor="middle" className="ax">{d.label}</text>)}
    </svg>
  );
}
