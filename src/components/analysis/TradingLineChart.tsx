import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Trade } from '../../types/trading';
import { AlertCircle, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';

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

const TIMEFRAME_WINDOWS: Record<string, number> = {
  '1s': 60,
  '1m': 100,
  '5m': 140,
  '15m': 180,
};

export const TradingLineChart: React.FC<TradingLineChartProps> = ({
  data,
  symbolName,
  decimals,
  currentQuote,
  direction = 'flat',
  height = 340,
  activeTrades = [],
  isWsConnected = true,
  dataSource = 'demo',
  timeframe: controlledTimeframe,
  onTimeframeChange,
}) => {
  const [internalTimeframe, setInternalTimeframe] = useState<string>(controlledTimeframe || '1s');
  const activeTimeframe = controlledTimeframe || internalTimeframe;
  const [pointCount, setPointCount] = useState<number>(60);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [chartDimensions, setChartDimensions] = useState<{ width: number; height: number }>({
    width: 820,
    height: height || 320,
  });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const updateDimensions = () => {
      if (!containerRef.current) return;
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      if (w > 60 && h > 60) {
        setChartDimensions((prev) =>
          prev.width === Math.round(w) && prev.height === Math.round(h)
            ? prev
            : { width: Math.round(w), height: Math.round(h) }
        );
      }
    };

    updateDimensions();
    const ro = new ResizeObserver(() => updateDimensions());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const handleTimeframeSelect = (tf: string) => {
    setInternalTimeframe(tf);
    setPointCount(TIMEFRAME_WINDOWS[tf] || 60);
    if (onTimeframeChange) onTimeframeChange(tf);
  };

  // Visible slice of live price points
  const visibleData = useMemo(() => {
    if (!data || data.length === 0) return [];
    return data.slice(-pointCount);
  }, [data, pointCount]);

  // Compute price bounds safely
  const { minPrice, maxPrice, priceRange } = useMemo(() => {
    if (visibleData.length === 0) {
      const p = currentQuote || 100;
      return { minPrice: p * 0.999, maxPrice: p * 1.001, priceRange: p * 0.002 };
    }

    let min = Infinity;
    let max = -Infinity;
    for (const pt of visibleData) {
      if (Number.isFinite(pt.price)) {
        if (pt.price < min) min = pt.price;
        if (pt.price > max) max = pt.price;
      }
    }

    for (const t of activeTrades) {
      if (Number.isFinite(t.entryPrice)) {
        if (t.entryPrice < min) min = t.entryPrice;
        if (t.entryPrice > max) max = t.entryPrice;
      }
    }

    if (Number.isFinite(currentQuote) && currentQuote > 0) {
      if (currentQuote < min) min = currentQuote;
      if (currentQuote > max) max = currentQuote;
    }

    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      const p = currentQuote || 100;
      return { minPrice: p * 0.999, maxPrice: p * 1.001, priceRange: p * 0.002 };
    }

    const diff = max - min;
    const padding = diff > 0 ? diff * 0.14 : Math.max(min * 0.0008, 0.05);

    return {
      minPrice: min - padding,
      maxPrice: max + padding,
      priceRange: diff + padding * 2,
    };
  }, [visibleData, currentQuote, activeTrades]);

  const chartWidth = Math.max(240, chartDimensions.width);
  const currentHeight = Math.max(180, chartDimensions.height);
  const paddingLeft = 10;
  const paddingRight = 72;
  const paddingTop = 14;
  const paddingBottom = 26;

  const innerWidth = Math.max(60, chartWidth - paddingLeft - paddingRight);
  const innerHeight = Math.max(60, currentHeight - paddingTop - paddingBottom);

  const getX = (index: number) => {
    if (visibleData.length <= 1) return paddingLeft + innerWidth / 2;
    return paddingLeft + (index / (visibleData.length - 1)) * innerWidth;
  };

  const getY = (price: number) => {
    if (priceRange <= 0) return paddingTop + innerHeight / 2;
    const normalized = (price - minPrice) / priceRange;
    return paddingTop + innerHeight - normalized * innerHeight;
  };

  // Generate SVG path strings cleanly
  const { linePath, areaPath, lastPointCoords } = useMemo(() => {
    if (visibleData.length === 0) {
      return { linePath: '', areaPath: '', lastPointCoords: null };
    }

    let d = '';
    for (let idx = 0; idx < visibleData.length; idx++) {
      const x = getX(idx);
      const y = getY(visibleData[idx].price);
      d += idx === 0 ? `M ${x.toFixed(1)} ${y.toFixed(1)}` : ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
    }

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

  // Time axis ticks (up to 5 evenly spaced points)
  const xTicks = useMemo(() => {
    if (visibleData.length < 2) return [];
    const count = Math.min(5, visibleData.length);
    const ticks = [];
    for (let i = 0; i < count; i++) {
      const idx = Math.round((i / (count - 1)) * (visibleData.length - 1));
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

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!svgRef.current || visibleData.length === 0) return;
    const rect = svgRef.current.getBoundingClientRect();
    if (rect.width <= 0) return;
    const clickX = ((e.clientX - rect.left) / rect.width) * chartWidth;

    if (clickX < paddingLeft || clickX > paddingLeft + innerWidth) {
      setHoverIndex(null);
      return;
    }

    const relativeX = (clickX - paddingLeft) / innerWidth;
    const index = Math.round(relativeX * (visibleData.length - 1));
    setHoverIndex(Math.max(0, Math.min(visibleData.length - 1, index)));
  };

  const handleMouseLeave = () => setHoverIndex(null);

  const hoveredPoint =
    hoverIndex !== null && hoverIndex < visibleData.length ? visibleData[hoverIndex] : null;

  const badgeFill =
    direction === 'up' ? '#047857' : direction === 'down' ? '#be123c' : '#0e7490';
  const badgeStroke =
    direction === 'up' ? '#34d399' : direction === 'down' ? '#fb7185' : '#22d3ee';

  return (
    <div className="w-full h-full flex flex-col min-h-[240px] bg-[#090D16] select-none overflow-hidden">
      {/* Compact Institutional Chart Toolbar */}
      <div className="px-3 py-1.5 border-b border-slate-800/80 bg-[#0A0F1A] flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="font-semibold text-xs text-slate-100 tracking-tight truncate">
            {symbolName}
          </span>
          <span className="text-[10px] font-mono text-slate-500">
            {dataSource === 'live' && isWsConnected ? 'Live Stream' : 'Tick Chart'}
          </span>
          <span
            className={`font-mono text-xs font-semibold tabular-nums ${
              direction === 'up'
                ? 'text-emerald-400'
                : direction === 'down'
                ? 'text-rose-400'
                : 'text-slate-200'
            }`}
          >
            {currentQuote > 0 ? currentQuote.toFixed(decimals) : '—'}
          </span>
        </div>

        {/* Timeframe & Zoom Controls */}
        <div className="flex items-center gap-1.5 text-xs">
          <div className="flex bg-slate-950 p-0.5 rounded border border-slate-800 text-[10px] font-mono">
            {(['1s', '1m', '5m', '15m'] as const).map((tf) => (
              <button
                key={tf}
                type="button"
                onClick={() => handleTimeframeSelect(tf)}
                className={`px-1.5 py-0.5 rounded-sm transition-colors cursor-pointer ${
                  activeTimeframe === tf
                    ? 'bg-slate-800 text-cyan-300 font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {tf}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-0.5 bg-slate-950 p-0.5 rounded border border-slate-800">
            <button
              type="button"
              onClick={() => setPointCount((prev) => Math.max(25, prev - 15))}
              className="p-1 text-slate-400 hover:text-cyan-300 rounded-sm transition-colors cursor-pointer"
              title="Zoom In"
            >
              <ZoomIn className="w-3 h-3" />
            </button>
            <button
              type="button"
              onClick={() => setPointCount((prev) => Math.min(200, prev + 15))}
              className="p-1 text-slate-400 hover:text-cyan-300 rounded-sm transition-colors cursor-pointer"
              title="Zoom Out"
            >
              <ZoomOut className="w-3 h-3" />
            </button>
            <button
              type="button"
              onClick={() => {
                setInternalTimeframe('1s');
                setPointCount(60);
              }}
              className="p-1 text-slate-400 hover:text-slate-200 rounded-sm transition-colors cursor-pointer"
              title="Reset Scale"
            >
              <RotateCcw className="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>

      {/* Main SVG Line Chart Canvas */}
      <div ref={containerRef} className="relative w-full flex-1 min-h-[200px] overflow-hidden bg-[#080C14]">
        {visibleData.length === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-500 space-y-2">
            <AlertCircle className="w-5 h-5 text-slate-600 animate-pulse" />
            <span className="text-xs font-mono">Connecting to live price feed...</span>
          </div>
        ) : (
          <svg
            ref={svgRef}
            width="100%"
            height="100%"
            viewBox={`0 0 ${chartWidth} ${currentHeight}`}
            className="block w-full h-full cursor-crosshair"
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
          >
            <defs>
              <linearGradient id="lineAreaGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.18" />
                <stop offset="75%" stopColor="#22d3ee" stopOpacity="0.03" />
                <stop offset="100%" stopColor="#22d3ee" stopOpacity="0.0" />
              </linearGradient>
            </defs>

            {/* Horizontal Price Grid Lines & Right Y-Axis Scale */}
            {yTicks.map((tick, i) => (
              <g key={`ytick-${i}`}>
                <line
                  x1={paddingLeft}
                  y1={tick.y}
                  x2={paddingLeft + innerWidth}
                  y2={tick.y}
                  stroke="#162033"
                  strokeWidth="0.8"
                  strokeDasharray="2 3"
                />
                <text
                  x={paddingLeft + innerWidth + 6}
                  y={tick.y + 3}
                  fill="#64748b"
                  fontSize="10"
                  fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                >
                  {tick.price.toFixed(decimals)}
                </text>
              </g>
            ))}

            {/* Vertical Time Grid Lines & Bottom X-Axis Labels */}
            {xTicks.map((tick, i) => (
              <g key={`xtick-${i}`}>
                <line
                  x1={tick.x}
                  y1={paddingTop}
                  x2={tick.x}
                  y2={paddingTop + innerHeight}
                  stroke="#162033"
                  strokeWidth="0.8"
                  strokeDasharray="2 3"
                />
                <text
                  x={tick.x}
                  y={paddingTop + innerHeight + 17}
                  fill="#64748b"
                  fontSize="9"
                  fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                  textAnchor="middle"
                >
                  {tick.timeStr}
                </text>
              </g>
            ))}

            {/* Right Y-Axis Divider */}
            <line
              x1={paddingLeft + innerWidth}
              y1={paddingTop}
              x2={paddingLeft + innerWidth}
              y2={paddingTop + innerHeight}
              stroke="#1e293b"
              strokeWidth="1"
            />

            {/* Bottom X-Axis Divider */}
            <line
              x1={paddingLeft}
              y1={paddingTop + innerHeight}
              x2={paddingLeft + innerWidth}
              y2={paddingTop + innerHeight}
              stroke="#1e293b"
              strokeWidth="1"
            />

            {/* Active Trade Entry Lines */}
            {activeTrades.map((trade) => {
              const tradeY = getY(trade.entryPrice);
              const isCall = trade.contractType === 'CALL' || trade.contractType === 'EVEN';
              return (
                <g key={trade.id}>
                  <line
                    x1={paddingLeft}
                    y1={tradeY}
                    x2={paddingLeft + innerWidth}
                    y2={tradeY}
                    stroke={isCall ? '#10b981' : '#f43f5e'}
                    strokeWidth="1.2"
                    strokeDasharray="4 3"
                  />
                  <rect
                    x={paddingLeft + 4}
                    y={Math.max(paddingTop, tradeY - 9)}
                    width="96"
                    height="18"
                    rx="3"
                    fill={isCall ? '#064e3b' : '#881337'}
                    stroke={isCall ? '#10b981' : '#f43f5e'}
                    strokeWidth="0.8"
                  />
                  <text
                    x={paddingLeft + 52}
                    y={Math.max(paddingTop + 12, tradeY + 3)}
                    fill="#ffffff"
                    fontSize="9"
                    fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                    fontWeight="bold"
                    textAnchor="middle"
                  >
                    {trade.contractType} ({trade.remainingTicks}t)
                  </text>
                </g>
              );
            })}

            {/* Area Fill */}
            {areaPath && <path d={areaPath} fill="url(#lineAreaGradient)" />}

            {/* Main Live Price Line */}
            {linePath && (
              <path
                d={linePath}
                fill="none"
                stroke="#22d3ee"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}

            {/* Live Current Price Guideline & Y-Axis Indicator */}
            {lastPointCoords && (
              <g>
                <line
                  x1={paddingLeft}
                  y1={lastPointCoords.y}
                  x2={paddingLeft + innerWidth}
                  y2={lastPointCoords.y}
                  stroke={badgeStroke}
                  strokeWidth="0.9"
                  strokeDasharray="3 3"
                  strokeOpacity="0.75"
                />

                <circle
                  cx={lastPointCoords.x}
                  cy={lastPointCoords.y}
                  r="3.5"
                  fill={badgeStroke}
                  stroke="#080C14"
                  strokeWidth="1.5"
                />

                <g
                  transform={`translate(${paddingLeft + innerWidth + 2}, ${Math.max(
                    paddingTop,
                    Math.min(paddingTop + innerHeight - 18, lastPointCoords.y - 9)
                  )})`}
                >
                  <rect
                    width="66"
                    height="18"
                    rx="2"
                    fill={badgeFill}
                    stroke={badgeStroke}
                    strokeWidth="0.8"
                  />
                  <text
                    x="33"
                    y="12"
                    fill="#ffffff"
                    fontSize="9"
                    fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                    fontWeight="bold"
                    textAnchor="middle"
                  >
                    {currentQuote.toFixed(decimals)}
                  </text>
                </g>
              </g>
            )}

            {/* Hover Crosshair */}
            {hoveredPoint && hoverIndex !== null && (
              <g>
                <line
                  x1={getX(hoverIndex)}
                  y1={paddingTop}
                  x2={getX(hoverIndex)}
                  y2={paddingTop + innerHeight}
                  stroke="#64748b"
                  strokeWidth="0.9"
                  strokeDasharray="2 2"
                />
                <line
                  x1={paddingLeft}
                  y1={getY(hoveredPoint.price)}
                  x2={paddingLeft + innerWidth}
                  y2={getY(hoveredPoint.price)}
                  stroke="#64748b"
                  strokeWidth="0.9"
                  strokeDasharray="2 2"
                />
                <circle
                  cx={getX(hoverIndex)}
                  cy={getY(hoveredPoint.price)}
                  r="3.5"
                  fill="#ffffff"
                  stroke="#22d3ee"
                  strokeWidth="1.5"
                />
              </g>
            )}
          </svg>
        )}

        {/* Hover Readout */}
        {hoveredPoint && (
          <div className="absolute top-2 left-3 bg-[#0D1322]/95 border border-slate-700/80 rounded px-2.5 py-1 text-[10px] font-mono pointer-events-none space-y-0.5">
            <div className="text-slate-400">{new Date(hoveredPoint.time).toLocaleTimeString()}</div>
            <div className="text-cyan-300 font-semibold tabular-nums">
              {hoveredPoint.price.toFixed(decimals)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
