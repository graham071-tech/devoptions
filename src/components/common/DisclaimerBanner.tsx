import React from 'react';
import { AlertTriangle } from 'lucide-react';

interface DisclaimerBannerProps {
  compact?: boolean;
}

export const DisclaimerBanner: React.FC<DisclaimerBannerProps> = ({ compact = false }) => {
  if (compact) {
    return (
      <div className="flex items-center gap-2 py-1 px-3 bg-amber-950/20 border border-amber-500/20 rounded text-[11px] text-amber-300/80">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-400" />
        <span className="truncate">
          Risk Notice: Synthetic indices carry high volatility. Past performance and statistical indicators do not guarantee future returns.
        </span>
      </div>
    );
  }

  return (
    <div className="p-3.5 bg-slate-900/60 border border-amber-500/20 rounded-lg text-xs text-slate-300 flex items-start gap-3">
      <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400 mt-0.5" />
      <div className="space-y-1">
        <p className="font-medium text-amber-300 text-xs">
          Regulatory Risk & Statistical Disclosure
        </p>
        <p className="text-slate-400 text-[11px] leading-relaxed">
          Binary options and synthetic index contracts are speculative financial instruments with a high level of risk. Historical digit frequencies, technical indicator crossovers, and backtest equity curves are computed strictly for analysis and simulation purposes and do not guarantee future outcomes. Real trading involves the risk of capital loss. Always practice in Demo Mode first.
        </p>
      </div>
    </div>
  );
};
