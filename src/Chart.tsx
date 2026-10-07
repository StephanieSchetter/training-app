// One small line chart used everywhere: single y-axis, thin lines, hover/touch read-out,
// FIFO stints shaded, and a table view of the same numbers.
import { useMemo, useRef, useState } from 'react';
import type { Series } from './stats';
import type { Stint } from './store';

// Series colours in fixed order (validated for colour-blind separation on this app's dark card).
const COLORS = ['#3987e5', '#d95926'];
const W = 340;
const PAD = { l: 38, r: 10, t: 10, b: 22 };

const day = (d: string) => Date.parse(d + 'T00:00:00Z') / 86400000;
const shortDate = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });

function niceTicks(lo: number, hi: number, count = 4): number[] {
  if (hi === lo) { hi = lo + 1; lo = lo - 1; }
  const raw = (hi - lo) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) ?? raw;
  const start = Math.floor(lo / step) * step;
  const out: number[] = [];
  for (let v = start; v <= hi + step * 0.999; v += step) out.push(Math.round(v * 1000) / 1000);
  return out;
}

export function LineChart({ series, stints = [], format = v => String(v), reference, stepped, height = 170, from, yTicks }: {
  series: Series[];
  stints?: Stint[];
  format?: (v: number) => string;
  /** A horizontal reference line, e.g. the 20:00 mark on time trials. */
  reference?: { value: number; label: string };
  /** Levels: draw as steps and only tick whole numbers. */
  stepped?: boolean;
  height?: number;
  from?: string;
  yTicks?: number[];
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const svg = useRef<SVGSVGElement>(null);
  const shown = useMemo(() => series.map(s => ({ ...s, points: s.points.filter(p => !from || p.x >= from) })), [series, from]);
  const all = shown.flatMap(s => s.points);

  if (!all.length) return <div className="chart-empty">Nothing to show yet. This fills in as you log sessions.</div>;

  const xs = all.map(p => day(p.x));
  let x0 = Math.min(...xs), x1 = Math.max(...xs);
  if (x1 === x0) { x0 -= 3; x1 += 3; }
  const ys = [...all.map(p => p.y), ...(reference ? [reference.value] : [])];
  const ticks = yTicks ?? niceTicks(Math.min(...ys), Math.max(...ys), stepped ? Math.max(1, Math.max(...ys) - Math.min(...ys)) : 4);
  const y0 = ticks[0], y1 = ticks.at(-1)!;
  const H = height;
  const px = (d: string | number) => PAD.l + ((typeof d === 'number' ? d : day(d)) - x0) / (x1 - x0) * (W - PAD.l - PAD.r);
  const py = (v: number) => H - PAD.b - (v - y0) / (y1 - y0 || 1) * (H - PAD.t - PAD.b);

  const path = (pts: Series['points']) => pts.map((p, i) => {
    const start = i === 0 || p.gap;
    if (stepped && !start) return `H${px(p.x).toFixed(1)}V${py(p.y).toFixed(1)}`;
    return `${start ? 'M' : 'L'}${px(p.x).toFixed(1)},${py(p.y).toFixed(1)}`;
  }).join('');

  // Every date that has a point, for the hover read-out and the table.
  const dates = [...new Set(all.map(p => p.x))].sort();
  const bands = stints.map(s => ({ a: Math.max(x0, day(s.start)), b: Math.min(x1, day(s.end) + 1) })).filter(b => b.b > b.a);
  const onMove = (clientX: number) => {
    const box = svg.current!.getBoundingClientRect();
    const at = x0 + ((clientX - box.left) / box.width * W - PAD.l) / (W - PAD.l - PAD.r) * (x1 - x0);
    let best = 0;
    dates.forEach((d, i) => { if (Math.abs(day(d) - at) < Math.abs(day(dates[best]) - at)) best = i; });
    setHover(best);
  };
  const hd = hover !== null ? dates[hover] : null;
  const sparse = dates.length <= 40;
  const xLabels = dates.length === 1 ? [dates[0]] : [dates[0], dates[Math.floor((dates.length - 1) / 2)], dates.at(-1)!].filter((d, i, a) => a.indexOf(d) === i);

  return (
    <div className="chart">
      {(shown.length > 1 || bands.length > 0) && (
        <div className="chart-legend">
          {shown.length > 1 && shown.map((s, i) => <span key={s.name}><i style={{ background: COLORS[i] }} />{s.name}</span>)}
          {bands.length > 0 && <span><i className="band" />FIFO</span>}
        </div>
      )}
      <div className="chart-plot">
        <svg ref={svg} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Chart of ${shown.map(s => s.name).join(' and ')}`}
          onPointerMove={e => onMove(e.clientX)} onPointerDown={e => onMove(e.clientX)} onPointerLeave={e => { if (e.pointerType === 'mouse') setHover(null); }}>
          {bands.map((b, i) => <rect key={i} x={px(b.a)} y={PAD.t} width={px(b.b) - px(b.a)} height={H - PAD.t - PAD.b} className="c-band" />)}
          {ticks.map(t => (
            <g key={t}>
              <line x1={PAD.l} x2={W - PAD.r} y1={py(t)} y2={py(t)} className="c-grid" />
              <text x={PAD.l - 6} y={py(t) + 3.5} textAnchor="end" className="c-tick">{format(t)}</text>
            </g>
          ))}
          {xLabels.map((d, i) => <text key={d} x={px(d)} y={H - 6} textAnchor={i === 0 ? 'start' : i === xLabels.length - 1 && xLabels.length > 1 ? 'end' : 'middle'} className="c-tick">{shortDate(d)}</text>)}
          {reference && (
            <g>
              <line x1={PAD.l} x2={W - PAD.r} y1={py(reference.value)} y2={py(reference.value)} className="c-ref" />
              <text x={W - PAD.r} y={py(reference.value) - 5} textAnchor="end" className="c-tick">{reference.label}</text>
            </g>
          )}
          {shown.map((s, i) => (
            <g key={s.name}>
              <path d={path(s.points)} fill="none" stroke={COLORS[i]} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
              {sparse && s.points.map(p => <circle key={p.x} cx={px(p.x)} cy={py(p.y)} r="4" fill={COLORS[i]} className="c-dot" />)}
            </g>
          ))}
          {hd && (
            <g>
              <line x1={px(hd)} x2={px(hd)} y1={PAD.t} y2={H - PAD.b} className="c-cross" />
              {shown.map((s, i) => s.points.filter(p => p.x === hd).map(p => <circle key={s.name} cx={px(p.x)} cy={py(p.y)} r="5" fill={COLORS[i]} className="c-dot" />))}
            </g>
          )}
        </svg>
        {hd && (
          <div className="chart-tip" style={px(hd) > W / 2 ? { right: `${(1 - px(hd) / W) * 100 + 3}%` } : { left: `${px(hd) / W * 100 + 3}%` }}>
            <div className="muted small">{shortDate(hd)}</div>
            {shown.map((s, i) => s.points.filter(p => p.x === hd).map(p => (
              <div key={s.name} className="tip-row"><i style={{ background: COLORS[i] }} />{shown.length > 1 && <span className="muted">{s.name}</span>}<b>{format(p.y)}</b>{p.note && <span className="muted small">{p.note}</span>}</div>
            )))}
          </div>
        )}
      </div>
      <button className="chart-toggle" onClick={() => setTable(t => !t)}>{table ? 'Hide table' : 'Show as table'}</button>
      {table && (
        <div className="chart-table">
          <table>
            <thead><tr><th>Date</th>{shown.map(s => <th key={s.name}>{s.name}</th>)}</tr></thead>
            <tbody>
              {[...dates].reverse().slice(0, 60).map(d => (
                <tr key={d}><td>{shortDate(d)}</td>{shown.map(s => { const p = s.points.find(x => x.x === d); return <td key={s.name}>{p ? `${format(p.y)}${p.note ? ` (${p.note})` : ''}` : ''}</td>; })}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
