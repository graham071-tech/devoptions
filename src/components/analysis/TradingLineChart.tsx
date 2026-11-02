import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Trade } from '../../types/trading';
import { Radio, AlertCircle, Maximize2, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';

export interface PricePoint {
  time: number;
  price: number;
}

interface TradingLineChartProps {
  data: PricePoint[];
  symbolName: string;
  decimals: number;
  currentQuote: number;
  direction?: 'up' | 'down' | 'flat';
  height?: number;
  activeTrades?: Trade[];
  isWsConnected?: boolean;
  dataSource?: 'live' | 'demo' | 'simulated';
  timeframe?: string;
  onTimeframeChange?: (tf: string) => void;
}

export const TradingLineChart: React.FC<TradingLineChartProps> = ({
  data,
  symbolName,
  decimals,
  currentQuote,
  direction = 'flat',
  height = 360,
  activeTrades = [],
  isWsConnected = true,
  dataSource = 'live',
  timeframe = '1m',
  onTimeframeChange,
}) => {
  const [pointCount, setPointCount] = useState<number>(60);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [chartDimensions, setChartDimensions] = useState<{ width: number; height: number }>({
    width: 900,
    height: height || 320,
  });

  useEffect(() => {
    if (!containerRef.current) return;
    const updateDimensions = () => {
      if (containerRef.current) {
        const w = containerRef.current.clientWidth;
        const h = containerRef.current.clientHeight;
        if (w > 200 && h > 100) {
          setChartDimensions({ width: Math.round(w), height: Math.round(h) });
        }
      }
    };
    updateDimensions();
    const ro = new ResizeObserver(() => updateDimensions());
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // Filter visible points
  const visibleData = useMemo(() => {
    if (!data || data.length === 0) return [];
    return data.slice(-pointCount);
  }, [data, pointCount]);

  // Compute price bounds
  const { minPrice, maxPrice, priceRange } = useMemo(() => {
    if (visibleData.length === 0) {
      const p = currentQuote || 100;
      return { minPrice: p * 0.999, maxPrice: p * 1.001, priceRange: p * 0.002 };
    }
    let min = Infinity;
    let max = -Infinity;
    visibleData.forEach((pt) => {
      if (pt.price < min) min = pt.price;
      if (pt.price > max) max = pt.price;
    });

    // Also include active trades entry price
    activeTrades.forEach((t) => {
      if (t.entryPrice < min) min = t.entryPrice;
      if (t.entryPrice > max) max = t.entryPrice;
    });

    // Include current quote
    if (currentQuote < min) min = currentQuote;
    if (currentQuote > max) max = currentQuote;

    const diff = max - min;
    const padding = diff > 0 ? diff * 0.12 : min * 0.001 || 1;

    return {
      minPrice: min - padding,
      maxPrice: max + padding,
      priceRange: max - min + padding * 2,
    };
  }, [visibleData, currentQuote, activeTrades]);

  // SVG coordinate calculations
  const chartWidth = chartDimensions.width;
  const currentHeight = chartDimensions.height;
  const paddingLeft = 12;
  const paddingRight = 68; // Space for right Y-axis prices
  const paddingTop = 14;
  const paddingBottom = 26; // Space for X-axis time labels

  const innerWidth = Math.max(50, chartWidth - paddingLeft - paddingRight);
  const innerHeight = Math.max(50, currentHeight - paddingTop - paddingBottom);

  const getX = (index: number) => {
    if (visibleData.length <= 1) return paddingLeft + innerWidth / 2;
    return paddingLeft + (index / (visibleData.length - 1)) * innerWidth;
  };

  const getY = (price: number) => {
    if (priceRange <= 0) return paddingTop + innerHeight / 2;
    const normalized = (price - minPrice) / priceRange;
    return paddingTop + innerHeight - normalized * innerHeight;
  };

  // Generate SVG Path for line and area
  const { linePath, areaPath, lastPointCoords } = useMemo(() => {
    if (visibleData.length === 0) {
      return { linePath: '', areaPath: '', lastPointCoords: null };
    }

    let d = '';
    visibleData.forEach((pt, idx) => {
      const x = getX(idx);
      const y = getY(pt.price);
      if (idx === 0) {
        d += `M ${x.toFixed(1)} ${y.toFixed(1)}`;
      } else {
        d += ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
      }
    });

    const lastIdx = visibleData.length - 1;
    const lastX = getX(lastIdx);
    const lastY = getY(visibleData[lastIdx].price);
    const firstX = getX(0);
    const bottomY = paddingTop + innerHeight;

    const area = `${d} L ${lastX.toFixed(1)} ${bottomY.toFixed(1)} L ${firstX.toFixed(1)} ${bottomY.toFixed(1)} Z`;

    return {
      linePath: d,
      areaPath: area,
      lastPointCoords: { x: lastX, y: lastY },
    };
  }, [visibleData, minPrice, priceRange, innerWidth, innerHeight]);

  // Price axis ticks (5 levels)
  const yTicks = useMemo(() => {
    const ticks = [];
    const count = 5;
    for (let i = 0; i < count; i++) {
      const price = minPrice + (priceRange / (count - 1)) * i;
      const y = getY(price);
      ticks.push({ price, y });
    }
    return ticks;
  }, [minPrice, priceRange, innerHeight]);

  // Time axis ticks (5 points)
  const xTicks = useMemo(() => {
    if (visibleData.length === 0) return [];
    const count = Math.min(5, visibleData.length);
    const ticks = [];
    const step = Math.floor(visibleData.length / count);
    for (let i = 0; i < count; i++) {
      const idx = Math.min(i * step, visibleData.length - 1);
      const pt = visibleData[idx];
      const x = getX(idx);
      const timeStr = new Date(pt.time).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
      ticks.push({ timeStr, x });
    }
    return ticks;
  }, [visibleData, innerWidth]);

  // Mouse hover event handler
  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current || visibleData.length === 0) return;
    const rect = svgRef.current.getBoundingClientRect();
    const clickX = ((e.clientX - rect.left) / rect.width) * chartWidth;

    if (clickX < paddingLeft || clickX > paddingLeft + innerWidth) {
      setHoverIndex(null);
      return;
    }

    const relativeX = (clickX - paddingLeft) / innerWidth;
    const index = Math.round(relativeX * (visibleData.length - 1));
    const clampedIndex = Math.max(0, Math.min(visibleData.length - 1, index));
    setHoverIndex(clampedIndex);
  };

  const handleMouseLeave = () => {
    setHoverIndex(null);
  };

  const hoveredPoint = hoverIndex !== null && hoverIndex < visibleData.length ? visibleData[hoverIndex] : null;

  return (
    <div className="bg-[#090D16] border border-slate-800 rounded-lg p-2 sm:p-2.5 space-y-1 select-none flex flex-col flex-1 min-h-[180px] overflow-hidden">
      {/* Chart Top Header: Symbol, Timeframe & Zoom Controls */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-1 border-b border-slate-800/60 shrink-0">
        <div className="flex items-center gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-xs sm:text-sm text-slate-100 font-sans tracking-tight">
                {symbolName}
              </span>
              <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 font-semibold uppercase">
                Line Feed
              </span>
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span
                className={`font-mono text-xs sm:text-sm font-bold tabular-nums ${
                  direction === 'up'
                    ? 'text-emerald-400'
                    : direction === 'down'
                    ? 'text-rose-400'
                    : 'text-slate-200'
                }`}
              >
                {currentQuote > 0 ? currentQuote.toFixed(decimals) : '—'}
              </span>
              <span className="text-[10px] text-slate-500 font-mono">
                {dataSource === 'live' && isWsConnected ? 'Deriv Stream' : 'Simulated Feed'}
              </span>
            </div>
          </div>
        </div>

        {/* Timeframe & Zoom controls */}
        <div className="flex items-center gap-1.5 text-xs">
          {/* Timeframe tabs */}
          <div className="flex bg-slate-950 p-0.5 rounded-lg border border-slate-800 text-[10px] font-mono">
            {['1s', '1m', '5m', '15m'].map((tf) => (
              <button
                key={tf}
                onClick={() => onTimeframeChange && onTimeframeChange(tf)}
                className={`px-1.5 py-0.5 rounded transition-colors ${
                  timeframe === tf
                    ? 'bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-500/40'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>

          {/* Zoom In/Out */}
          <div className="flex items-center gap-0.5 bg-slate-950 p-0.5 rounded-lg border border-slate-800">
            <button
              onClick={() => setPointCount((prev) => Math.max(30, prev - 15))}
              className="p-1 text-slate-400 hover:text-cyan-400 rounded transition-colors"
              title="Zoom In (Fewer points)"
            >
              <ZoomIn className="w-3 h-3" />
            </button>
            <button
              onClick={() => setPointCount((prev) => Math.min(150, prev + 15))}
              className="p-1 text-slate-400 hover:text-cyan-400 rounded transition-colors"
              title="Zoom Out (More points)"
            >
              <ZoomOut className="w-3 h-3" />
            </button>
            <button
              onClick={() => setPointCount(60)}
              className="p-1 text-slate-400 hover:text-slate-200 rounded transition-colors"
              title="Reset Zoom"
            >
              <RotateCcw className="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>

      {/* Main SVG Line Chart Area */}
      <div ref={containerRef} className="relative w-full flex-1 min-h-[140px] overflow-hidden">
        {visibleData.length === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-500 space-y-2">
            <AlertCircle className="w-6 h-6 text-slate-600 animate-pulse" />
            <span className="text-xs font-mono">Connecting to live price feed...</span>
          </div>
        ) : (
          <svg
            ref={svgRef}
            viewBox={`0 0 ${chartWidth} ${currentHeight}`}
            className="w-full h-full cursor-crosshair"
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
          >
            <defs>
              {/* Cyan Gradient for Area Fill under line */}
              <linearGradient id="lineAreaGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.28" />
                <stop offset="70%" stopColor="#06b6d4" stopOpacity="0.04" />
                <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.0" />
              </linearGradient>

              {/* Grid Line Pattern */}
              <pattern id="chartGrid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#1e293b" strokeWidth="0.5" strokeOpacity="0.4" />
              </pattern>
            </defs>

            {/* Background Grid */}
            <rect
              x={paddingLeft}
              y={paddingTop}
              width={innerWidth}
              height={innerHeight}
              fill="url(#chartGrid)"
            />

            {/* Horizontal Price Grid Lines & Y-Axis Labels */}
            {yTicks.map((tick, i) => (
              <g key={`ytick-${i}`}>
                <line
                  x1={paddingLeft}
                  y1={tick.y}
                  x2={paddingLeft + innerWidth}
                  y2={tick.y}
                  stroke="#1e293b"
                  strokeWidth="0.8"
                  strokeDasharray="3 3"
                />
                <text
                  x={paddingLeft + innerWidth + 6}
                  y={tick.y + 3}
                  fill="#64748b"
                  fontSize="10"
                  fontFamily="monospace"
                >
                  {tick.price.toFixed(decimals)}
                </text>
              </g>
            ))}

            {/* Vertical Time Grid Lines & X-Axis Labels */}
            {xTicks.map((tick, i) => (
              <g key={`xtick-${i}`}>
                <line
                  x1={tick.x}
                  y1={paddingTop}
                  x2={tick.x}
                  y2={paddingTop + innerHeight}
                  stroke="#1e293b"
                  strokeWidth="0.8"
                  strokeDasharray="3 3"
                />
                <text
                  x={tick.x}
                  y={paddingTop + innerHeight + 18}
                  fill="#64748b"
                  fontSize="9"
                  fontFamily="monospace"
                  textAnchor="middle"
                >
                  {tick.timeStr}
                </text>
              </g>
            ))}

            {/* Active Trades Entry Lines */}
            {activeTrades.map((trade) => {
              const tradeY = getY(trade.entryPrice);
              const isCall = trade.contractType === 'CALL';
              return (
                <g key={trade.id}>
                  <line
                    x1={paddingLeft}
                    y1={tradeY}
                    x2={paddingLeft + innerWidth}
                    y2={tradeY}
                    stroke={isCall ? '#10b981' : '#f43f5e'}
                    strokeWidth="1.2"
                    strokeDasharray="4 2"
                  />
                  <rect
                    x={paddingLeft + 4}
                    y={tradeY - 9}
                    width="80"
                    height="18"
                    rx="4"
                    fill={isCall ? '#064e3b' : '#881337'}
                    stroke={isCall ? '#10b981' : '#f43f5e'}
                    strokeWidth="0.8"
                  />
                  <text
                    x={paddingLeft + 44}
                    y={tradeY + 3}
                    fill="#ffffff"
                    fontSize="9"
                    fontFamily="monospace"
                    fontWeight="bold"
                    textAnchor="middle"
                  >
                    ENTRY {trade.contractType}
                  </text>
                </g>
              );
            })}

            {/* Area fill under price line */}
            {areaPath && <path d={areaPath} fill="url(#lineAreaGradient)" />}

            {/* Main Price Line */}
            {linePath && (
              <path
                d={linePath}
                fill="none"
                stroke="#22d3ee"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="transition-all duration-150"
              />
            )}

            {/* Latest Price Current Marker & Horizontal Floating Line */}
            {lastPointCoords && (
              <g>
                {/* Horizontal dashed price guideline */}
                <line
                  x1={paddingLeft}
                  y1={lastPointCoords.y}
                  x2={paddingLeft + innerWidth}
                  y2={lastPointCoords.y}
                  stroke="#0891b2"
                  strokeWidth="0.8"
                  strokeDasharray="2 2"
                  strokeOpacity="0.8"
                />

                {/* Clean spot dot on latest price */}
                <circle
                  cx={lastPointCoords.x}
                  cy={lastPointCoords.y}
                  r="3.5"
                  fill="#22d3ee"
                  stroke="#090D16"
                  strokeWidth="1.5"
                />

                {/* Floating Price Box on Right Y-Axis */}
                <g transform={`translate(${paddingLeft + innerWidth + 2}, ${lastPointCoords.y - 9})`}>
                  <rect
                    width="62"
                    height="18"
                    rx="2"
                    fill="#0e7490"
                    stroke="#22d3ee"
                    strokeWidth="0.8"
                  />
                  <text
                    x="31"
                    y="12"
                    fill="#ffffff"
                    fontSize="9"
                    fontFamily="monospace"
                    fontWeight="bold"
                    textAnchor="middle"
                  >
                    {currentQuote.toFixed(decimals)}
                  </text>
                </g>
              </g>
            )}

            {/* Crosshair Hover Lines & Tooltip */}
            {hoveredPoint && hoverIndex !== null && (
              <g>
                {/* Vertical Crosshair Line */}
                <line
                  x1={getX(hoverIndex)}
                  y1={paddingTop}
                  x2={getX(hoverIndex)}
                  y2={paddingTop + innerHeight}
                  stroke="#94a3b8"
                  strokeWidth="1"
                  strokeDasharray="2 2"
                />
                {/* Horizontal Crosshair Line */}
                <line
                  x1={paddingLeft}
                  y1={getY(hoveredPoint.price)}
                  x2={paddingLeft + innerWidth}
                  y2={getY(hoveredPoint.price)}
                  stroke="#94a3b8"
                  strokeWidth="1"
                  strokeDasharray="2 2"
                />
                {/* Crosshair Dot */}
                <circle
                  cx={getX(hoverIndex)}
                  cy={getY(hoveredPoint.price)}
                  r="4"
                  fill="#ffffff"
                  stroke="#06b6d4"
                  strokeWidth="2"
                />
              </g>
            )}
          </svg>
        )}

        {/* Hover Tooltip Overlay Box */}
        {hoveredPoint && (
          <div
            className="absolute top-2 left-3 bg-slate-900/90 border border-slate-700/80 rounded-lg px-3 py-1.5 text-[11px] font-mono shadow-xl pointer-events-none backdrop-blur-sm space-y-0.5"
          >
            <div className="text-slate-400 text-[10px]">
              {new Date(hoveredPoint.time).toLocaleTimeString()}
            </div>
            <div className="text-cyan-300 font-bold">
              Spot: ${hoveredPoint.price.toFixed(decimals)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
