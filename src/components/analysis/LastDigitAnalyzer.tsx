import React, { useState, useMemo } from 'react';
import { analyzeLastDigits } from '../../utils/indicators';
import { Flame, Snowflake, RotateCcw, Info } from 'lucide-react';

interface LastDigitAnalyzerProps {
  quotes: number[];
  decimals: number;
  symbolName: string;
}

export const LastDigitAnalyzer: React.FC<LastDigitAnalyzerProps> = ({
  quotes,
  decimals,
  symbolName,
}) => {
  const [sampleSize, setSampleSize] = useState<number>(100);

  const stats = useMemo(() => {
    return analyzeLastDigits(quotes, decimals, sampleSize);
  }, [quotes, decimals, sampleSize]);

  return (
    <div className="bg-[#090D16] border border-slate-800 rounded-xl p-4 space-y-4">
      {/* Top Header & Sample Selector */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-slate-100 text-sm">
              Last-Digit Statistical Frequency Analyzer
            </h3>
            <span className="text-xs font-mono text-cyan-400">({symbolName})</span>
          </div>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Real-time terminal distribution of terminal digit (0–9) across historical ticks
          </p>
        </div>

        {/* Sample Size Filter */}
        <div className="flex items-center gap-1.5 text-xs">
          <span className="text-slate-400 font-medium mr-1">Sample:</span>
          {[50, 100, 200, 500].map((size) => (
            <button
              key={size}
              onClick={() => setSampleSize(size)}
              className={`px-2.5 py-1 rounded text-[11px] font-mono transition-colors ${
                sampleSize === size
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-bold'
                  : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              {size}
            </button>
          ))}
        </div>
      </div>

      {/* Summary KPI Badges */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {/* Hottest Digit */}
        <div className="p-3 bg-slate-900/60 rounded-lg border border-slate-800 flex items-center justify-between">
          <div>
            <span className="text-[11px] text-slate-400">Hottest Digit</span>
            <div className="flex items-center gap-2 mt-1">
              <span className="font-mono text-xl font-bold text-amber-400">
                {stats.hottestDigit}
              </span>
              <span className="text-xs font-mono text-slate-400">
                ({stats.percentages[stats.hottestDigit]}%)
              </span>
            </div>
          </div>
          <Flame className="w-5 h-5 text-amber-400 shrink-0" />
        </div>

        {/* Coldest Digit */}
        <div className="p-3 bg-slate-900/60 rounded-lg border border-slate-800 flex items-center justify-between">
          <div>
            <span className="text-[11px] text-slate-400">Coldest Digit</span>
            <div className="flex items-center gap-2 mt-1">
              <span className="font-mono text-xl font-bold text-cyan-400">
                {stats.coldestDigit}
              </span>
              <span className="text-xs font-mono text-slate-400">
                ({stats.percentages[stats.coldestDigit]}%)
              </span>
            </div>
          </div>
          <Snowflake className="w-5 h-5 text-cyan-400 shrink-0" />
        </div>

        {/* Even vs Odd */}
        <div className="p-3 bg-slate-900/60 rounded-lg border border-slate-800">
          <span className="text-[11px] text-slate-400">Even / Odd Parity</span>
          <div className="flex items-center gap-2 mt-1 font-mono text-xs">
            <span className="text-emerald-400 font-bold">Even: {stats.evenPercent}%</span>
            <span className="text-slate-600">|</span>
            <span className="text-indigo-400 font-bold">Odd: {stats.oddPercent}%</span>
          </div>
          {/* Parity Bar */}
          <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden flex mt-2">
            <div
              className="bg-emerald-500 h-full transition-all duration-300"
              style={{ width: `${stats.evenPercent}%` }}
            />
            <div
              className="bg-indigo-500 h-full transition-all duration-300"
              style={{ width: `${stats.oddPercent}%` }}
            />
          </div>
        </div>

        {/* Under 5 vs Over 4 */}
        <div className="p-3 bg-slate-900/60 rounded-lg border border-slate-800">
          <span className="text-[11px] text-slate-400">Range (Under / Over)</span>
          <div className="flex items-center gap-2 mt-1 font-mono text-xs">
            <span className="text-sky-400 font-bold">0–4: {stats.underFivePercent}%</span>
            <span className="text-slate-600">|</span>
            <span className="text-purple-400 font-bold">5–9: {stats.overFourPercent}%</span>
          </div>
          {/* Range Bar */}
          <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden flex mt-2">
            <div
              className="bg-sky-500 h-full transition-all duration-300"
              style={{ width: `${stats.underFivePercent}%` }}
            />
            <div
              className="bg-purple-500 h-full transition-all duration-300"
              style={{ width: `${stats.overFourPercent}%` }}
            />
          </div>
        </div>
      </div>

      {/* Digit Distribution Frequency Graph */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span>Frequency Spectrum by Digit (0 to 9)</span>
          <span className="font-mono text-[11px]">Baseline Expected: ~10.0%</span>
        </div>

        <div className="grid grid-cols-10 gap-1.5 sm:gap-2">
          {stats.counts.map((count, digit) => {
            const pct = stats.percentages[digit];
            const isHot = digit === stats.hottestDigit;
            const isCold = digit === stats.coldestDigit;
            const maxPct = Math.max(...stats.percentages, 15);
            const heightPercent = Math.min(100, (pct / maxPct) * 100);

            return (
              <div
                key={digit}
                className="flex flex-col items-center justify-end p-2 rounded-lg bg-slate-900/80 border border-slate-800/80 hover:border-slate-700 transition-colors"
              >
                <span className="font-mono text-[10px] text-slate-400 mb-1">{pct}%</span>
                <div className="w-full bg-slate-950 rounded h-24 flex items-end overflow-hidden p-0.5">
                  <div
                    className={`w-full rounded transition-all duration-300 ${
                      isHot
                        ? 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.3)]'
                        : isCold
                        ? 'bg-cyan-500/50'
                        : digit % 2 === 0
                        ? 'bg-emerald-500/70'
                        : 'bg-indigo-500/70'
                    }`}
                    style={{ height: `${heightPercent}%` }}
                  />
                </div>
                <div className="mt-2 flex items-center justify-center">
                  <span
                    className={`w-6 h-6 rounded flex items-center justify-center font-mono text-xs font-bold ${
                      isHot
                        ? 'bg-amber-400 text-slate-950'
                        : isCold
                        ? 'bg-cyan-900/60 text-cyan-300'
                        : 'text-slate-200'
                    }`}
                  >
                    {digit}
                  </span>
                </div>
                <span className="font-mono text-[9px] text-slate-500 mt-0.5">{count}x</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Live Digit Tape Strip */}
      <div className="space-y-1.5 pt-1">
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span>Live Last-Digit Stream (Last 30 Ticks)</span>
          {stats.repeatStreak && (
            <span className="text-amber-400 font-semibold text-[11px] animate-pulse">
              Repeated Streak: Digit {stats.repeatStreak.digit} x {stats.repeatStreak.count}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 overflow-x-auto py-2 px-1 scrollbar-thin">
          {stats.recentDigits.map((digit, idx) => (
            <span
              key={idx}
              className={`shrink-0 w-7 h-7 rounded flex items-center justify-center font-mono text-xs font-bold transition-transform ${
                idx === stats.recentDigits.length - 1
                  ? 'ring-2 ring-cyan-400 scale-105 bg-cyan-500 text-slate-950'
                  : digit % 2 === 0
                  ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-500/30'
                  : 'bg-indigo-950/60 text-indigo-300 border border-indigo-500/30'
              }`}
            >
              {digit}
            </span>
          ))}
        </div>
      </div>

      {/* Regulatory Math Disclaimer */}
      <div className="flex items-start gap-2 p-2.5 bg-slate-950/60 rounded-md border border-slate-800/60 text-[11px] text-slate-400">
        <Info className="w-3.5 h-3.5 shrink-0 text-cyan-400 mt-0.5" />
        <p>
          Synthetic random digit generation operates on independent trials. While historical imbalances and streaks can be observed, each upcoming tick has an independent theoretical uniform probability ($\approx 10\%$).
        </p>
      </div>
    </div>
  );
};
