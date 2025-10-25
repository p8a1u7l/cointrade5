import { useEffect, useMemo, useState } from 'react';

interface EquityPoint {
  timestamp: string;
  equity: number;
  balance: number;
  pnlPercent: number;
}

interface EquitySeriesResponse {
  points: EquityPoint[];
  message?: string;
}

interface EquityChartProps {
  endpoint: string;
  refreshIntervalMs?: number;
}

const chartWidth = 960;
const chartHeight = 360;
const paddingX = 52;
const paddingY = 36;

const formatUsd = (value: number) =>
  value.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const formatTime = (timestamp: string) => {
  try {
    const date = new Date(timestamp);
    return new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(date);
  } catch (_error) {
    return timestamp;
  }
};

export function EquityChart({ endpoint, refreshIntervalMs = 5000 }: EquityChartProps) {
  const [points, setPoints] = useState<EquityPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;

    async function load() {
      try {
        const response = await fetch(endpoint);
        if (!response.ok) {
          throw new Error(`Equity request failed: ${response.status}`);
        }
        const payload = (await response.json()) as EquitySeriesResponse;
        if (!cancelled) {
          setPoints(Array.isArray(payload.points) ? payload.points : []);
          setError(null);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load equity data');
          setLoading(false);
        }
      }
    }

    void load();
    timer = setInterval(load, refreshIntervalMs);

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [endpoint, refreshIntervalMs]);

  const enrichedPoints = useMemo(() => {
    return points
      .map((point) => ({
        ...point,
        time: new Date(point.timestamp).getTime(),
      }))
      .filter((point) => Number.isFinite(point.time) && Number.isFinite(point.equity));
  }, [points]);

  const { minEquity, maxEquity } = useMemo(() => {
    if (enrichedPoints.length === 0) {
      return { minEquity: 0, maxEquity: 1 };
    }
    let min = enrichedPoints[0].equity;
    let max = enrichedPoints[0].equity;
    for (const point of enrichedPoints) {
      if (point.equity < min) min = point.equity;
      if (point.equity > max) max = point.equity;
    }
    if (min === max) {
      min -= 1;
      max += 1;
    }
    return { minEquity: min, maxEquity: max };
  }, [enrichedPoints]);

  const candles = useMemo(() => {
    if (enrichedPoints.length < 2) return [] as {
      time: number;
      timestamp: string;
      open: number;
      close: number;
      high: number;
      low: number;
    }[];
    const series = [] as {
      time: number;
      timestamp: string;
      open: number;
      close: number;
      high: number;
      low: number;
    }[];
    for (let i = 1; i < enrichedPoints.length; i += 1) {
      const prev = enrichedPoints[i - 1];
      const current = enrichedPoints[i];
      const open = prev.equity;
      const close = current.equity;
      const balanceValues = [prev.balance, current.balance].filter((value) => Number.isFinite(value)) as number[];
      const extremeValues = [open, close, ...balanceValues];
      const high = Math.max(...extremeValues);
      const low = Math.min(...extremeValues);
      series.push({
        time: current.time,
        timestamp: current.timestamp,
        open,
        close,
        high,
        low,
      });
    }
    return series;
  }, [enrichedPoints]);

  const priceRange = useMemo(() => {
    if (candles.length === 0) {
      return { min: 0, max: 1 };
    }
    let min = candles[0].low;
    let max = candles[0].high;
    for (const candle of candles) {
      if (candle.low < min) min = candle.low;
      if (candle.high > max) max = candle.high;
    }
    if (min === max) {
      min -= 1;
      max += 1;
    }
    return { min, max };
  }, [candles]);

  const candleShapes = useMemo(() => {
    if (candles.length === 0) return [] as {
      x: number;
      bodyWidth: number;
      highY: number;
      lowY: number;
      openY: number;
      closeY: number;
      timestamp: string;
      open: number;
      close: number;
    }[];
    const usableWidth = chartWidth - paddingX * 2;
    const usableHeight = chartHeight - paddingY * 2;
    const step = candles.length > 1 ? usableWidth / (candles.length - 1) : 0;
    const bodyWidth = Math.min(24, Math.max(6, usableWidth / Math.max(candles.length * 1.6, 1)));

    const scaleY = (value: number) =>
      chartHeight - paddingY - ((value - priceRange.min) / (priceRange.max - priceRange.min)) * usableHeight;

    return candles.map((candle, index) => {
      const x = candles.length === 1 ? paddingX + usableWidth / 2 : paddingX + index * step;
      return {
        x,
        bodyWidth,
        highY: scaleY(candle.high),
        lowY: scaleY(candle.low),
        openY: scaleY(candle.open),
        closeY: scaleY(candle.close),
        timestamp: candle.timestamp,
        open: candle.open,
        close: candle.close,
      };
    });
  }, [candles, priceRange.max, priceRange.min]);

  const latestPoint = enrichedPoints.length > 0 ? enrichedPoints[enrichedPoints.length - 1] : null;
  const earliestPoint = enrichedPoints.length > 0 ? enrichedPoints[0] : null;

  const changePct = useMemo(() => {
    if (!earliestPoint || !latestPoint) return 0;
    const start = earliestPoint.equity;
    const end = latestPoint.equity;
    if (!Number.isFinite(start) || start === 0) return 0;
    return ((end - start) / start) * 100;
  }, [earliestPoint, latestPoint]);

  return (
    <div className="space-y-4 rounded-3xl border border-white/10 bg-slate-950/70 p-6 shadow-[0_30px_70px_-55px_rgba(14,165,233,0.45)]">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-white">Equity balance</h2>
          {latestPoint && (
            <p className="text-sm text-slate-300/80">
              Latest {formatUsd(latestPoint.equity)} · Session change {changePct >= 0 ? '+' : ''}
              {changePct.toFixed(2)}% · Updated {formatTime(latestPoint.timestamp)}
            </p>
          )}
        </div>
        {earliestPoint && latestPoint && (
          <div className="grid grid-cols-2 gap-3 text-xs text-slate-300/80 sm:grid-cols-4">
            <div>
              <span className="block text-[0.7rem] uppercase tracking-[0.35em] text-slate-400/60">Opening</span>
              <span className="text-sm font-semibold text-white">{formatUsd(earliestPoint.equity)}</span>
            </div>
            <div>
              <span className="block text-[0.7rem] uppercase tracking-[0.35em] text-slate-400/60">Peak</span>
              <span className="text-sm font-semibold text-emerald-200">{formatUsd(maxEquity)}</span>
            </div>
            <div>
              <span className="block text-[0.7rem] uppercase tracking-[0.35em] text-slate-400/60">Drawdown</span>
              <span className="text-sm font-semibold text-rose-200">{formatUsd(minEquity)}</span>
            </div>
              <div>
                <span className="block text-[0.7rem] uppercase tracking-[0.35em] text-slate-400/60">Points</span>
                <span className="text-sm font-semibold text-white">{enrichedPoints.length}</span>
              </div>
          </div>
        )}
      </div>

      {loading ? (
        <div className="h-[360px] w-full animate-pulse rounded-2xl bg-slate-800/40" />
      ) : error ? (
        <div className="flex h-[360px] items-center justify-center rounded-2xl border border-rose-400/40 bg-rose-500/10 text-sm text-rose-100">
          {error}
        </div>
      ) : candleShapes.length === 0 ? (
        <div className="flex h-[360px] items-center justify-center rounded-2xl border border-white/10 bg-slate-900/60 text-sm text-slate-300/70">
          Not enough equity history yet.
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-white/5 bg-gradient-to-b from-slate-900/60 to-slate-950/90">
          <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="h-full w-full">
            <defs>
              <pattern id="equityGrid" width="80" height="40" patternUnits="userSpaceOnUse">
                <path d="M 80 0 L 0 0 0 40" fill="none" stroke="rgba(148,163,184,0.12)" strokeWidth="1" />
              </pattern>
            </defs>

            <rect x="0" y="0" width={chartWidth} height={chartHeight} fill="url(#equityGrid)" />
            {candleShapes.map((candle, index) => {
              const bullish = candle.close >= candle.open;
              const bodyHeight = Math.abs(candle.openY - candle.closeY) || 1;
              const bodyY = Math.min(candle.openY, candle.closeY);
              const color = bullish ? 'rgba(34,197,94,0.75)' : 'rgba(239,68,68,0.75)';
              const borderColor = bullish ? 'rgba(34,197,94,0.9)' : 'rgba(248,113,113,0.9)';
              const wickColor = bullish ? 'rgba(134,239,172,0.8)' : 'rgba(252,165,165,0.8)';
              return (
                <g key={`${candle.timestamp}-${index}`}>
                  <line
                    x1={candle.x}
                    x2={candle.x}
                    y1={candle.highY}
                    y2={candle.lowY}
                    stroke={wickColor}
                    strokeWidth={2}
                    strokeLinecap="round"
                  />
                  <rect
                    x={candle.x - candle.bodyWidth / 2}
                    y={bodyY}
                    width={candle.bodyWidth}
                    height={bodyHeight < 1 ? 1 : bodyHeight}
                    fill={color}
                    stroke={borderColor}
                    strokeWidth={1.5}
                    rx={3}
                  />
                </g>
              );
            })}

            {candleShapes.map((candle, index) =>
              index % Math.max(1, Math.ceil(candleShapes.length / 6)) === 0 || index === candleShapes.length - 1 ? (
                <g key={`axis-${candle.timestamp}-${index}`}>
                  <line
                    x1={candle.x}
                    x2={candle.x}
                    y1={chartHeight - paddingY}
                    y2={chartHeight - paddingY + 8}
                    stroke="rgba(148,163,184,0.35)"
                    strokeWidth={1}
                  />
                  <text
                    x={candle.x}
                    y={chartHeight - paddingY + 22}
                    textAnchor="middle"
                    className="fill-white/80 text-[10px]"
                  >
                    {formatTime(candle.timestamp)}
                  </text>
                </g>
              ) : null
            )}

            <g>
              <line
                x1={paddingX}
                x2={chartWidth - paddingX}
                y1={candleShapes[candleShapes.length - 1].closeY}
                y2={candleShapes[candleShapes.length - 1].closeY}
                stroke="rgba(56,189,248,0.35)"
                strokeDasharray="6 6"
                strokeWidth={1}
              />
              <text
                x={chartWidth - paddingX + 8}
                y={candleShapes[candleShapes.length - 1].closeY + 4}
                className="fill-white text-[11px]"
              >
                {formatUsd(candleShapes[candleShapes.length - 1].close)}
              </text>
            </g>
          </svg>
        </div>
      )}
    </div>
  );
}
