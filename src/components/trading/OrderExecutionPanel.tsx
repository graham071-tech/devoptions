import React, { useState } from 'react';
import { ContractType, Market, UserProfile } from '../../types/trading';
import {
  ArrowUp,
  ArrowDown,
  Clock,
  DollarSign,
  Percent,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  Sliders,
  ShieldCheck,
  Zap,
} from 'lucide-react';

interface OrderExecutionPanelProps {
  market: Market;
  currentQuote: number;
  profile: UserProfile;
  tradingMode: 'demo' | 'real';
  onPlaceTrade: (
    contractType: ContractType,
    stake: number,
    durationTicks: number,
    targetDigit?: number,
    barrier?: number
  ) => void;
  isSubmitting: boolean;
}

export const OrderExecutionPanel: React.FC<OrderExecutionPanelProps> = ({
  market,
  currentQuote,
  profile,
  tradingMode,
  onPlaceTrade,
  isSubmitting,
}) => {
  // Tabs for contract families: Rise/Fall | Digits | Touch
  const [contractFamily, setContractFamily] = useState<'rise_fall' | 'digits' | 'touch'>('rise_fall');
  const [contractType, setContractType] = useState<ContractType>('CALL');
  const [durationMode, setDurationMode] = useState<'ticks' | 'seconds'>('ticks');
  const [durationTicks, setDurationTicks] = useState<number>(5);
  const [durationSeconds, setDurationSeconds] = useState<number>(30);
  const [stake, setStake] = useState<number>(10);
  const [targetDigit, setTargetDigit] = useState<number>(5);
  const [touchOffset, setTouchOffset] = useState<number>(0.5);
  const [requireConfirmation, setRequireConfirmation] = useState<boolean>(!profile.fastExecution);
  const [pendingConfirmType, setPendingConfirmType] = useState<ContractType | null>(null);

  const availableBalance = tradingMode === 'demo' ? profile.demoBalance : profile.realBalance;

  // Calculation estimates
  const netProfit = Number((stake * market.payoutRate).toFixed(2));
  const totalPayout = Number((stake + netProfit).toFixed(2));

  // Stake steppers
  const adjustStake = (delta: number) => {
    setStake((prev) => Math.max(market.minStake, Number((prev + delta).toFixed(2))));
  };

  const setPercentBalance = (pct: number) => {
    const calc = Math.max(market.minStake, (availableBalance * pct) / 100);
    setStake(Number(calc.toFixed(0)));
  };

  // Execution trigger
  const handleTriggerOrder = (type: ContractType) => {
    if (stake <= 0) return;
    if (requireConfirmation) {
      setPendingConfirmType(type);
    } else {
      executeOrder(type);
    }
  };

  const executeOrder = (type: ContractType) => {
    const ticks = durationMode === 'ticks' ? durationTicks : Math.ceil(durationSeconds / 2);
    const barrier = contractFamily === 'touch' ? currentQuote + touchOffset : undefined;
    onPlaceTrade(type, stake, ticks, contractFamily === 'digits' ? targetDigit : undefined, barrier);
    setPendingConfirmType(null);
  };

  return (
    <div className="bg-[#090D16] border border-slate-800 rounded-xl p-4 space-y-4 shadow-xl">
      {/* Top Header with Balance Readout */}
      <div className="flex items-center justify-between pb-3 border-b border-slate-800">
        <div>
          <h3 className="font-semibold text-slate-100 text-xs uppercase tracking-wider">
            Order Execution Dock
          </h3>
          <span className="text-[10px] text-slate-400">
            {market.displayName}
          </span>
        </div>

        <div className="text-right">
          <span className="text-[10px] text-slate-500 block uppercase font-mono">
            {tradingMode} Balance
          </span>
          <span className="font-mono text-sm font-bold text-slate-100 tabular-nums">
            ${availableBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
      </div>

      {/* Contract Type Family Tabs */}
      <div className="flex bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs">
        <button
          onClick={() => {
            setContractFamily('rise_fall');
            setContractType('CALL');
          }}
          className={`flex-1 py-1.5 rounded-md font-semibold transition-colors ${
            contractFamily === 'rise_fall'
              ? 'bg-slate-800 text-slate-100 shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Rise / Fall
        </button>

        <button
          onClick={() => {
            setContractFamily('digits');
            setContractType('EVEN');
          }}
          className={`flex-1 py-1.5 rounded-md font-semibold transition-colors ${
            contractFamily === 'digits'
              ? 'bg-slate-800 text-slate-100 shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Digit Parity
        </button>

        <button
          onClick={() => {
            setContractFamily('touch');
            setContractType('TOUCH');
          }}
          className={`flex-1 py-1.5 rounded-md font-semibold transition-colors ${
            contractFamily === 'touch'
              ? 'bg-slate-800 text-slate-100 shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Touch / No Touch
        </button>
      </div>

      {/* Duration Selector */}
      <div className="space-y-1.5 text-xs">
        <div className="flex items-center justify-between">
          <label className="text-slate-400 font-medium">Duration / Expiry</label>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setDurationMode('ticks')}
              className={`text-[10px] font-mono ${
                durationMode === 'ticks' ? 'text-cyan-400 font-bold' : 'text-slate-500'
              }`}
            >
              Ticks
            </button>
            <span className="text-slate-700">|</span>
            <button
              onClick={() => setDurationMode('seconds')}
              className={`text-[10px] font-mono ${
                durationMode === 'seconds' ? 'text-cyan-400 font-bold' : 'text-slate-500'
              }`}
            >
              Seconds
            </button>
          </div>
        </div>

        {durationMode === 'ticks' ? (
          <div className="flex items-center gap-1.5">
            {[1, 2, 5, 8, 10].map((t) => (
              <button
                key={t}
                onClick={() => setDurationTicks(t)}
                className={`flex-1 py-1.5 rounded font-mono text-xs transition-colors ${
                  durationTicks === t
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/50 font-bold'
                    : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                {t}t
              </button>
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            {[15, 30, 60, 120, 300].map((s) => (
              <button
                key={s}
                onClick={() => setDurationSeconds(s)}
                className={`flex-1 py-1.5 rounded font-mono text-xs transition-colors ${
                  durationSeconds === s
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/50 font-bold'
                    : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                {s >= 60 ? `${s / 60}m` : `${s}s`}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Stake Amount Input with Steppers & Quick Chips */}
      <div className="space-y-1.5 text-xs">
        <div className="flex items-center justify-between">
          <label className="text-slate-400 font-medium">Stake Amount ($ USD)</label>
          <span className="text-[10px] text-slate-500 font-mono">
            Min: ${market.minStake} · Max: ${market.maxStake}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => adjustStake(-5)}
            className="w-8 h-9 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 font-bold flex items-center justify-center transition-colors"
          >
            -
          </button>

          <div className="relative flex-1">
            <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500 font-mono">
              $
            </span>
            <input
              type="number"
              min={market.minStake}
              max={market.maxStake}
              step="1"
              value={stake}
              onChange={(e) => setStake(Math.max(0, Number(e.target.value)))}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-7 pr-3 py-2 text-slate-100 font-mono text-sm font-bold focus:outline-none focus:border-cyan-500"
            />
          </div>

          <button
            onClick={() => adjustStake(5)}
            className="w-8 h-9 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 font-bold flex items-center justify-center transition-colors"
          >
            +
          </button>
        </div>

        {/* Quick Stake Chips */}
        <div className="flex items-center gap-1.5 pt-1">
          {[5, 10, 25, 50, 100].map((chip) => (
            <button
              key={chip}
              onClick={() => setStake(chip)}
              className="flex-1 py-1 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded text-[11px] font-mono text-slate-300 transition-colors"
            >
              ${chip}
            </button>
          ))}
        </div>

        {/* Balance % shortcuts */}
        <div className="flex items-center gap-1.5 pt-0.5">
          {[1, 2, 5, 10].map((p) => (
            <button
              key={p}
              onClick={() => setPercentBalance(p)}
              className="flex-1 py-0.5 bg-slate-950 hover:bg-slate-800 text-[10px] font-mono text-slate-400 hover:text-cyan-300 rounded transition-colors"
            >
              {p}%
            </button>
          ))}
        </div>
      </div>

      {/* Contract Family Specific Controls */}
      {contractFamily === 'digits' && (
        <div className="space-y-1.5 text-xs pt-1 border-t border-slate-800/80">
          <div className="flex items-center justify-between">
            <label className="text-slate-400 font-medium">Target Prediction Digit</label>
            <span className="font-mono text-amber-400 font-bold">{targetDigit}</span>
          </div>
          <div className="grid grid-cols-10 gap-1">
            {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
              <button
                key={d}
                onClick={() => setTargetDigit(d)}
                className={`py-1 rounded font-mono text-xs transition-colors ${
                  targetDigit === d
                    ? 'bg-amber-400 text-slate-950 font-bold'
                    : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                {d}
              </button>
            ))}
          </div>
        </div>
      )}

      {contractFamily === 'touch' && (
        <div className="space-y-1.5 text-xs pt-1 border-t border-slate-800/80">
          <div className="flex items-center justify-between">
            <label className="text-slate-400 font-medium">Barrier Offset (+/-)</label>
            <span className="font-mono text-cyan-400 font-bold">+{touchOffset}</span>
          </div>
          <input
            type="range"
            min="0.1"
            max="5.0"
            step="0.1"
            value={touchOffset}
            onChange={(e) => setTouchOffset(Number(e.target.value))}
            className="w-full accent-cyan-400 cursor-pointer"
          />
        </div>
      )}

      {/* Financials & Payout Calculations */}
      <div className="p-3 bg-slate-950 rounded-lg border border-slate-800 space-y-1.5 text-xs">
        <div className="flex items-center justify-between text-slate-400">
          <span>Broker Payout Rate:</span>
          <span className="font-mono font-bold text-emerald-400">
            {(market.payoutRate * 100).toFixed(1)}%
          </span>
        </div>
        <div className="flex items-center justify-between text-slate-400">
          <span>Potential Net Profit:</span>
          <span className="font-mono font-bold text-emerald-400">+${netProfit}</span>
        </div>
        <div className="flex items-center justify-between text-slate-400 pt-1 border-t border-slate-800/60">
          <span className="font-semibold text-slate-200">Total Return:</span>
          <span className="font-mono font-bold text-slate-100">${totalPayout}</span>
        </div>
      </div>

      {/* Main Trade Action Buttons */}
      {contractFamily === 'rise_fall' && (
        <div className="grid grid-cols-2 gap-3 pt-1">
          {/* RISE / CALL */}
          <button
            onClick={() => handleTriggerOrder('CALL')}
            disabled={isSubmitting || availableBalance < stake}
            className="py-3 px-3 bg-emerald-600 hover:bg-emerald-500 active:scale-[0.98] disabled:opacity-50 text-white font-bold rounded-xl transition-all shadow-lg shadow-emerald-950/40 flex flex-col items-center justify-center gap-1 group"
          >
            <div className="flex items-center gap-1.5 text-sm">
              <ArrowUp className="w-4 h-4 group-hover:-translate-y-0.5 transition-transform" />
              <span>RISE</span>
            </div>
            <span className="text-[10px] font-mono text-emerald-100 opacity-90">
              Higher than spot
            </span>
          </button>

          {/* FALL / PUT */}
          <button
            onClick={() => handleTriggerOrder('PUT')}
            disabled={isSubmitting || availableBalance < stake}
            className="py-3 px-3 bg-rose-600 hover:bg-rose-500 active:scale-[0.98] disabled:opacity-50 text-white font-bold rounded-xl transition-all shadow-lg shadow-rose-950/40 flex flex-col items-center justify-center gap-1 group"
          >
            <div className="flex items-center gap-1.5 text-sm">
              <ArrowDown className="w-4 h-4 group-hover:translate-y-0.5 transition-transform" />
              <span>FALL</span>
            </div>
            <span className="text-[10px] font-mono text-rose-100 opacity-90">
              Lower than spot
            </span>
          </button>
        </div>
      )}

      {contractFamily === 'digits' && (
        <div className="space-y-2 pt-1">
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => handleTriggerOrder('EVEN')}
              disabled={isSubmitting || availableBalance < stake}
              className="py-2.5 px-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg text-xs transition-colors"
            >
              DIGIT EVEN
            </button>
            <button
              onClick={() => handleTriggerOrder('ODD')}
              disabled={isSubmitting || availableBalance < stake}
              className="py-2.5 px-3 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-lg text-xs transition-colors"
            >
              DIGIT ODD
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => handleTriggerOrder('MATCHES')}
              disabled={isSubmitting || availableBalance < stake}
              className="py-2 px-3 bg-slate-800 hover:bg-slate-700 text-amber-300 font-semibold rounded-lg text-xs border border-amber-500/30 transition-colors"
            >
              MATCHES ({targetDigit})
            </button>
            <button
              onClick={() => handleTriggerOrder('DIFFERS')}
              disabled={isSubmitting || availableBalance < stake}
              className="py-2 px-3 bg-slate-800 hover:bg-slate-700 text-cyan-300 font-semibold rounded-lg text-xs border border-cyan-500/30 transition-colors"
            >
              DIFFERS ({targetDigit})
            </button>
          </div>
        </div>
      )}

      {contractFamily === 'touch' && (
        <div className="grid grid-cols-2 gap-3 pt-1">
          <button
            onClick={() => handleTriggerOrder('TOUCH')}
            disabled={isSubmitting || availableBalance < stake}
            className="py-3 px-3 bg-cyan-600 hover:bg-cyan-500 text-white font-bold rounded-xl transition-colors text-xs"
          >
            TOUCH (+{touchOffset})
          </button>
          <button
            onClick={() => handleTriggerOrder('NOTOUCH')}
            disabled={isSubmitting || availableBalance < stake}
            className="py-3 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold rounded-xl transition-colors text-xs border border-slate-700"
          >
            NO TOUCH
          </button>
        </div>
      )}

      {/* Confirmation toggle */}
      <div className="flex items-center justify-between pt-1 border-t border-slate-800 text-[11px] text-slate-400">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={requireConfirmation}
            onChange={(e) => setRequireConfirmation(e.target.checked)}
            className="rounded bg-slate-950 border-slate-700 text-cyan-500 focus:ring-0"
          />
          <span>Confirm before submit</span>
        </label>
        <span className="font-mono text-slate-500">
          Fast Exec: {requireConfirmation ? 'OFF' : 'ON'}
        </span>
      </div>

      {/* Modal Dialog for Order Confirmation */}
      {pendingConfirmType && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
          <div className="bg-[#0D1322] border border-slate-800 rounded-xl max-w-sm w-full p-5 space-y-4 shadow-2xl">
            <h3 className="font-semibold text-slate-100 text-sm">Confirm Order Submission</h3>
            <p className="text-xs text-slate-300">
              Are you sure you want to place this contract?
            </p>

            <div className="p-3 bg-slate-950 rounded-lg border border-slate-800 text-xs font-mono space-y-1.5">
              <div className="flex justify-between">
                <span className="text-slate-400">Instrument:</span>
                <span className="text-cyan-400 font-bold">{market.symbol}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Contract:</span>
                <span className="text-slate-100 font-bold">{pendingConfirmType}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Duration:</span>
                <span className="text-slate-100">{durationTicks} ticks</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Stake:</span>
                <span className="text-slate-100 font-bold">${stake}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Potential Return:</span>
                <span className="text-emerald-400 font-bold">+${netProfit}</span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setPendingConfirmType(null)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:text-slate-200"
              >
                Cancel
              </button>
              <button
                onClick={() => executeOrder(pendingConfirmType)}
                className="px-4 py-2 rounded-lg text-xs font-bold bg-cyan-400 hover:bg-cyan-300 text-slate-950"
              >
                Confirm & Place Trade
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
