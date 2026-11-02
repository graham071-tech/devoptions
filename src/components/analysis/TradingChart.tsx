import React, { useState, useMemo, useRef } from 'react';
import { Candle, Trade } from '../../types/trading';
import {
  calculateBollingerBands,
  calculateEMA,
  calculateMACD,
  calculateRSI,
  calculateSMA,
} from '../../utils/indicators';
import { ZoomIn, ZoomOut, RotateCcw, Eye, EyeOff } from 'lucide-react';

interface TradingChartProps {
  candles: Candle[];
  symbolName: string;
  decimals: number;
  currentQuote: number;
  height?: number;
  activeTrades?: Trade[];
}

export const TradingChart: React.FC<TradingChartProps> = ({
  candles,
  symbolName,
  decimals,
  currentQuote,
  height = 380,
  activeTrades = [],
}) => {
  const [chartType, setChartType] = useState<'candles' | 'line' | 'area'>('candles');
  const [candleInterval, setCandleInterval] = useState<'1s' | '1m' | '5m'>('1m');
  const [candleCount, setCandleCount] = useState<number>(60);
  const [showSMA, setShowSMA] = useState<boolean>(true);
  const [showEMA, setShowEMA] = useState<boolean>(false);
  const [showBollinger, setShowBollinger] = useState<boolean>(false);
  const [subChart, setSubChart] = useState<'rsi' | 'macd' | 'none'>('rsi');
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);

  // Compute indicators
  const closes = useMemo(() => candles.map((c) => c.close), [candles]);
  const sma20 = useMemo(() => calculateSMA(closes, 20), [closes]);
  const ema9 = useMemo(() => calculateEMA(closes, 9), [closes]);
  const bollinger = useMemo(() => calculateBollingerBands(closes, 20, 2), [closes]);
  const rsi14 = useMemo(() => calculateRSI(closes, 14), [closes]);
  const macdData = useMemo(() => calculateMACD(closes, 12, 26, 9), [closes]);

  // View bounds based on candleCount zoom
  const visibleCandles = useMemo(() => candles.slice(-candleCount), [candles, candleCount]);
  const startIndex = Math.max(0, candles.length - visibleCandles.length);

  const { minPrice, maxPrice, priceRange } = useMemo(() => {
    if (visibleCandles.length === 0) return { minPrice: 0, maxPrice: 100, priceRange: 100 };
    let min = Infinity;
    let max = -Infinity;
    visibleCandles.forEach((c) => {
      if (c.low < min) min = c.low;
      if (c.high > max) max = c.high;
    });

    // Also include active trades entry price in view bounds
    activeTrades.forEach((t) => {
      if (t.entryPrice < min) min = t.entryPrice;
      if (t.entryPrice > max) max = t.entryPrice;
    });

    // Add 5% padding
    const padding = (max - min) * 0.05 || min * 0.001;
    return {
      minPrice: min - padding,
      maxPrice: max + padding,
      priceRange: max - min + padding * 2,
    };
  }, [visibleCandles, activeTrades]);

  const chartHeight = subChart === 'none' ? height : height - 105;
  const subChartHeight = 85;
  const chartWidth = 760; // viewBox width

  const getY = (val: number) => {
    if (priceRange === 0) return chartHeight / 2;
    return chartHeight - ((val - minPrice) / priceRange) * chartHeight;
  };

  const candleWidth = chartWidth / Math.max(visibleCandles.length, 1);

  // Crosshair data
  const hoveredCandle =
    hoverIndex !== null && hoverIndex < visibleCandles.length
      ? visibleCandles[hoverIndex]
      : visibleCandles[visibleCandles.length - 1];

  const hoveredRsi =
    hoverIndex !== null && startIndex + hoverIndex < rsi14.length
      ? rsi14[startIndex + hoverIndex]
      : rsi14[rsi14.length - 1];

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, x / rect.width));
    const idx = Math.min(
      visibleCandles.length - 1,
      Math.max(0, Math.floor(ratio * visibleCandles.length))
    );
    setHoverIndex(idx);
  };

  const handleMouseLeave = () => {
    setHoverIndex(null);
  };

  // Build SVG path for line chart
  const linePoints = useMemo(() => {
    return visibleCandles
      .map((c, i) => `${i * candleWidth + candleWidth / 2},${getY(c.close)}`)
      .join(' ');
  }, [visibleCandles, candleWidth, minPrice, priceRange, chartHeight]);

  // Build SVG path for area chart
  const areaPath = useMemo(() => {
    if (visibleCandles.length === 0) return '';
    const pts = visibleCandles.map((c, i) => `${i * candleWidth + candleWidth / 2},${getY(c.close)}`);
    const firstX = candleWidth / 2;
    const lastX = (visibleCandles.length - 1) * candleWidth + candleWidth / 2;
    return `M ${firstX} ${chartHeight} L ${pts.join(' L ')} L ${lastX} ${chartHeight} Z`;
  }, [visibleCandles, candleWidth, minPrice, priceRange, chartHeight]);

  // Build SVG path for SMA 20
  const smaPoints = useMemo(() => {
    return visibleCandles
      .map((_, i) => {
        const val = sma20[startIndex + i];
        if (val === null) return null;
        return `${i * candleWidth + candleWidth / 2},${getY(val)}`;
      })
      .filter(Boolean)
      .join(' ');
  }, [visibleCandles, sma20, startIndex, candleWidth, minPrice, priceRange, chartHeight]);

  // Build SVG path for EMA 9
  const emaPoints = useMemo(() => {
    return visibleCandles
      .map((_, i) => {
        const val = ema9[startIndex + i];
        if (val === null) return null;
        return `${i * candleWidth + candleWidth / 2},${getY(val)}`;
      })
      .filter(Boolean)
      .join(' ');
  }, [visibleCandles, ema9, startIndex, candleWidth, minPrice, priceRange, chartHeight]);

  // Bollinger paths
  const bollingerUpperPoints = useMemo(() => {
    return visibleCandles
      .map((_, i) => {
        const val = bollinger.upper[startIndex + i];
        if (val === null) return null;
        return `${i * candleWidth + candleWidth / 2},${getY(val)}`;
      })
      .filter(Boolean)
      .join(' ');
  }, [visibleCandles, bollinger.upper, startIndex, candleWidth, minPrice, priceRange, chartHeight]);

  const bollingerLowerPoints = useMemo(() => {
    return visibleCandles
      .map((_, i) => {
        const val = bollinger.lower[startIndex + i];
        if (val === null) return null;
        return `${i * candleWidth + candleWidth / 2},${getY(val)}`;
      })
      .filter(Boolean)
      .join(' ');
  }, [visibleCandles, bollinger.lower, startIndex, candleWidth, minPrice, priceRange, chartHeight]);

  return (
    <div
      ref={containerRef}
      className="bg-[#090D16] border border-slate-800 rounded-xl overflow-hidden flex flex-col"
    >
      {/* Chart Top Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 bg-slate-900/70 border-b border-slate-800 text-xs">
        {/* Left: Symbol & Live OHLC readout */}
        <div className="flex items-center gap-3">
          <span className="font-semibold text-slate-100 text-xs">{symbolName}</span>
          <span className="font-mono text-cyan-400 font-bold tabular-nums">
            {currentQuote.toFixed(decimals)}
          </span>

          {hoveredCandle && (
            <div className="hidden md:flex items-center gap-2 text-[11px] font-mono text-slate-400">
              <span>O: <strong className="text-slate-200">{hoveredCandle.open.toFixed(decimals)}</strong></span>
              <span>H: <strong className="text-emerald-400">{hoveredCandle.high.toFixed(decimals)}</strong></span>
              <span>L: <strong className="text-rose-400">{hoveredCandle.low.toFixed(decimals)}</strong></span>
              <span>C: <strong className="text-slate-200">{hoveredCandle.close.toFixed(decimals)}</strong></span>
            </div>
          )}
        </div>

        {/* Right: Chart Controls & Overlays */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Timeframe intervals */}
          <div className="flex items-center bg-slate-950 p-0.5 rounded border border-slate-800">
            {(['1s', '1m', '5m'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setCandleInterval(t)}
                className={`px-2 py-0.5 text-[10px] rounded font-mono font-medium transition-colors ${
                  candleInterval === t
                    ? 'bg-slate-800 text-cyan-300 font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          {/* Chart Type Toggle */}
          <div className="flex items-center bg-slate-950 p-0.5 rounded border border-slate-800">
            <button
              onClick={() => setChartType('candles')}
              className={`px-2 py-0.5 text-[10px] rounded font-medium transition-colors ${
                chartType === 'candles'
                  ? 'bg-slate-800 text-slate-100 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Candles
            </button>
            <button
              onClick={() => setChartType('line')}
              className={`px-2 py-0.5 text-[10px] rounded font-medium transition-colors ${
                chartType === 'line'
                  ? 'bg-slate-800 text-slate-100 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Line
            </button>
            <button
              onClick={() => setChartType('area')}
              className={`px-2 py-0.5 text-[10px] rounded font-medium transition-colors ${
                chartType === 'area'
                  ? 'bg-slate-800 text-slate-100 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Area
            </button>
          </div>

          {/* Overlays */}
          <div className="hidden sm:flex items-center gap-1">
            <button
              onClick={() => setShowSMA(!showSMA)}
              className={`px-1.5 py-0.5 text-[10px] rounded border transition-colors ${
                showSMA
                  ? 'border-amber-500/50 bg-amber-500/10 text-amber-300 font-semibold'
                  : 'border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              SMA 20
            </button>
            <button
              onClick={() => setShowEMA(!showEMA)}
              className={`px-1.5 py-0.5 text-[10px] rounded border transition-colors ${
                showEMA
                  ? 'border-indigo-500/50 bg-indigo-500/10 text-indigo-300 font-semibold'
                  : 'border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              EMA 9
            </button>
            <button
              onClick={() => setShowBollinger(!showBollinger)}
              className={`px-1.5 py-0.5 text-[10px] rounded border transition-colors ${
                showBollinger
                  ? 'border-cyan-500/50 bg-cyan-500/10 text-cyan-300 font-semibold'
                  : 'border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              Bollinger
            </button>
          </div>

          {/* Zoom controls */}
          <div className="flex items-center bg-slate-950 p-0.5 rounded border border-slate-800">
            <button
              onClick={() => setCandleCount((prev) => Math.min(100, prev + 15))}
              className="p-1 text-slate-400 hover:text-slate-200"
              title="Zoom Out (Show More)"
            >
              <ZoomOut className="w-3 h-3" />
            </button>
            <button
              onClick={() => setCandleCount((prev) => Math.max(25, prev - 15))}
              className="p-1 text-slate-400 hover:text-slate-200"
              title="Zoom In (Show Less)"
            >
              <ZoomIn className="w-3 h-3" />
            </button>
            <button
              onClick={() => setCandleCount(60)}
              className="p-1 text-slate-400 hover:text-slate-200"
              title="Reset Zoom"
            >
              <RotateCcw className="w-3 h-3" />
            </button>
          </div>

          {/* SubChart Switcher */}
          <div className="flex items-center bg-slate-950 p-0.5 rounded border border-slate-800">
            <button
              onClick={() => setSubChart('rsi')}
              className={`px-1.5 py-0.5 text-[10px] rounded font-medium transition-colors ${
                subChart === 'rsi' ? 'bg-slate-800 text-cyan-300' : 'text-slate-400'
              }`}
            >
              RSI
            </button>
            <button
              onClick={() => setSubChart('macd')}
              className={`px-1.5 py-0.5 text-[10px] rounded font-medium transition-colors ${
                subChart === 'macd' ? 'bg-slate-800 text-cyan-300' : 'text-slate-400'
              }`}
            >
              MACD
            </button>
            <button
              onClick={() => setSubChart('none')}
              className={`px-1.5 py-0.5 text-[10px] rounded font-medium transition-colors ${
                subChart === 'none' ? 'bg-slate-800 text-slate-200' : 'text-slate-400'
              }`}
            >
              Off
            </button>
          </div>
        </div>
      </div>

      {/* SVG Canvas Area */}
      <div className="relative w-full overflow-hidden select-none bg-[#070B12]">
        <svg
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          className="w-full h-auto block cursor-crosshair"
          style={{ maxHeight: `${chartHeight}px` }}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        >
          <defs>
            <linearGradient id="areaFillGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#06B6D4" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#06B6D4" stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* Background Grid Lines */}
          {[0.2, 0.4, 0.6, 0.8].map((ratio) => {
            const y = chartHeight * ratio;
            const price = maxPrice - ratio * priceRange;
            return (
              <g key={ratio}>
                <line
                  x1="0"
                  y1={y}
                  x2={chartWidth}
                  y2={y}
                  stroke="#1E293B"
                  strokeDasharray="3 3"
                  strokeWidth="0.8"
                />
                <text
                  x={chartWidth - 8}
                  y={y - 3}
                  textAnchor="end"
                  fill="#64748B"
                  fontSize="9"
                  fontFamily="monospace"
                >
                  {price.toFixed(decimals)}
                </text>
              </g>
            );
          })}

          {/* Area Chart Fill */}
          {chartType === 'area' && (
            <path d={areaPath} fill="url(#areaFillGradient)" />
          )}

          {/* Bollinger Bands Fill & Lines */}
          {showBollinger && bollingerUpperPoints && bollingerLowerPoints && (
            <>
              <polyline
                points={bollingerUpperPoints}
                fill="none"
                stroke="#06B6D4"
                strokeWidth="1"
                opacity="0.6"
              />
              <polyline
                points={bollingerLowerPoints}
                fill="none"
                stroke="#06B6D4"
                strokeWidth="1"
                opacity="0.6"
              />
            </>
          )}

          {/* SMA 20 Overlay */}
          {showSMA && smaPoints && (
            <polyline
              points={smaPoints}
              fill="none"
              stroke="#F59E0B"
              strokeWidth="1.2"
              opacity="0.85"
            />
          )}

          {/* EMA 9 Overlay */}
          {showEMA && emaPoints && (
            <polyline
              points={emaPoints}
              fill="none"
              stroke="#6366F1"
              strokeWidth="1.2"
              opacity="0.85"
            />
          )}

          {/* Candlesticks Rendering */}
          {chartType === 'candles' ? (
            visibleCandles.map((c, i) => {
              const x = i * candleWidth + candleWidth / 2;
              const isUp = c.close >= c.open;
              const openY = getY(c.open);
              const closeY = getY(c.close);
              const highY = getY(c.high);
              const lowY = getY(c.low);
              const bodyTop = Math.min(openY, closeY);
              const bodyHeight = Math.max(1.5, Math.abs(closeY - openY));
              const color = isUp ? '#10B981' : '#EF4444';

              return (
                <g key={c.epoch || i}>
                  <line
                    x1={x}
                    y1={highY}
                    x2={x}
                    y2={lowY}
                    stroke={color}
                    strokeWidth="1"
                  />
                  <rect
                    x={x - (candleWidth * 0.72) / 2}
                    y={bodyTop}
                    width={candleWidth * 0.72}
                    height={bodyHeight}
                    fill={color}
                    rx="0.5"
                  />
                </g>
              );
            })
          ) : (
            <polyline
              points={linePoints}
              fill="none"
              stroke="#06B6D4"
              strokeWidth="1.5"
            />
          )}

          {/* Active Trades Horizontal Barrier Lines */}
          {activeTrades.map((t) => {
            const tradeY = getY(t.entryPrice);
            const isCall = t.contractType === 'CALL';
            const color = isCall ? '#10B981' : '#EF4444';
            return (
              <g key={t.id}>
                <line
                  x1="0"
                  y1={tradeY}
                  x2={chartWidth - 80}
                  y2={tradeY}
                  stroke={color}
                  strokeDasharray="4 3"
                  strokeWidth="1.2"
                  opacity="0.9"
                />
                <rect
                  x="6"
                  y={tradeY - 8}
                  width="72"
                  height="16"
                  fill="#0F172A"
                  stroke={color}
                  strokeWidth="0.8"
                  rx="3"
                />
                <text
                  x="42"
                  y={tradeY + 3.5}
                  textAnchor="middle"
                  fill={color}
                  fontSize="8.5"
                  fontWeight="bold"
                  fontFamily="monospace"
                >
                  {t.contractType} (${t.stake})
                </text>
              </g>
            );
          })}

          {/* Current Price Horizontal Ray */}
          <line
            x1="0"
            y1={getY(currentQuote)}
            x2={chartWidth}
            y2={getY(currentQuote)}
            stroke="#06B6D4"
            strokeDasharray="4 2"
            strokeWidth="1"
          />
          <rect
            x={chartWidth - 70}
            y={getY(currentQuote) - 8}
            width="68"
            height="16"
            fill="#06B6D4"
            rx="2"
          />
          <text
            x={chartWidth - 36}
            y={getY(currentQuote) + 3.5}
            textAnchor="middle"
            fill="#090D16"
            fontSize="9"
            fontWeight="bold"
            fontFamily="monospace"
          >
            {currentQuote.toFixed(decimals)}
          </text>

          {/* Hover Crosshair */}
          {hoverIndex !== null && (
            <line
              x1={hoverIndex * candleWidth + candleWidth / 2}
              y1="0"
              x2={hoverIndex * candleWidth + candleWidth / 2}
              y2={chartHeight}
              stroke="#94A3B8"
              strokeDasharray="2 2"
              strokeWidth="0.8"
            />
          )}
        </svg>

        {/* Sub-chart (RSI or MACD) */}
        {subChart === 'rsi' && (
          <div className="border-t border-slate-800 bg-[#070B12] px-2 py-1">
            <div className="flex items-center justify-between text-[10px] text-slate-400 mb-0.5 px-2">
              <span className="font-semibold text-cyan-400">RSI (14)</span>
              <span className="font-mono text-slate-200">
                {hoveredRsi !== null && hoveredRsi !== undefined
                  ? hoveredRsi.toFixed(1)
                  : '--'}
              </span>
            </div>
            <svg
              viewBox={`0 0 ${chartWidth} ${subChartHeight}`}
              className="w-full h-auto block"
              style={{ maxHeight: `${subChartHeight}px` }}
            >
              <line
                x1="0"
                y1={subChartHeight * 0.3}
                x2={chartWidth}
                y2={subChartHeight * 0.3}
                stroke="#EF4444"
                strokeDasharray="2 2"
                strokeWidth="0.8"
                opacity="0.7"
              />
              <line
                x1="0"
                y1={subChartHeight * 0.7}
                x2={chartWidth}
                y2={subChartHeight * 0.7}
                stroke="#10B981"
                strokeDasharray="2 2"
                strokeWidth="0.8"
                opacity="0.7"
              />
              <text x="6" y={subChartHeight * 0.3 - 2} fill="#EF4444" fontSize="8" fontFamily="monospace">
                70
              </text>
              <text x="6" y={subChartHeight * 0.7 - 2} fill="#10B981" fontSize="8" fontFamily="monospace">
                30
              </text>

              <polyline
                points={visibleCandles
                  .map((_, i) => {
                    const r = rsi14[startIndex + i];
                    if (r === null) return null;
                    const y = subChartHeight - (r / 100) * subChartHeight;
                    return `${i * candleWidth + candleWidth / 2},${y}`;
                  })
                  .filter(Boolean)
                  .join(' ')}
                fill="none"
                stroke="#38BDF8"
                strokeWidth="1.2"
              />
            </svg>
          </div>
        )}

        {subChart === 'macd' && (
          <div className="border-t border-slate-800 bg-[#070B12] px-2 py-1">
            <div className="flex items-center justify-between text-[10px] text-slate-400 mb-0.5 px-2">
              <span className="font-semibold text-cyan-400">MACD (12, 26, 9)</span>
            </div>
            <svg
              viewBox={`0 0 ${chartWidth} ${subChartHeight}`}
              className="w-full h-auto block"
              style={{ maxHeight: `${subChartHeight}px` }}
            >
              <line
                x1="0"
                y1={subChartHeight / 2}
                x2={chartWidth}
                y2={subChartHeight / 2}
                stroke="#334155"
                strokeWidth="0.8"
              />
              {visibleCandles.map((_, i) => {
                const h = macdData.histogram[startIndex + i];
                if (h === null) return null;
                const barHeight = Math.min(subChartHeight / 2 - 2, Math.abs(h * 8));
                const y = h >= 0 ? subChartHeight / 2 - barHeight : subChartHeight / 2;
                const color = h >= 0 ? '#10B981' : '#EF4444';
                return (
                  <rect
                    key={i}
                    x={i * candleWidth + candleWidth * 0.2}
                    y={y}
                    width={candleWidth * 0.6}
                    height={Math.max(1, barHeight)}
                    fill={color}
                    opacity="0.8"
                  />
                );
              })}
            </svg>
          </div>
        )}
      </div>
    </div>
  );
};
