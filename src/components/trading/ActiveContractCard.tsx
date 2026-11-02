import React from 'react';
import { Trade } from '../../types/trading';
import { Clock, ArrowUp, ArrowDown, Activity } from 'lucide-react';

interface ActiveContractCardProps {
  trade: Trade;
  currentQuote: number;
  decimals: number;
}

export const ActiveContractCard: React.FC<ActiveContractCardProps> = ({
  trade,
  currentQuote,
  decimals,
}) => {
  const isCall = trade.contractType === 'CALL';
  const isPut = trade.contractType === 'PUT';
  const isWinning =
    isCall
      ? currentQuote > trade.entryPrice
      : isPut
      ? currentQuote < trade.entryPrice
      : false;

  const progressPercent = Math.min(
    100,
    ((trade.durationTicks - trade.remainingTicks) / trade.durationTicks) * 100
  );

  return (
    <div className="p-3.5 bg-slate-900/90 border border-slate-700/80 rounded-xl space-y-3 shadow-lg relative overflow-hidden">
      {/* Top progress indicator bar */}
      <div className="absolute top-0 left-0 right-0 h-1 bg-slate-800">
        <div
          className="bg-cyan-400 h-full transition-all duration-300"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className={`flex items-center gap-1 font-bold text-xs px-2 py-0.5 rounded ${
              isCall
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                : 'bg-rose-500/20 text-rose-400 border border-rose-500/40'
            }`}
          >
            {isCall ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
            {trade.contractType}
          </span>
          <span className="font-mono text-xs text-slate-300 font-semibold">{trade.symbol}</span>
        </div>

        <div className="flex items-center gap-1.5 text-xs font-mono text-cyan-400 font-bold">
          <Clock className="w-3.5 h-3.5" />
          <span>
            {trade.remainingTicks} / {trade.durationTicks} Ticks
          </span>
        </div>
      </div>

      {/* Spot Price Metrics */}
      <div className="grid grid-cols-2 gap-2 text-xs pt-1 border-t border-slate-800/80 font-mono">
        <div>
          <span className="text-[10px] text-slate-400 block font-sans">Entry Spot</span>
          <span className="text-slate-200 font-semibold">
            {trade.entryPrice.toFixed(decimals)}
          </span>
        </div>
        <div>
          <span className="text-[10px] text-slate-400 block font-sans">Current Spot</span>
          <span
            className={`font-semibold ${
              isWinning ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            {currentQuote.toFixed(decimals)}
          </span>
        </div>
      </div>

      {/* Financials & Payout Target */}
      <div className="flex items-center justify-between pt-1 border-t border-slate-800/80 text-xs">
        <span className="text-slate-400">
          Stake: <strong className="text-slate-200 font-mono">${trade.stake}</strong>
        </span>
        <span className="text-slate-400">
          Potential Payout:{' '}
          <strong className="text-emerald-400 font-mono">
            +${(trade.potentialPayout - trade.stake).toFixed(2)}
          </strong>
        </span>
      </div>
    </div>
  );
};
