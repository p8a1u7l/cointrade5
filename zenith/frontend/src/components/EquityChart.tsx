import { useEffect, useMemo, useRef, useState } from 'react';
import { createChart, CrosshairMode } from 'lightweight-charts';
import type { CandlestickData, IChartApi, ISeriesApi, UTCTimestamp } from 'lightweight-charts';

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

type EquityCandle = (CandlestickData & { timestamp: string });

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

const toUtcTimestamp = (ms: number): UTCTimestamp => Math.floor(ms / 1000) as UTCTimestamp;

export function EquityChart({ endpoint, refreshIntervalMs = 5000 }: EquityChartProps) {
  const [points, setPoints] = useState<EquityPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const hasFittedRef = useRef(false);

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
    if (enrichedPoints.length < 2) return [] as EquityCandle[];
    const series: EquityCandle[] = [];
    for (let i = 1; i < enrichedPoints.length; i += 1) {
      const prev = enrichedPoints[i - 1];
      const current = enrichedPoints[i];
      const open = prev.equity;
      const close = current.equity;
      const balanceValues = [prev.balance, current.balance].filter((value) => Number.isFinite(value)) as number[];
      const high = Math.max(open, close, ...balanceValues);
      const low = Math.min(open, close, ...balanceValues);
      series.push({
        time: toUtcTimestamp(current.time),
        timestamp: current.timestamp,
        open,
        close,
        high,
        low,
      });
    }
    return series;
  }, [enrichedPoints]);

  useEffect(() => {
    const container = chartContainerRef.current;
    if (!container) {
      return;
    }

    const chart = createChart(container, {
      layout: {
        background: { color: 'transparent' },
        textColor: '#e2e8f0',
      },
      grid: {
        vertLines: { color: 'rgba(148,163,184,0.12)' },
        horzLines: { color: 'rgba(148,163,184,0.12)' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
      },
      rightPriceScale: {
        borderVisible: false,
      },
      leftPriceScale: {
        visible: false,
      },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: true,
        rightOffset: 6,
        barSpacing: 18,
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
      handleScale: {
        axisPressedMouseMove: true,
        mouseWheel: true,
        pinch: true,
      },
    });

    const series = chart.addCandlestickSeries({
      upColor: 'rgba(34,197,94,0.8)',
      downColor: 'rgba(248,113,113,0.8)',
      borderUpColor: 'rgba(34,197,94,1)',
      borderDownColor: 'rgba(248,113,113,1)',
      wickUpColor: 'rgba(134,239,172,0.9)',
      wickDownColor: 'rgba(252,165,165,0.9)',
    });

    chartRef.current = chart;
    candleSeriesRef.current = series;

    const resize = () => {
      if (!chartContainerRef.current) return;
      const width = chartContainerRef.current.clientWidth || 600;
      const height = Math.max(320, Math.min(560, Math.floor(width * 0.45)));
      chartContainerRef.current.style.height = `${height}px`;
      chart.applyOptions({ width, height });
    };

    resize();

    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => resize());
      observer.observe(container);
    } else {
      window.addEventListener('resize', resize);
    }

    return () => {
      if (observer) {
        observer.disconnect();
      } else {
        window.removeEventListener('resize', resize);
      }
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      hasFittedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const series = candleSeriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart) {
      return;
    }

    if (candles.length === 0) {
      series.setData([]);
      return;
    }

    const payload = candles.map(({ timestamp: _timestamp, ...rest }) => rest);
    series.setData(payload);
    chart.timeScale().scrollToRealTime();

    if (!hasFittedRef.current) {
      chart.timeScale().fitContent();
      hasFittedRef.current = true;
    }
  }, [candles]);

  const latestPoint = enrichedPoints.length > 0 ? enrichedPoints[enrichedPoints.length - 1] : null;
  const earliestPoint = enrichedPoints.length > 0 ? enrichedPoints[0] : null;
  const lastCandle = candles.length > 0 ? candles[candles.length - 1] : null;

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
      ) : candles.length === 0 ? (
        <div className="flex h-[360px] items-center justify-center rounded-2xl border border-white/10 bg-slate-900/60 text-sm text-slate-300/70">
          Not enough equity history yet.
        </div>
      ) : (
        <div className="relative overflow-hidden rounded-2xl border border-white/5 bg-gradient-to-b from-slate-900/60 to-slate-950/90">
          <div ref={chartContainerRef} className="w-full" />
          {lastCandle && (
            <div className="pointer-events-none absolute right-4 top-4 rounded-full bg-slate-900/80 px-3 py-1 text-xs font-semibold text-sky-100 ring-1 ring-sky-400/40">
              {formatUsd(lastCandle.close)} · {formatTime(lastCandle.timestamp)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
