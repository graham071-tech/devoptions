import React, { useState, useMemo } from 'react';
import { analyzeLastDigits, extractLastDigit } from '../../utils/indicators';
import { Activity, Flame, Snowflake, Info, AlertCircle } from 'lucide-react';

interface LiveDigitBarProps {
  quotes: number[];
  currentQuote: number;
  decimals: number;
  symbolName: string;
  isLive?: boolean;
}

export const LiveDigitBar: React.FC<LiveDigitBarProps> = ({
  quotes,
  currentQuote,
  decimals,
  symbolName,
  isLive = true,
}) => {
  const [sampleWindow, setSampleWindow] = useState<number>(50);

  // Safely extract latest digit using documented precision
  const latestDigit = useMemo(() => {
    if (!currentQuote || isNaN(currentQuote)) return null;
    return extractLastDigit(currentQuote, decimals);
  }, [currentQuote, decimals]);

  // Compute stats across sample window
  const stats = useMemo(() => {
    return analyzeLastDigits(quotes, decimals, sampleWindow);
  }, [quotes, decimals, sampleWindow]);

  const hasTicks = quotes.length >= 2;

  return (
    <div className="bg-[#090D16] border border-slate-800 rounded-lg p-2 sm:p-2.5 space-y-1.5 select-none shrink-0">
      {/* Top Header: Latest Quote, Final Digit Accent, Sample Selector */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-1.5 border-b border-slate-800/80">
        <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-semibold text-slate-400 uppercase font-mono tracking-wider">
              Spot:
            </span>
            <span className="font-mono text-xs sm:text-sm font-bold text-slate-100 tabular-nums">
              {currentQuote > 0 ? currentQuote.toFixed(decimals) : '—'}
            </span>
          </div>

          {latestDigit !== null && (
            <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-cyan-950/80 border border-cyan-800 text-cyan-300 font-mono text-[11px] font-bold">
              <span className="text-[9px] text-slate-400 font-sans uppercase">Digit</span>
              <span className="text-xs font-black text-cyan-200">{latestDigit}</span>
            </div>
          )}
        </div>

        {/* Sample Window Filter & Analyzed Tick Count */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-400 font-mono hidden md:inline">
            Sample: <span className="text-slate-200 font-bold">{Math.min(quotes.length, sampleWindow)}</span>/{sampleWindow}
          </span>

          <div className="flex items-center gap-0.5 bg-slate-950 p-0.5 rounded border border-slate-800 text-[10px] font-mono">
            {[25, 50, 100].map((sz) => (
              <button
                key={sz}
                onClick={() => setSampleWindow(sz)}
                className={`px-2 py-0.5 rounded transition-colors cursor-pointer ${
                  sampleWindow === sz
                    ? 'bg-slate-800 text-cyan-300 font-bold border border-slate-700'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {sz} Ticks
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────
          CIRCULAR DIGIT INDICATORS (0 THROUGH 9)
      ───────────────────────────────────────────────────────────── */}
      {hasTicks ? (
        <div className="grid grid-cols-10 gap-1 sm:gap-1.5 py-0.5">
          {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((digit) => {
            const count = stats.counts[digit] || 0;
            const pct = stats.percentages[digit] || 0;
            const isLatest = digit === latestDigit;
            const isHottest = digit === stats.hottestDigit && count > 0;
            const isColdest = digit === stats.coldestDigit && count > 0;

            return (
              <div key={digit} className="flex flex-col items-center gap-0.5 text-center">
                {/* Evenly Spaced Circular Indicator */}
                <div
                  className={`relative w-7 h-7 sm:w-9 sm:h-9 md:w-10 md:h-10 rounded-full flex flex-col items-center justify-center transition-colors ${
                    isLatest
                      ? 'bg-cyan-950/70 border-2 border-cyan-400 text-cyan-200'
                      : isHottest
                      ? 'bg-slate-900 border border-amber-500/50 text-slate-200'
                      : isColdest
                      ? 'bg-slate-900/60 border border-slate-800/60 text-slate-400 opacity-60'
                      : 'bg-slate-900/90 border border-slate-800 text-slate-300'
                  }`}
                >
                  {/* Big Digit in center of circle */}
                  <span
                    className={`font-mono font-black text-xs sm:text-sm leading-none ${
                      isLatest
                        ? 'text-cyan-200'
                        : isHottest
                        ? 'text-amber-400'
                        : 'text-slate-100'
                    }`}
                  >
                    {digit}
                  </span>

                  {/* Percentage in circle */}
                  <span
                    className={`font-mono text-[7.5px] sm:text-[8.5px] mt-0.5 font-semibold leading-none ${
                      isLatest
                        ? 'text-cyan-300'
                        : isHottest
                        ? 'text-amber-300'
                        : 'text-slate-500'
                    }`}
                  >
                    {pct}%
                  </span>
                </div>

                {/* Subtext: Count */}
                <span className="font-mono text-[8.5px] text-slate-500 font-semibold leading-none">
                  {count}
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="py-8 px-4 text-center rounded-xl bg-slate-950/40 border border-slate-800/60 space-y-1.5">
          <AlertCircle className="w-5 h-5 mx-auto text-slate-500 animate-pulse" />
          <p className="text-xs font-mono text-slate-400">
            Awaiting sufficient market ticks to compute verified digit distributions...
          </p>
          <p className="text-[10px] text-slate-500">
            Indicators update automatically as live tick quotes arrive.
          </p>
        </div>
      )}

      {/* Statistical Parity & Educational Disclaimer */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-1.5 pt-1.5 border-t border-slate-800/60 text-[10px] font-mono text-slate-400">
        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-1">
            <span className="text-slate-500">Parity:</span>
            <span className="text-emerald-400 font-bold">Even {stats.evenPercent}%</span>
            <span className="text-slate-600">/</span>
            <span className="text-indigo-400 font-bold">Odd {stats.oddPercent}%</span>
          </div>

          <div className="flex items-center gap-1">
            <span className="text-slate-500">Spread:</span>
            <span className="text-cyan-400 font-bold">&le;4 ({stats.underFivePercent}%)</span>
            <span className="text-slate-600">/</span>
            <span className="text-amber-400 font-bold">&ge;5 ({stats.overFourPercent}%)</span>
          </div>
        </div>

        {/* Descriptive information note */}
        <div className="text-[9px] text-slate-500 text-center sm:text-right flex items-center gap-1">
          <Info className="w-2.5 h-2.5 shrink-0" />
          <span>Descriptive past sample data, not a prediction of future outcomes.</span>
        </div>
      </div>
    </div>
  );
};
