import React, { useMemo } from 'react';
import { ShieldAlert, TrendingUp } from 'lucide-react';

interface MonteCarloSimulationProps {
  paths: number[][];
  initialBalance: number;
}

export const MonteCarloSimulation: React.FC<MonteCarloSimulationProps> = ({
  paths,
  initialBalance,
}) => {
  const { pathSvgs, medianEnd, p95End, p5End, riskOfRuinPct, maxVal, minVal } = useMemo(() => {
    if (!paths || paths.length === 0) {
      return {
        pathSvgs: [],
        medianEnd: initialBalance,
        p95End: initialBalance,
        p5End: initialBalance,
        riskOfRuinPct: 0,
        maxVal: initialBalance * 2,
        minVal: 0,
      };
    }

    const width = 640;
    const height = 180;
    const numSteps = paths[0].length;

    let overallMin = initialBalance;
    let overallMax = initialBalance;
    let ruinedCount = 0;

    const finalBalances: number[] = [];

    paths.forEach((p) => {
      const end = p[p.length - 1];
      finalBalances.push(end);
      if (end <= initialBalance * 0.2) ruinedCount++;

      p.forEach((v) => {
        if (v < overallMin) overallMin = v;
        if (v > overallMax) overallMax = v;
      });
    });

    finalBalances.sort((a, b) => a - b);
    const p5 = finalBalances[Math.floor(finalBalances.length * 0.05)];
    const median = finalBalances[Math.floor(finalBalances.length * 0.5)];
    const p95 = finalBalances[Math.floor(finalBalances.length * 0.95)];

    const r = overallMax - overallMin || 1;
    const getY = (val: number) => height - ((val - overallMin) / r) * height;

    // Render sample of 40 paths for performance
    const sampled = paths.filter((_, idx) => idx % Math.ceil(paths.length / 40) === 0);

    const svgs = sampled.map((p) => {
      return p
        .map((v, i) => {
          const x = (i / (numSteps - 1)) * width;
          const y = getY(v);
          return `${x},${y}`;
        })
        .join(' ');
    });

    return {
      pathSvgs: svgs,
      medianEnd: median,
      p95End: p95,
      p5End: p5,
      riskOfRuinPct: Number(((ruinedCount / paths.length) * 100).toFixed(1)),
      maxVal: overallMax,
      minVal: overallMin,
    };
  }, [paths, initialBalance]);

  if (!paths || paths.length === 0) return null;

  return (
    <div className="bg-[#090D16] border border-slate-800 rounded-xl p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-2 border-b border-slate-800">
        <div>
          <h4 className="font-semibold text-slate-100 text-xs">
            Monte Carlo Multi-Path Stress Simulation (200 Iterations)
          </h4>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Evaluates sequence-of-returns volatility under randomized streak distributions
          </p>
        </div>

        {/* Risk of Ruin pill */}
        <div
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-mono font-semibold border ${
            riskOfRuinPct > 15
              ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
              : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
          }`}
        >
          <ShieldAlert className="w-3.5 h-3.5" />
          <span>Risk of Ruin: {riskOfRuinPct}%</span>
        </div>
      </div>

      {/* SVG Canvas for paths */}
      <div className="relative select-none">
        <svg
          viewBox="0 0 640 180"
          className="w-full h-auto block"
          style={{ maxHeight: '180px' }}
        >
          {pathSvgs.map((pts, i) => (
            <polyline
              key={i}
              points={pts}
              fill="none"
              stroke="#06B6D4"
              strokeWidth="0.8"
              opacity="0.18"
            />
          ))}

          {/* Baseline Initial */}
          <line
            x1="0"
            y1={180 - ((initialBalance - minVal) / (maxVal - minVal || 1)) * 180}
            x2="640"
            y2={180 - ((initialBalance - minVal) / (maxVal - minVal || 1)) * 180}
            stroke="#94A3B8"
            strokeDasharray="3 3"
            strokeWidth="0.8"
          />
        </svg>
      </div>

      {/* Percentiles Outcome Grid */}
      <div className="grid grid-cols-3 gap-2 text-xs pt-1 border-t border-slate-800/80">
        <div className="p-2 bg-slate-900/60 rounded border border-slate-800">
          <span className="text-[10px] text-slate-400 block">5th Percentile (Adverse)</span>
          <span className="font-mono text-rose-400 font-bold mt-0.5 block">
            ${p5End.toFixed(0)}
          </span>
        </div>
        <div className="p-2 bg-slate-900/60 rounded border border-slate-800">
          <span className="text-[10px] text-slate-400 block">50th Percentile (Median)</span>
          <span className="font-mono text-cyan-400 font-bold mt-0.5 block">
            ${medianEnd.toFixed(0)}
          </span>
        </div>
        <div className="p-2 bg-slate-900/60 rounded border border-slate-800">
          <span className="text-[10px] text-slate-400 block">95th Percentile (Favorable)</span>
          <span className="font-mono text-emerald-400 font-bold mt-0.5 block">
            ${p95End.toFixed(0)}
          </span>
        </div>
      </div>
    </div>
  );
};
