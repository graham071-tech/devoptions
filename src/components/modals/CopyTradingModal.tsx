import React, { useState } from 'react';
import { CopyAllocation, CopyTrader, UserProfile } from '../../types/trading';
import { storage, VETTED_COPY_TRADERS } from '../../services/storage';
import { audioEffects } from '../../services/audioEffects';
import { useToast } from '../common/ToastNotification';
import {
  X,
  Users,
  TrendingUp,
  ShieldAlert,
  Play,
  Pause,
  Square,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Sparkles,
} from 'lucide-react';

interface CopyTradingModalProps {
  isOpen: boolean;
  onClose: () => void;
  profile: UserProfile;
  onProfileUpdate: (updated: UserProfile) => void;
}

export const CopyTradingModal: React.FC<CopyTradingModalProps> = ({
  isOpen,
  onClose,
  profile,
  onProfileUpdate,
}) => {
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<'traders' | 'active'>('traders');
  const [selectedTrader, setSelectedTrader] = useState<CopyTrader | null>(null);

  // Allocation form state
  const [allocationAmount, setAllocationAmount] = useState<number>(50);
  const [stopLossPercent, setStopLossPercent] = useState<number>(20); // 20% drawdown limit
  const [agreedTerms, setAgreedTerms] = useState<boolean>(false);

  const [allocations, setAllocations] = useState<CopyAllocation[]>(() =>
    storage.getCopyAllocations()
  );

  if (!isOpen) return null;

  const availableBalance = profile.realBalance;

  const handleStartCopying = () => {
    if (!selectedTrader) return;
    if (allocationAmount < selectedTrader.minAllocation) {
      showToast('error', 'Minimum Allocation', `Minimum copy allocation is $${selectedTrader.minAllocation}.`);
      return;
    }
    if (allocationAmount > availableBalance) {
      showToast('error', 'Insufficient Funds', `Available real balance is $${availableBalance.toFixed(2)}.`);
      return;
    }
    if (!agreedTerms) {
      showToast('error', 'Terms Required', 'Please acknowledge the copy trading risk disclosure.');
      return;
    }

    const stopLossAmount = Number(((allocationAmount * stopLossPercent) / 100).toFixed(2));

    const newAllocation: CopyAllocation = {
      traderId: selectedTrader.id,
      allocatedAmount: allocationAmount,
      stopLossAmount,
      isPaused: false,
      startedAt: Date.now(),
      copiedTradesCount: 0,
      profitEarned: 0,
    };

    const updated = storage.saveCopyAllocation(newAllocation);
    setAllocations(updated);

    audioEffects.playTradePlaced();
    showToast('success', 'Copy Trading Active', `Now copying ${selectedTrader.name} with $${allocationAmount} allocation.`);
    setSelectedTrader(null);
    setActiveTab('active');
  };

  const handleTogglePause = (traderId: string) => {
    const target = allocations.find((a) => a.traderId === traderId);
    if (!target) return;
    const updated = { ...target, isPaused: !target.isPaused };
    const all = storage.saveCopyAllocation(updated);
    setAllocations(all);
    showToast('info', updated.isPaused ? 'Copying Paused' : 'Copying Resumed', `${target.traderId} status updated.`);
  };

  const handleStopCopying = (traderId: string) => {
    if (confirm('Stop copying this trader and return allocated capital to available balance?')) {
      const all = storage.removeCopyAllocation(traderId);
      setAllocations(all);
      showToast('info', 'Copying Stopped', 'Allocated funds returned to available balance.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm select-none">
      <div className="bg-[#0D1322] border border-slate-800 rounded-2xl max-w-2xl w-full shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-cyan-400" />
            <div>
              <h3 className="font-bold text-slate-100 text-sm">Copy Trading Hub</h3>
              <p className="text-[11px] text-slate-400">
                Automatically mirror vetted strategies with customizable loss protection
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 p-1 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Sub Navigation Tabs */}
        <div className="flex px-5 pt-3 border-b border-slate-800 gap-4 text-xs font-semibold">
          <button
            onClick={() => {
              setActiveTab('traders');
              setSelectedTrader(null);
            }}
            className={`pb-2.5 transition-colors relative ${
              activeTab === 'traders' && !selectedTrader
                ? 'text-cyan-400 border-b-2 border-cyan-400'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Verified Strategy Providers
          </button>

          <button
            onClick={() => setActiveTab('active')}
            className={`pb-2.5 transition-colors relative flex items-center gap-1.5 ${
              activeTab === 'active'
                ? 'text-cyan-400 border-b-2 border-cyan-400'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <span>My Active Copying</span>
            {allocations.length > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-cyan-500/20 text-cyan-300 font-mono">
                {allocations.length}
              </span>
            )}
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          {/* View 1: Allocation Setup Form */}
          {selectedTrader ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between p-3.5 bg-slate-900 rounded-xl border border-slate-800">
                <div>
                  <h4 className="font-bold text-slate-100 text-sm">{selectedTrader.name}</h4>
                  <span className="text-xs font-mono text-cyan-400">{selectedTrader.handle}</span>
                </div>
                <div className="text-right font-mono">
                  <span className="text-emerald-400 font-bold text-sm block">
                    +{selectedTrader.return30d}% ROI
                  </span>
                  <span className="text-[10px] text-slate-500">
                    {selectedTrader.winRate}% Win Rate
                  </span>
                </div>
              </div>

              {/* Allocation Amount */}
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <label className="text-slate-300 font-medium">Allocation Amount ($ USD)</label>
                  <span className="text-slate-400 font-mono">
                    Available: ${availableBalance.toFixed(2)}
                  </span>
                </div>
                <input
                  type="number"
                  min={selectedTrader.minAllocation}
                  max={availableBalance}
                  value={allocationAmount}
                  onChange={(e) => setAllocationAmount(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 font-mono text-sm font-bold focus:outline-none focus:border-cyan-500"
                />
                <span className="text-[11px] text-slate-500 font-mono">
                  Min allocation for this provider: ${selectedTrader.minAllocation}.00
                </span>
              </div>

              {/* Hard Stop Loss limit */}
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <label className="text-slate-300 font-medium">Auto-Stop Drawdown Guard (%)</label>
                  <span className="text-rose-400 font-mono font-bold">
                    Stop at -${((allocationAmount * stopLossPercent) / 100).toFixed(2)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {[10, 20, 30, 40].map((pct) => (
                    <button
                      key={pct}
                      onClick={() => setStopLossPercent(pct)}
                      className={`flex-1 py-1.5 rounded-lg border font-mono text-xs transition-colors ${
                        stopLossPercent === pct
                          ? 'bg-rose-500/20 border-rose-500/40 text-rose-300 font-bold'
                          : 'bg-slate-900 border-slate-800 text-slate-400'
                      }`}
                    >
                      {pct}%
                    </button>
                  ))}
                </div>
              </div>

              {/* Terms Checkbox */}
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-xs space-y-2">
                <label className="flex items-start gap-2 text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={agreedTerms}
                    onChange={(e) => setAgreedTerms(e.target.checked)}
                    className="mt-0.5 rounded bg-slate-900 border-slate-700 text-cyan-500 focus:ring-0"
                  />
                  <span className="text-[11px] text-slate-400 leading-relaxed">
                    I acknowledge that copy trading involves market risk. The provider’s past performance does not guarantee future results, and my allocation will be automatically halted if my selected stop-loss limit is hit.
                  </span>
                </label>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  onClick={() => setSelectedTrader(null)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-slate-200"
                >
                  Back to List
                </button>
                <button
                  onClick={handleStartCopying}
                  className="px-5 py-2.5 rounded-xl text-xs font-bold bg-cyan-400 hover:bg-cyan-300 text-slate-950 flex items-center gap-1.5 shadow-lg shadow-cyan-950/40"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>Confirm & Start Copying</span>
                </button>
              </div>
            </div>
          ) : activeTab === 'traders' ? (
            /* View 2: Traders Directory */
            <div className="space-y-3">
              {VETTED_COPY_TRADERS.map((trader) => (
                <div
                  key={trader.id}
                  className="p-4 bg-slate-900/60 hover:bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-xl transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div className="space-y-1.5 flex-1">
                    <div className="flex items-center gap-2">
                      <h4 className="font-bold text-slate-100 text-sm">{trader.name}</h4>
                      <span className="text-xs font-mono text-cyan-400">{trader.handle}</span>
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-400 font-mono font-bold">
                        {trader.riskScore} Risk
                      </span>
                    </div>

                    <p className="text-xs text-slate-400 leading-relaxed">{trader.bio}</p>

                    <div className="flex items-center gap-4 text-xs font-mono text-slate-400 pt-1">
                      <span>Market: <strong className="text-slate-200">{trader.preferredMarket}</strong></span>
                      <span>Copiers: <strong className="text-slate-200">{trader.copiersCount.toLocaleString()}</strong></span>
                    </div>
                  </div>

                  <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center shrink-0 border-t sm:border-t-0 pt-2 sm:pt-0 border-slate-800">
                    <div className="text-left sm:text-right font-mono">
                      <span className="text-emerald-400 font-bold text-base block">
                        +{trader.return30d}%
                      </span>
                      <span className="text-[10px] text-slate-500">
                        {trader.winRate}% Win Rate (30d)
                      </span>
                    </div>

                    <button
                      onClick={() => {
                        setSelectedTrader(trader);
                        setAllocationAmount(trader.minAllocation);
                      }}
                      className="mt-2 px-4 py-1.5 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold rounded-lg text-xs transition-colors flex items-center gap-1"
                    >
                      <span>Copy</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            /* View 3: Active Copying Tab */
            <div className="space-y-3">
              {allocations.length > 0 ? (
                allocations.map((alloc) => {
                  const trader = VETTED_COPY_TRADERS.find((t) => t.id === alloc.traderId);
                  return (
                    <div
                      key={alloc.traderId}
                      className="p-4 bg-slate-900/80 rounded-xl border border-slate-800 space-y-3"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className="font-bold text-slate-100 text-sm">
                              {trader?.name || alloc.traderId}
                            </h4>
                            <span
                              className={`text-[10px] px-2 py-0.5 rounded font-mono font-bold uppercase ${
                                alloc.isPaused
                                  ? 'bg-amber-500/10 text-amber-400'
                                  : 'bg-emerald-500/10 text-emerald-400'
                              }`}
                            >
                              {alloc.isPaused ? 'Paused' : 'Active Mirroring'}
                            </span>
                          </div>
                          <span className="text-xs font-mono text-slate-400">
                            Active since {new Date(alloc.startedAt).toLocaleDateString()}
                          </span>
                        </div>

                        <div className="text-right font-mono">
                          <span className="text-xs text-slate-400 block font-sans">
                            Allocated Capital
                          </span>
                          <span className="text-base font-bold text-slate-100">
                            ${alloc.allocatedAmount}.00 USD
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-2 border-t border-slate-800 text-xs">
                        <div className="font-mono text-slate-400">
                          Stop-Loss: <strong className="text-rose-400">-${alloc.stopLossAmount}</strong>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleTogglePause(alloc.traderId)}
                            className="px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium transition-colors"
                          >
                            {alloc.isPaused ? 'Resume' : 'Pause'}
                          </button>

                          <button
                            onClick={() => handleStopCopying(alloc.traderId)}
                            className="px-3 py-1 bg-rose-950/40 hover:bg-rose-950 border border-rose-500/30 text-rose-300 rounded-lg text-xs font-medium transition-colors"
                          >
                            Stop & Unallocate
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="py-12 text-center text-slate-500 text-xs font-mono space-y-2">
                  <p>You have no active copy trading allocations.</p>
                  <button
                    onClick={() => setActiveTab('traders')}
                    className="text-cyan-400 hover:text-cyan-300 font-semibold underline text-xs font-sans"
                  >
                    Browse verified strategy providers
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer Disclaimer */}
        <div className="px-5 py-3 bg-slate-950/60 border-t border-slate-800 text-[11px] text-slate-500 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span>Copy trading carries financial risk. Past results do not guarantee future returns.</span>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 text-xs font-medium"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
