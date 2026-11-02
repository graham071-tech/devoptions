import React, { useMemo } from 'react';

interface EquityCurveChartProps {
  data: { index: number; balance: number; tradePnl: number; isWin: boolean }[];
  initialBalance: number;
}

export const EquityCurveChart: React.FC<EquityCurveChartProps> = ({
  data,
  initialBalance,
}) => {
  const { minVal, maxVal, range, points, baselineY } = useMemo(() => {
    if (data.length === 0) {
      return { minVal: 0, maxVal: 100, range: 100, points: '', baselineY: 100 };
    }

    let min = initialBalance;
    let max = initialBalance;
    data.forEach((d) => {
      if (d.balance < min) min = d.balance;
      if (d.balance > max) max = d.balance;
    });

    const padding = (max - min) * 0.1 || initialBalance * 0.05;
    const paddedMin = Math.max(0, min - padding);
    const paddedMax = max + padding;
    const r = paddedMax - paddedMin || 1;

    const width = 640;
    const height = 220;

    const getY = (val: number) => height - ((val - paddedMin) / r) * height;

    const pts = data
      .map((d, i) => {
        const x = (i / Math.max(1, data.length - 1)) * width;
        const y = getY(d.balance);
        return `${x},${y}`;
      })
      .join(' ');

    const bY = getY(initialBalance);

    return { minVal: paddedMin, maxVal: paddedMax, range: r, points: pts, baselineY: bY };
  }, [data, initialBalance]);

  const width = 640;
  const height = 220;

  if (data.length <= 1) {
    return (
      <div className="h-52 flex items-center justify-center text-slate-500 text-xs font-mono">
        Run simulation to generate simulated equity trajectory curve
      </div>
    );
  }

  const finalBalance = data[data.length - 1].balance;
  const isProfitable = finalBalance >= initialBalance;
  const lineColor = isProfitable ? '#10B981' : '#EF4444';

  return (
    <div className="w-full relative select-none">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto block"
        style={{ maxHeight: '220px' }}
      >
        <defs>
          <linearGradient id="equityGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={lineColor} stopOpacity="0.25" />
            <stop offset="100%" stopColor={lineColor} stopOpacity="0.0" />
          </linearGradient>
        </defs>

        {/* Initial Baseline Ray */}
        <line
          x1="0"
          y1={baselineY}
          x2={width}
          y2={baselineY}
          stroke="#475569"
          strokeDasharray="4 4"
          strokeWidth="0.8"
        />
        <text
          x={8}
          y={baselineY - 4}
          fill="#94A3B8"
          fontSize="9"
          fontFamily="monospace"
        >
          Baseline: ${initialBalance.toFixed(0)}
        </text>

        {/* Max / Min Labels */}
        <text
          x={width - 8}
          y={14}
          textAnchor="end"
          fill="#64748B"
          fontSize="9"
          fontFamily="monospace"
        >
          High: ${maxVal.toFixed(0)}
        </text>
        <text
          x={width - 8}
          y={height - 6}
          textAnchor="end"
          fill="#64748B"
          fontSize="9"
          fontFamily="monospace"
        >
          Low: ${minVal.toFixed(0)}
        </text>

        {/* Area fill */}
        <polygon
          points={`0,${height} ${points} ${width},${height}`}
          fill="url(#equityGradient)"
        />

        {/* Equity Line */}
        <polyline
          points={points}
          fill="none"
          stroke={lineColor}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
};
