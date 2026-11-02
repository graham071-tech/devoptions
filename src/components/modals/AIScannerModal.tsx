import React, { useState } from 'react';
import { ContractType, Market } from '../../types/trading';
import { marketScanner, MarketScanResult } from '../../services/marketScanner';
import { BotConfig } from '../trading/SimpleBotPanel';
import { useToast } from '../common/ToastNotification';
import {
  X,
  Sparkles,
  Bot,
  Layers,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  Sliders,
  ShieldAlert,
  Play,
  RotateCcw,
  Activity,
  Info,
} from 'lucide-react';

interface AIScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectMarket: (market: Market) => void;
  onPrepareBotConfig: (config: BotConfig, market: Market) => void;
  currentMarket: Market;
  tradingMode: 'demo' | 'real';
  availableBalance: number;
  initialOption?: 'scan' | 'trade_for_me';
}

export const AIScannerModal: React.FC<AIScannerModalProps> = ({
  isOpen,
  onClose,
  onSelectMarket,
  onPrepareBotConfig,
  currentMarket,
  tradingMode,
  availableBalance,
  initialOption = 'scan',
}) => {
  const { showToast } = useToast();

  const [activeOption, setActiveOption] = useState<'scan' | 'trade_for_me'>(initialOption);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [scanResults, setScanResults] = useState<MarketScanResult[]>([]);
  const [selectedResult, setSelectedResult] = useState<MarketScanResult | null>(null);

  // Review & Confirmation Screen State for "SCAN & TRADE FOR ME"
  const [showReviewScreen, setShowReviewScreen] = useState<boolean>(false);
  const [reviewStake, setReviewStake] = useState<number>(5);
  const [reviewTargetProfit, setReviewTargetProfit] = useState<number>(20);
  const [reviewMaxLoss, setReviewMaxLoss] = useState<number>(15);
  const [reviewContractType, setReviewContractType] = useState<ContractType>('CALL');
  const [reviewDurationTicks, setReviewDurationTicks] = useState<number>(5);

  React.useEffect(() => {
    if (isOpen) {
      const opt = initialOption || 'scan';
      setActiveOption(opt);
      setShowReviewScreen(false);
      handleRunScan(opt);
    }
  }, [isOpen, initialOption]);

  if (!isOpen) return null;

  const handleRunScan = async (option: 'scan' | 'trade_for_me') => {
    setIsScanning(true);
    setScanResults([]);
    setSelectedResult(null);

    try {
      const results = await marketScanner.scanMarkets();
      setIsScanning(false);

      if (results.length === 0) {
        showToast('error', 'Scanner Result', 'No active market data available. Please retry.');
        return;
      }

      setScanResults(results);
      const topChoice = results[0];
      setSelectedResult(topChoice);

      if (option === 'scan') {
        // Automatically load market and show options
        onSelectMarket(topChoice.market);
        showToast(
          'success',
          `Market Loaded: ${topChoice.market.displayName}`,
          `Score: ${topChoice.score}/100 • ${topChoice.volatilityRating} Volatility`
        );
      } else {
        // "SCAN & TRADE FOR ME": Auto-load market and show Review Screen
        onSelectMarket(topChoice.market);
        // Pre-configure recommended parameters based on market
        setReviewStake(Math.max(5, topChoice.market.minStake || 1));
        setReviewContractType('CALL');
        setReviewDurationTicks(5);
        setReviewTargetProfit(20);
        setReviewMaxLoss(15);
        setShowReviewScreen(true);
      }
    } catch (e) {
      setIsScanning(false);
      showToast('error', 'Scan Error', 'Unable to complete market evaluation.');
    }
  };

  const handleConfirmAndStartBot = () => {
    if (!selectedResult) return;

    if (reviewStake > availableBalance) {
      showToast('error', 'Insufficient Funds', `Stake ($${reviewStake}) exceeds available balance ($${availableBalance.toFixed(2)}).`);
      return;
    }

    const config: BotConfig = {
      targetProfit: reviewTargetProfit,
      maxLoss: reviewMaxLoss,
      stake: reviewStake,
      contractType: reviewContractType,
      durationTicks: reviewDurationTicks,
    };

    onPrepareBotConfig(config, selectedResult.market);
    onClose();
    setShowReviewScreen(false);
    showToast(
      'success',
      'Bot Configured & Started',
      `Target: +$${reviewTargetProfit} | Loss Limit: -$${reviewMaxLoss}`
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-[#090D16] border border-slate-800 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/60">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100">DevOptions AI Scanner</h2>
              <p className="text-[11px] text-slate-400">
                Quantitative market scanning & automated strategy configuration
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-100 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto space-y-5 text-xs">
          {/* If on Review Screen for "SCAN & TRADE FOR ME", show settings review */}
          {showReviewScreen && selectedResult ? (
            <div className="space-y-4 animate-in fade-in duration-150">
              <div className="p-3.5 rounded-xl bg-cyan-950/30 border border-cyan-500/40 text-slate-200 space-y-1">
                <div className="flex items-center justify-between font-bold text-sm text-cyan-300">
                  <span>Strategy Configuration Review</span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-200 uppercase">
                    Explicit Confirmation Required
                  </span>
                </div>
                <p className="text-[11px] text-slate-300">
                  Review the parameters below before starting the automated bot. Live trades will not begin until you click "Start Bot".
                </p>
              </div>

              {/* Parameter Settings Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-3 bg-slate-900/60 rounded-xl border border-slate-800 space-y-1">
                  <span className="text-[10px] text-slate-400 uppercase font-mono">
                    Selected Market
                  </span>
                  <div className="text-sm font-bold text-slate-100">
                    {selectedResult.market.displayName}
                  </div>
                  <span className="text-[10px] text-cyan-400 font-mono">
                    Score: {selectedResult.score}/100 • {selectedResult.volatilityRating} Volatility
                  </span>
                </div>

                <div className="p-3 bg-slate-900/60 rounded-xl border border-slate-800 space-y-1">
                  <span className="text-[10px] text-slate-400 uppercase font-mono">
                    Account Mode
                  </span>
                  <div className="text-sm font-bold text-slate-100 capitalize">
                    {tradingMode} Account
                  </div>
                  <span className="text-[10px] text-slate-400 font-mono">
                    Available: ${availableBalance.toFixed(2)}
                  </span>
                </div>

                <div className="p-3 bg-slate-900/60 rounded-xl border border-slate-800 space-y-1.5">
                  <label className="text-[10px] text-slate-400 uppercase font-mono block">
                    Stake Amount ($)
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={reviewStake}
                    onChange={(e) => setReviewStake(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-slate-100 font-mono font-bold text-xs focus:border-cyan-500 focus:outline-none"
                  />
                </div>

                <div className="p-3 bg-slate-900/60 rounded-xl border border-slate-800 space-y-1.5">
                  <label className="text-[10px] text-slate-400 uppercase font-mono block">
                    Contract Type
                  </label>
                  <select
                    value={reviewContractType}
                    onChange={(e) => setReviewContractType(e.target.value as ContractType)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-slate-100 font-mono text-xs focus:border-cyan-500 focus:outline-none"
                  >
                    <option value="CALL">Rise (Higher)</option>
                    <option value="PUT">Fall (Lower)</option>
                    <option value="EVEN">Digit Even</option>
                    <option value="ODD">Digit Odd</option>
                  </select>
                </div>

                <div className="p-3 bg-slate-900/60 rounded-xl border border-slate-800 space-y-1.5">
                  <label className="text-[10px] text-emerald-400 uppercase font-mono block">
                    Target Profit Limit ($)
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={reviewTargetProfit}
                    onChange={(e) => setReviewTargetProfit(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-emerald-300 font-mono font-bold text-xs focus:border-emerald-500 focus:outline-none"
                  />
                </div>

                <div className="p-3 bg-slate-900/60 rounded-xl border border-slate-800 space-y-1.5">
                  <label className="text-[10px] text-rose-400 uppercase font-mono block">
                    Max Loss Limit ($)
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={reviewMaxLoss}
                    onChange={(e) => setReviewMaxLoss(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1.5 text-rose-300 font-mono font-bold text-xs focus:border-rose-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* Risk Notice */}
              <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 text-[11px] text-slate-400 flex items-start gap-2">
                <Info className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                <p>
                  The bot executes trades automatically one by one. It halts immediately when your target profit or maximum loss limit is reached. No martingale or stake scaling is permitted.
                </p>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-between pt-2">
                <button
                  onClick={() => setShowReviewScreen(false)}
                  className="px-4 py-2 rounded-xl text-slate-400 hover:text-slate-200 transition-colors"
                >
                  Back to Scanner
                </button>

                <button
                  onClick={handleConfirmAndStartBot}
                  className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs transition-colors shadow-lg shadow-emerald-950/40"
                >
                  <Play className="w-3.5 h-3.5 fill-slate-950" />
                  <span>Start Bot with These Settings</span>
                </button>
              </div>
            </div>
          ) : (
            /* Option Chooser: SCAN MARKET vs SCAN & TRADE FOR ME */
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                {/* 1. SCAN MARKET Option Card */}
                <div
                  onClick={() => setActiveOption('scan')}
                  className={`p-4 rounded-xl border cursor-pointer transition-all ${
                    activeOption === 'scan'
                      ? 'bg-cyan-950/30 border-cyan-400 shadow-md shadow-cyan-900/20'
                      : 'bg-slate-900/50 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between pb-2">
                    <span className="font-bold text-slate-100 text-sm flex items-center gap-1.5">
                      <Sparkles className="w-4 h-4 text-cyan-400" />
                      <span>SCAN MARKET</span>
                    </span>
                    <span
                      className={`w-3.5 h-3.5 rounded-full border-2 ${
                        activeOption === 'scan'
                          ? 'border-cyan-400 bg-cyan-400'
                          : 'border-slate-600'
                      }`}
                    />
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Evaluates live tick streams across synthetic markets. Identifies the optimal instrument and automatically loads it to your chart without altering bot settings.
                  </p>
                </div>

                {/* 2. SCAN & TRADE FOR ME Option Card */}
                <div
                  onClick={() => setActiveOption('trade_for_me')}
                  className={`p-4 rounded-xl border cursor-pointer transition-all ${
                    activeOption === 'trade_for_me'
                      ? 'bg-purple-950/30 border-purple-400 shadow-md shadow-purple-900/20'
                      : 'bg-slate-900/50 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between pb-2">
                    <span className="font-bold text-slate-100 text-sm flex items-center gap-1.5">
                      <Bot className="w-4 h-4 text-purple-400" />
                      <span>SCAN & TRADE FOR ME</span>
                    </span>
                    <span
                      className={`w-3.5 h-3.5 rounded-full border-2 ${
                        activeOption === 'trade_for_me'
                          ? 'border-purple-400 bg-purple-400'
                          : 'border-slate-600'
                      }`}
                    />
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Selects the best market and prepares a complete automated trading strategy for you. Presents a review panel for your explicit confirmation before any trade is made.
                  </p>
                </div>
              </div>

              {/* Action Trigger Button */}
              <div className="text-center pt-2">
                <button
                  onClick={() => handleRunScan(activeOption)}
                  disabled={isScanning}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-emerald-400 hover:from-cyan-400 hover:to-emerald-300 text-slate-950 font-bold text-xs tracking-wider uppercase transition-all shadow-lg shadow-cyan-900/30 disabled:opacity-50"
                >
                  <Sparkles className={`w-4 h-4 ${isScanning ? 'animate-spin' : ''}`} />
                  <span>
                    {isScanning
                      ? 'Scanning Markets...'
                      : activeOption === 'scan'
                      ? 'Run Market Scan'
                      : 'Scan & Prepare Configuration'}
                  </span>
                </button>
              </div>

              {/* Results Display */}
              {scanResults.length > 0 && (
                <div className="space-y-3 pt-3 border-t border-slate-800">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-slate-400 text-[11px] uppercase font-bold">
                      Scored Market Candidates ({scanResults.length})
                    </span>
                    <span className="text-[10px] text-slate-500 font-mono">
                      {new Date().toLocaleTimeString()}
                    </span>
                  </div>

                  <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                    {scanResults.map((cand, idx) => (
                      <div
                        key={cand.market.symbol}
                        className={`p-3 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 transition-all ${
                          idx === 0
                            ? 'bg-cyan-950/20 border-cyan-500/40'
                            : 'bg-slate-900/40 border-slate-800'
                        }`}
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-200">
                              {cand.market.displayName}
                            </span>
                            <span className="px-1.5 py-0.2 rounded bg-cyan-500/20 text-cyan-300 font-mono text-[10px] font-bold">
                              {cand.score}/100
                            </span>
                            <span className="text-[10px] font-mono text-slate-400">
                              {cand.volatilityRating} Volatility
                            </span>
                          </div>
                          <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">
                            {cand.reason}
                          </p>
                        </div>

                        <button
                          onClick={() => {
                            onSelectMarket(cand.market);
                            onClose();
                            showToast('info', 'Market Selected', `Loaded ${cand.market.displayName} to terminal.`);
                          }}
                          className="shrink-0 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-medium transition-colors"
                        >
                          Select
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
