import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Candle,
  ContractType,
  Market,
  PageId,
  Strategy,
  Tick,
  Trade,
  UserProfile,
} from '../../types/trading';
import { SYNTHETIC_MARKETS } from '../../data/syntheticMarkets';
import { derivWsService } from '../../services/derivWs';
import { storage } from '../../services/storage';
import { audioEffects } from '../../services/audioEffects';
import { extractLastDigit } from '../../utils/indicators';
import { useToast } from '../common/ToastNotification';
import { TradingChart } from '../analysis/TradingChart';
import { ActiveContractCard } from './ActiveContractCard';
import { DisclaimerBanner } from '../common/DisclaimerBanner';
import {
  ArrowUp,
  ArrowDown,
  Clock,
  RotateCcw,
  Sparkles,
  Zap,
  Play,
  ShieldAlert,
  Sliders,
  DollarSign,
  TrendingUp,
} from 'lucide-react';

interface DemoTradingProps {
  profile: UserProfile;
  onUpdateProfile: (p: UserProfile) => void;
  tradingMode: 'demo' | 'real';
  onNavigate: (page: PageId) => void;
  deployedStrategy?: Strategy | null;
}

export const DemoTrading: React.FC<DemoTradingProps> = ({
  profile,
  onUpdateProfile,
  tradingMode,
  onNavigate,
  deployedStrategy,
}) => {
  const { showToast } = useToast();

  const [selectedMarket, setSelectedMarket] = useState<Market>(SYNTHETIC_MARKETS[0]);
  const [currentQuote, setCurrentQuote] = useState<number>(derivWsService.getCurrentQuote());
  const [candles, setCandles] = useState<Candle[]>(derivWsService.getCandles());
  const [activeTrades, setActiveTrades] = useState<Trade[]>([]);

  // Execution ticket form state
  const [categoryTab, setCategoryTab] = useState<'rise_fall' | 'digits'>('rise_fall');
  const [contractType, setContractType] = useState<ContractType>('CALL');
  const [stake, setStake] = useState<number>(10);
  const [durationTicks, setDurationTicks] = useState<number>(5);
  const [targetDigit, setTargetDigit] = useState<number>(5);

  const activeTradesRef = useRef<Trade[]>(activeTrades);
  activeTradesRef.current = activeTrades;

  // Listen to Deriv market feed ticks and candles
  useEffect(() => {
    derivWsService.setMarket(selectedMarket);

    const unsubTick = derivWsService.subscribeToTicks((tick: Tick) => {
      setCurrentQuote(tick.quote);

      // Progress active trades
      if (activeTradesRef.current.length > 0) {
        processTickForActiveTrades(tick);
      }
    });

    const unsubCandles = derivWsService.subscribeToCandles((cList: Candle[]) => {
      setCandles(cList);
    });

    return () => {
      unsubTick();
      unsubCandles();
    };
  }, [selectedMarket]);

  // Tick step handler for active trades
  const processTickForActiveTrades = (tick: Tick) => {
    const updated: Trade[] = [];

    activeTradesRef.current.forEach((trade) => {
      if (trade.symbol !== tick.symbol) {
        updated.push(trade);
        return;
      }

      const newRemaining = trade.remainingTicks - 1;
      const ticksRecorded = [...trade.ticksRecorded, tick.quote];

      if (newRemaining <= 0) {
        // Contract resolved!
        resolveTrade(trade, tick.quote);
      } else {
        updated.push({
          ...trade,
          remainingTicks: newRemaining,
          ticksRecorded,
        });
      }
    });

    setActiveTrades(updated);
  };

  const resolveTrade = (trade: Trade, exitPrice: number) => {
    const exitDigit = extractLastDigit(exitPrice, selectedMarket.decimals);
    const entryDigit = extractLastDigit(trade.entryPrice, selectedMarket.decimals);

    let isWin = false;
    if (trade.contractType === 'CALL') {
      isWin = exitPrice > trade.entryPrice;
    } else if (trade.contractType === 'PUT') {
      isWin = exitPrice < trade.entryPrice;
    } else if (trade.contractType === 'EVEN') {
      isWin = exitDigit % 2 === 0;
    } else if (trade.contractType === 'ODD') {
      isWin = exitDigit % 2 !== 0;
    } else if (trade.contractType === 'MATCHES') {
      isWin = exitDigit === (trade.targetDigit ?? 0);
    } else if (trade.contractType === 'DIFFERS') {
      isWin = exitDigit !== (trade.targetDigit ?? 0);
    } else if (trade.contractType === 'OVER') {
      isWin = exitDigit > (trade.targetDigit ?? 5);
    } else if (trade.contractType === 'UNDER') {
      isWin = exitDigit < (trade.targetDigit ?? 5);
    }

    const profitLoss = isWin
      ? Number((trade.stake * trade.payoutRate).toFixed(2))
      : -Number(trade.stake.toFixed(2));

    const completedTrade: Trade = {
      ...trade,
      status: isWin ? 'won' : 'lost',
      exitPrice,
      exitTime: Date.now(),
      remainingTicks: 0,
      profitLoss,
    };

    // Update storage
    storage.addTrade(completedTrade);

    // Update profile demo balance
    if (trade.mode === 'demo') {
      const newBal = Number((profile.demoBalance + profitLoss).toFixed(2));
      const updatedProfile = { ...profile, demoBalance: Math.max(0, newBal) };
      storage.saveUserProfile(updatedProfile);
      onUpdateProfile(updatedProfile);
    }

    // Sound and toast feedback
    if (isWin) {
      audioEffects.playWin();
      showToast(
        'success',
        `Contract Won (+${profitLoss > 0 ? '$' + profitLoss : '$0'})`,
        `${trade.contractType} contract on ${trade.symbol} exited at ${exitPrice.toFixed(
          selectedMarket.decimals
        )}`
      );
    } else {
      audioEffects.playLoss();
      showToast(
        'error',
        `Contract Lost (-$${trade.stake})`,
        `${trade.contractType} on ${trade.symbol} exited at ${exitPrice.toFixed(
          selectedMarket.decimals
        )}`
      );
    }
  };

  // Place Trade Action
  const handlePlaceTrade = (typeToExecute: ContractType) => {
    if (stake <= 0) {
      showToast('error', 'Invalid Stake', 'Please enter a stake amount greater than $0.');
      return;
    }

    const currentBalance =
      tradingMode === 'demo' ? profile.demoBalance : profile.realBalance;

    if (currentBalance < stake) {
      showToast(
        'error',
        'Insufficient Balance',
        `Account balance ($${currentBalance.toFixed(2)}) is insufficient for $${stake} stake.`
      );
      return;
    }

    const potentialProfit = Number((stake * selectedMarket.payoutRate).toFixed(2));
    const potentialPayout = Number((stake + potentialProfit).toFixed(2));

    const newTrade: Trade = {
      id: `tr_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      symbol: selectedMarket.symbol,
      contractType: typeToExecute,
      stake,
      payoutRate: selectedMarket.payoutRate,
      potentialPayout,
      entryTime: Date.now(),
      entryPrice: currentQuote,
      targetDigit: categoryTab === 'digits' ? targetDigit : undefined,
      status: 'active',
      profitLoss: 0,
      mode: tradingMode,
      durationTicks,
      remainingTicks: durationTicks,
      ticksRecorded: [currentQuote],
      strategyName: deployedStrategy?.name,
    };

    setActiveTrades((prev) => [newTrade, ...prev]);
    audioEffects.playTradePlaced();
    showToast(
      'info',
      `Order Placed: ${typeToExecute}`,
      `Stake $${stake} @ ${currentQuote.toFixed(selectedMarket.decimals)} (${durationTicks} ticks)`
    );
  };

  // Reset Demo Balance
  const handleResetBalance = () => {
    const updated = storage.resetDemoBalance(10000.0);
    onUpdateProfile(updated);
    audioEffects.playTradePlaced();
    showToast('success', 'Demo Funds Restored', 'Virtual balance reset to $10,000.00 USD.');
  };

  const payoutAmount = (stake * selectedMarket.payoutRate).toFixed(2);
  const totalReturn = (stake * (1 + selectedMarket.payoutRate)).toFixed(2);

  return (
    <div className="p-4 lg:p-6 space-y-5 max-w-7xl mx-auto">
      {/* Top Header / Market Switcher Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
            <Zap className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold tracking-tight text-slate-100">
                Binary Options Terminal
              </h2>
              <span className="text-xs px-2 py-0.5 rounded font-mono font-bold uppercase tracking-wider bg-slate-800 text-cyan-400 border border-slate-700">
                {tradingMode.toUpperCase()} TRADING
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Real-time contract execution with live Deriv tick intervals
            </p>
          </div>
        </div>

        {/* Market Selector Dropdown */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 font-medium">Instrument:</span>
            <select
              value={selectedMarket.symbol}
              onChange={(e) => {
                const found = SYNTHETIC_MARKETS.find((m) => m.symbol === e.target.value);
                if (found) setSelectedMarket(found);
              }}
              className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-100 focus:outline-none focus:border-cyan-500"
            >
              {SYNTHETIC_MARKETS.map((m) => (
                <option key={m.symbol} value={m.symbol}>
                  {m.displayName} ({m.volatilityLabel})
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={handleResetBalance}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-lg text-xs font-medium text-slate-300 transition-colors"
            title="Reset demo funds to $10,000"
          >
            <RotateCcw className="w-3.5 h-3.5 text-cyan-400" />
            <span>Reset Demo ($10k)</span>
          </button>
        </div>
      </div>

      <DisclaimerBanner compact />

      {/* Main Trading Terminal Layout: Chart (8 cols) + Execution Order Panel (4 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Chart Viewport (8 cols) */}
        <div className="lg:col-span-8 space-y-4">
          <TradingChart
            candles={candles}
            symbolName={selectedMarket.displayName}
            decimals={selectedMarket.decimals}
            currentQuote={currentQuote}
            height={380}
          />

          {/* Active Pending Contracts Section */}
          <div className="bg-[#090D16] border border-slate-800 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-cyan-400" />
                <h3 className="font-semibold text-slate-200 text-xs">
                  Active Running Contracts ({activeTrades.length})
                </h3>
              </div>
              <span className="text-[11px] font-mono text-slate-400">
                Tick-by-tick settlement
              </span>
            </div>

            {activeTrades.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {activeTrades.map((trade) => (
                  <ActiveContractCard
                    key={trade.id}
                    trade={trade}
                    currentQuote={currentQuote}
                    decimals={selectedMarket.decimals}
                  />
                ))}
              </div>
            ) : (
              <div className="py-6 text-center text-slate-500 text-xs font-mono">
                No active contracts running. Configure stake and submit an order below.
              </div>
            )}
          </div>
        </div>

        {/* Order Execution Panel (4 cols) */}
        <div className="lg:col-span-4 bg-[#090D16] border border-slate-800 rounded-xl p-5 space-y-4 shadow-xl">
          <div className="flex items-center justify-between pb-3 border-b border-slate-800">
            <h3 className="font-semibold text-slate-200 text-xs uppercase tracking-wider">
              Trade Execution Ticket
            </h3>
            <span className="font-mono text-xs font-bold text-emerald-400">
              Payout: {(selectedMarket.payoutRate * 100).toFixed(1)}%
            </span>
          </div>

          {/* Contract Category Tabs */}
          <div className="flex bg-slate-900 p-1 rounded-lg border border-slate-800">
            <button
              onClick={() => {
                setCategoryTab('rise_fall');
                setContractType('CALL');
              }}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                categoryTab === 'rise_fall'
                  ? 'bg-slate-800 text-slate-100 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Rise / Fall
            </button>
            <button
              onClick={() => {
                setCategoryTab('digits');
                setContractType('EVEN');
              }}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                categoryTab === 'digits'
                  ? 'bg-slate-800 text-slate-100 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Digit Parity & Match
            </button>
          </div>

          {/* Duration Selector */}
          <div className="space-y-1.5 text-xs">
            <div className="flex items-center justify-between">
              <label className="text-slate-400 font-medium">Contract Duration</label>
              <span className="font-mono text-cyan-400 font-bold">{durationTicks} Ticks</span>
            </div>
            <div className="flex items-center gap-1.5">
              {[1, 2, 5, 8, 10].map((t) => (
                <button
                  key={t}
                  onClick={() => setDurationTicks(t)}
                  className={`flex-1 py-1.5 rounded text-xs font-mono transition-colors ${
                    durationTicks === t
                      ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/50 font-bold'
                      : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {t}t
                </button>
              ))}
            </div>
          </div>

          {/* Stake Input & Quick Chips */}
          <div className="space-y-1.5 text-xs">
            <div className="flex items-center justify-between">
              <label className="text-slate-400 font-medium">Stake Amount ($ USD)</label>
              <span className="text-[11px] text-slate-500">Min: ${selectedMarket.minStake}</span>
            </div>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
                $
              </div>
              <input
                type="number"
                min={selectedMarket.minStake}
                max={selectedMarket.maxStake}
                step="1"
                value={stake}
                onChange={(e) => setStake(Math.max(0, Number(e.target.value)))}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-7 pr-3 py-2 text-slate-100 font-mono text-sm font-bold focus:outline-none focus:border-cyan-500"
              />
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
          </div>

          {/* Digit-specific target selector */}
          {categoryTab === 'digits' && (
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

          {/* Expected Financials Payout Box */}
          <div className="p-3 bg-slate-900/80 rounded-lg border border-slate-800 space-y-1.5 text-xs">
            <div className="flex items-center justify-between text-slate-400">
              <span>Net Profit:</span>
              <span className="font-mono text-emerald-400 font-bold">+${payoutAmount}</span>
            </div>
            <div className="flex items-center justify-between text-slate-400">
              <span>Total Payout:</span>
              <span className="font-mono text-slate-200 font-bold">${totalReturn}</span>
            </div>
          </div>

          {/* Big Execution Buttons */}
          {categoryTab === 'rise_fall' ? (
            <div className="grid grid-cols-2 gap-3 pt-1">
              {/* RISE / CALL */}
              <button
                onClick={() => handlePlaceTrade('CALL')}
                className="py-3 px-3 bg-emerald-600 hover:bg-emerald-500 active:scale-[0.98] text-white font-bold rounded-xl transition-all shadow-lg shadow-emerald-950/40 flex flex-col items-center justify-center gap-1 group"
              >
                <div className="flex items-center gap-1.5 text-sm">
                  <ArrowUp className="w-4 h-4 group-hover:-translate-y-0.5 transition-transform" />
                  <span>RISE (CALL)</span>
                </div>
                <span className="text-[10px] font-mono text-emerald-200 opacity-90">
                  Higher than spot
                </span>
              </button>

              {/* FALL / PUT */}
              <button
                onClick={() => handlePlaceTrade('PUT')}
                className="py-3 px-3 bg-rose-600 hover:bg-rose-500 active:scale-[0.98] text-white font-bold rounded-xl transition-all shadow-lg shadow-rose-950/40 flex flex-col items-center justify-center gap-1 group"
              >
                <div className="flex items-center gap-1.5 text-sm">
                  <ArrowDown className="w-4 h-4 group-hover:translate-y-0.5 transition-transform" />
                  <span>FALL (PUT)</span>
                </div>
                <span className="text-[10px] font-mono text-rose-200 opacity-90">
                  Lower than spot
                </span>
              </button>
            </div>
          ) : (
            <div className="space-y-2 pt-1">
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => handlePlaceTrade('EVEN')}
                  className="py-2.5 px-3 bg-emerald-600/90 hover:bg-emerald-500 text-white font-bold rounded-lg text-xs transition-colors"
                >
                  DIGIT EVEN
                </button>
                <button
                  onClick={() => handlePlaceTrade('ODD')}
                  className="py-2.5 px-3 bg-indigo-600/90 hover:bg-indigo-500 text-white font-bold rounded-lg text-xs transition-colors"
                >
                  DIGIT ODD
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => handlePlaceTrade('MATCHES')}
                  className="py-2 px-3 bg-slate-800 hover:bg-slate-700 text-amber-300 font-semibold rounded-lg text-xs border border-amber-500/30 transition-colors"
                >
                  MATCHES ({targetDigit})
                </button>
                <button
                  onClick={() => handlePlaceTrade('DIFFERS')}
                  className="py-2 px-3 bg-slate-800 hover:bg-slate-700 text-cyan-300 font-semibold rounded-lg text-xs border border-cyan-500/30 transition-colors"
                >
                  DIFFERS ({targetDigit})
                </button>
              </div>
            </div>
          )}

          {/* Strategy deployed hint if any */}
          {deployedStrategy && (
            <div className="p-2.5 bg-cyan-950/20 border border-cyan-500/30 rounded-lg flex items-center justify-between text-xs text-cyan-300">
              <div className="flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5" />
                <span className="truncate">Active Bot: {deployedStrategy.name}</span>
              </div>
              <button
                onClick={() => onNavigate('builder')}
                className="text-[11px] underline hover:text-cyan-200"
              >
                Edit
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
