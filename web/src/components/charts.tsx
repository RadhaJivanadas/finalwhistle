/**
 * Hand-rolled SVG charts following the dataviz method:
 * thin marks, 2px lines, direct labels, recessive grid, hover tooltips,
 * validated categorical palette (home #3987e5 / draw #c98500 / away #199e70).
 */
import { useMemo, useState } from "react";

export const SERIES = ["var(--color-home)", "var(--color-draw)", "var(--color-away)"];

/** Implied-probability bars for market outcomes (pool share). */
export function ProbBars({
  labels,
  probs,
  colors = SERIES,
}: {
  labels: string[];
  probs: (number | null)[];
  colors?: string[];
}) {
  return (
    <div className="space-y-1.5">
      {labels.map((label, i) => {
        const p = probs[i];
        return (
          <div key={label} className="flex items-center gap-2 text-xs">
            <span className="w-14 shrink-0 text-ink-300">{label}</span>
            <div className="h-3 flex-1 overflow-hidden rounded bg-pitch-700">
              <div
                className="h-full rounded-r"
                style={{
                  width: `${Math.max(1.5, (p ?? 0) * 100)}%`,
                  background: colors[i],
                  transition: "width 400ms ease",
                }}
              />
            </div>
            <span className="mono w-12 shrink-0 text-right text-ink-100">
              {p == null ? "—" : `${(p * 100).toFixed(0)}%`}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Odds-movement line chart: one 2px line per outcome, crosshair tooltip. */
export function OddsChart({
  history,
  names,
  width = 560,
  height = 180,
}: {
  history: { ts: number; prices: number[] }[];
  names: string[];
  width?: number;
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const pad = { l: 36, r: 8, t: 8, b: 20 };

  const series = useMemo(() => {
    if (history.length < 2) return null;
    const n = Math.min(names.length, history[0].prices.length, 3);
    const toDec = (p: number) => (p > 100 ? p / 1000 : p);
    const xs = history.map((h) => h.ts);
    const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
    const all = history.flatMap((h) => h.prices.slice(0, n).map(toDec));
    const [y0, y1] = [Math.min(...all) * 0.97, Math.max(...all) * 1.03];
    const X = (ts: number) => pad.l + ((ts - x0) / Math.max(1, x1 - x0)) * (width - pad.l - pad.r);
    const Y = (v: number) => pad.t + (1 - (v - y0) / Math.max(0.001, y1 - y0)) * (height - pad.t - pad.b);
    return {
      n, x0, x1, y0, y1, X, Y,
      lines: Array.from({ length: n }, (_, i) =>
        history.map((h) => `${X(h.ts).toFixed(1)},${Y(toDec(h.prices[i])).toFixed(1)}`).join(" ")
      ),
      at: (idx: number) => history[idx],
      toDec,
    };
  }, [history, names.length, width, height]);

  if (!series) {
    return <div className="flex h-24 items-center justify-center text-xs text-ink-500">Waiting for odds updates…</div>;
  }

  const hoverIdx =
    hover == null
      ? null
      : Math.round(((hover - pad.l) / (width - pad.l - pad.r)) * (history.length - 1));
  const h = hoverIdx != null && hoverIdx >= 0 && hoverIdx < history.length ? history[hoverIdx] : null;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        onMouseMove={(e) => {
          const rect = (e.target as SVGElement).closest("svg")!.getBoundingClientRect();
          setHover(((e.clientX - rect.left) / rect.width) * width);
        }}
        onMouseLeave={() => setHover(null)}
      >
        {/* recessive grid: 3 horizontal lines */}
        {[0.25, 0.5, 0.75].map((f) => {
          const y = pad.t + f * (height - pad.t - pad.b);
          const v = series.y1 - f * (series.y1 - series.y0);
          return (
            <g key={f}>
              <line x1={pad.l} x2={width - pad.r} y1={y} y2={y} stroke="var(--color-pitch-700)" strokeWidth="1" />
              <text x={pad.l - 6} y={y + 3} textAnchor="end" fontSize="9" fill="var(--color-ink-500)">
                {v.toFixed(2)}
              </text>
            </g>
          );
        })}
        {series.lines.map((pts, i) => (
          <polyline key={i} points={pts} fill="none" stroke={SERIES[i]} strokeWidth="2" strokeLinejoin="round" />
        ))}
        {/* direct labels at line ends */}
        {series.lines.map((_, i) => {
          const last = history[history.length - 1];
          return (
            <text
              key={i}
              x={width - pad.r - 2}
              y={series.Y(series.toDec(last.prices[i])) - 4}
              textAnchor="end"
              fontSize="9"
              fill="var(--color-ink-300)"
            >
              {names[i]}
            </text>
          );
        })}
        {h && (
          <line
            x1={series.X(h.ts)} x2={series.X(h.ts)} y1={pad.t} y2={height - pad.b}
            stroke="var(--color-ink-500)" strokeWidth="1" strokeDasharray="3 3"
          />
        )}
      </svg>
      {h && (
        <div className="pointer-events-none absolute left-2 top-2 rounded-lg border border-pitch-600 bg-pitch-900/95 px-2.5 py-1.5 text-xs">
          <div className="text-ink-500">{new Date(h.ts).toLocaleTimeString()}</div>
          {h.prices.slice(0, series.n).map((p, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: SERIES[i] }} />
              <span className="text-ink-300">{names[i]}</span>
              <span className="mono ml-auto pl-3">{series.toDec(p).toFixed(2)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
