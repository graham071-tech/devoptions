import React, { useState, useMemo } from 'react';
import {
  BacktestResult,
  BacktestSettings,
  ContractType,
  PageId,
  Strategy,
} from '../../types/trading';
import { SYNTHETIC_MARKETS } from '../../data/syntheticMarkets';
import { storage } from '../../services/storage';
import { derivWsService } from '../../services/derivWs';
import { runBacktestSimulation } from '../../utils/backtester';
import { audioEffects } from '../../services/audioEffects';
import { useToast } from '../common/ToastNotification';
import { EquityCurveChart } from './EquityCurveChart';
import { MonteCarloSimulation } from './MonteCarloSimulation';
import { DisclaimerBanner } from '../common/DisclaimerBanner';
import {
  FlaskConical,
  Play,
  RotateCcw,
  CheckCircle2,
  XCircle,
  TrendingUp,
  Percent,
  DollarSign,
  AlertTriangle,
  ArrowUpRight,
  Shield,
} from 'lucide-react';

interface BacktestEngineProps {
  onNavigate: (page: PageId) => void;
  onDeployToDemo: (strategy: Strategy) => void;
  preselectedStrategy?: Strategy | null;
}

export const BacktestEngine: React.FC<BacktestEngineProps> = ({
  onNavigate,
  onDeployToDemo,
  preselectedStrategy,
}) => {
  const { showToast } = useToast();
  const allStrategies = useMemo(() => storage.getStrategies(), []);

  const [selectedStrategyId, setSelectedStrategyId] = useState<string>(
    preselectedStrategy?.id || allStrategies[0]?.id || ''
  );

  const activeStrategy = useMemo(() => {
    return allStrategies.find((s) => s.id === selectedStrategyId) || allStrategies[0];
  }, [allStrategies, selectedStrategyId]);

  const [settings, setSettings] = useState<BacktestSettings>({
    strategyId: activeStrategy?.id || '',
    symbol: activeStrategy?.marketSymbol || 'R_100',
    sampleSize: 500,
    initialBalance: 1000,
    stake: 10,
    contractType: 'CALL',
    durationTicks: 5,
    payoutRate: 0.95,
    applyMartingale: false,
    martingaleMultiplier: 2.1,
  });

  const [backtestResult, setBacktestResult] = useState<BacktestResult | null>(null);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [tradeFilter, setTradeFilter] = useState<'all' | 'won' | 'lost'>('all');

  const selectedMarket = useMemo(() => {
    return SYNTHETIC_MARKETS.find((m) => m.symbol === settings.symbol) || SYNTHETIC_MARKETS[0];
  }, [settings.symbol]);

  // Execute Backtest
  const handleExecuteBacktest = () => {
    if (!activeStrategy) return;

    setIsRunning(true);
    showToast('info', 'Running Backtest', `Simulating ${settings.sampleSize} historical ticks...`);

    setTimeout(() => {
      // Gather candle closes or generate historical series matching market parameters
      const candles = derivWsService.getCandles();
      let quotes: number[] = candles.map((c) => c.close);

      // If available candles < sampleSize, generate synthetic historical walk matching pip size
      if (quotes.length < settings.sampleSize) {
        let base = quotes.length > 0 ? quotes[quotes.length - 1] : 5000;
        const generated: number[] = [...quotes];
        while (generated.length < settings.sampleSize) {
          const change = (Math.random() - 0.499) * (base * 0.0006);
          base = Number((base + change).toFixed(selectedMarket.decimals));
          generated.push(base);
        }
        quotes = generated;
      }

      const result = runBacktestSimulation(
        activeStrategy,
        settings,
        quotes,
        selectedMarket.decimals
      );

      setBacktestResult(result);
      setIsRunning(false);
      audioEffects.playTradePlaced();
      showToast(
        'success',
        'Backtest Completed',
        `Evaluated ${result.totalTrades} simulated trades with ${result.winRate}% win rate.`
      );
    }, 400);
  };

  const filteredTrades = useMemo(() => {
    if (!backtestResult) return [];
    if (tradeFilter === 'won') return backtestResult.trades.filter((t) => t.isWin);
    if (tradeFilter === 'lost') return backtestResult.trades.filter((t) => !t.isWin);
    return backtestResult.trades;
  }, [backtestResult, tradeFilter]);

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-slate-100 flex items-center gap-2">
            <FlaskConical className="w-5 h-5 text-indigo-400" />
            <span>Strategy Backtesting & Historical Simulation</span>
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Evaluate rule performance, drawdowns, and risk parameters against tick price sequences
          </p>
        </div>

        {activeStrategy && (
          <button
            onClick={() => onDeployToDemo(activeStrategy)}
            className="flex items-center gap-2 px-3.5 py-2 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold rounded-lg text-xs transition-colors shadow-sm"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>Deploy Strategy to Demo</span>
          </button>
        )}
      </div>

      <DisclaimerBanner />

      {/* Main Grid: Parameters on Left, Results on Right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Configuration Form (4 cols) */}
        <div className="lg:col-span-4 bg-[#090D16] border border-slate-800 rounded-xl p-5 space-y-4">
          <h3 className="font-semibold text-slate-200 text-xs uppercase tracking-wider">
            Simulation Parameters
          </h3>

          {/* Strategy Selector */}
          <div className="space-y-1.5 text-xs">
            <label className="text-slate-400 block font-medium">Select Strategy</label>
            <select
              value={selectedStrategyId}
              onChange={(e) => {
                setSelectedStrategyId(e.target.value);
                const s = allStrategies.find((st) => st.id === e.target.value);
                if (s) {
                  setSettings((prev) => ({
                    ...prev,
                    strategyId: s.id,
                    symbol: s.marketSymbol || prev.symbol,
                  }));
                }
              }}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-cyan-500 text-xs"
            >
              {allStrategies.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          {/* Market Index */}
          <div className="space-y-1.5 text-xs">
            <label className="text-slate-400 block font-medium">Synthetic Index</label>
            <select
              value={settings.symbol}
              onChange={(e) => setSettings({ ...settings, symbol: e.target.value })}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-cyan-500 text-xs"
            >
              {SYNTHETIC_MARKETS.map((m) => (
                <option key={m.symbol} value={m.symbol}>
                  {m.displayName}
                </option>
              ))}
            </select>
          </div>

          {/* Sample Size (Historical ticks) */}
          <div className="space-y-1.5 text-xs">
            <label className="text-slate-400 block font-medium">Historical Sample Size</label>
            <select
              value={settings.sampleSize}
              onChange={(e) => setSettings({ ...settings, sampleSize: Number(e.target.value) })}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-cyan-500 text-xs font-mono"
            >
              <option value="200">200 Ticks (~10 Minutes)</option>
              <option value="500">500 Ticks (~30 Minutes)</option>
              <option value="1000">1,000 Ticks (~1 Hour)</option>
              <option value="2000">2,000 Ticks (~2 Hours)</option>
            </select>
          </div>

          {/* Starting Balance & Base Stake */}
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <label className="text-slate-400 block font-medium">Starting Balance ($)</label>
              <input
                type="number"
                min="50"
                step="50"
                value={settings.initialBalance}
                onChange={(e) =>
                  setSettings({ ...settings, initialBalance: Number(e.target.value) })
                }
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 font-mono text-xs focus:outline-none focus:border-cyan-500"
              />
            </div>
            <div>
              <label className="text-slate-400 block font-medium">Base Stake ($)</label>
              <input
                type="number"
                min="1"
                step="1"
                value={settings.stake}
                onChange={(e) => setSettings({ ...settings, stake: Number(e.target.value) })}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 font-mono text-xs focus:outline-none focus:border-cyan-500"
              />
            </div>
          </div>

          {/* Duration & Payout Rate */}
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <label className="text-slate-400 block font-medium">Duration (Ticks)</label>
              <input
                type="number"
                min="1"
                max="10"
                value={settings.durationTicks}
                onChange={(e) =>
                  setSettings({ ...settings, durationTicks: Number(e.target.value) })
                }
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 font-mono text-xs focus:outline-none focus:border-cyan-500"
              />
            </div>
            <div>
              <label className="text-slate-400 block font-medium">Assumed Payout</label>
              <select
                value={settings.payoutRate}
                onChange={(e) =>
                  setSettings({ ...settings, payoutRate: Number(e.target.value) })
                }
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 font-mono text-xs"
              >
                <option value="0.95">95.0%</option>
                <option value="0.90">90.0%</option>
                <option value="0.85">85.0%</option>
              </select>
            </div>
          </div>

          {/* Martingale Recovery Checkbox */}
          <div className="p-3 bg-slate-900/60 rounded-lg border border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-slate-300 cursor-pointer flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={settings.applyMartingale}
                  onChange={(e) =>
                    setSettings({ ...settings, applyMartingale: e.target.checked })
                  }
                  className="rounded bg-slate-950 border-slate-700 text-cyan-500 focus:ring-0"
                />
                <span>Test Martingale Progression</span>
              </label>
            </div>
            {settings.applyMartingale && (
              <div className="pt-2 text-[11px] space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Multiplier on Loss:</span>
                  <input
                    type="number"
                    min="1.5"
                    max="3.0"
                    step="0.1"
                    value={settings.martingaleMultiplier}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        martingaleMultiplier: Number(e.target.value),
                      })
                    }
                    className="w-16 bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 text-right font-mono text-xs text-slate-100"
                  />
                </div>
                <p className="text-amber-400/90 text-[10px]">
                  Warning: Martingale exponentially increases ruin risk during losing streaks.
                </p>
              </div>
            )}
          </div>

          {/* Run Button */}
          <button
            onClick={handleExecuteBacktest}
            disabled={isRunning}
            className="w-full flex items-center justify-center gap-2 py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-lg text-xs transition-colors shadow-lg shadow-indigo-950/40"
          >
            <FlaskConical className={`w-4 h-4 ${isRunning ? 'animate-spin' : ''}`} />
            <span>{isRunning ? 'Calculating Simulation...' : 'Run Backtest Simulation'}</span>
          </button>
        </div>

        {/* Right Column: Results & Analytics (8 cols) */}
        <div className="lg:col-span-8 space-y-5">
          {backtestResult ? (
            <>
              {/* Primary KPI Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {/* Total Trades & Win Rate */}
                <div className="p-3.5 bg-[#090D16] border border-slate-800 rounded-xl space-y-1">
                  <span className="text-[11px] text-slate-400">Win Rate</span>
                  <div className="flex items-center gap-2">
                    <span
                      className={`font-mono text-xl font-bold ${
                        backtestResult.winRate >= 52 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {backtestResult.winRate}%
                    </span>
                    <span className="text-[11px] text-slate-500">
                      ({backtestResult.wins}W / {backtestResult.losses}L)
                    </span>
                  </div>
                </div>

                {/* Net Strategy Profit */}
                <div className="p-3.5 bg-[#090D16] border border-slate-800 rounded-xl space-y-1">
                  <span className="text-[11px] text-slate-400">Net Strategy P&L</span>
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`font-mono text-xl font-bold ${
                        backtestResult.netProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {backtestResult.netProfit >= 0 ? '+' : ''}${backtestResult.netProfit}
                    </span>
                    <span className="text-[11px] text-slate-500 font-mono">
                      ({backtestResult.returnPercentage}%)
                    </span>
                  </div>
                </div>

                {/* Profit Factor */}
                <div className="p-3.5 bg-[#090D16] border border-slate-800 rounded-xl space-y-1">
                  <span className="text-[11px] text-slate-400">Profit Factor</span>
                  <p className="font-mono text-xl font-bold text-cyan-400">
                    {backtestResult.profitFactor}
                  </p>
                </div>

                {/* Max Drawdown */}
                <div className="p-3.5 bg-[#090D16] border border-slate-800 rounded-xl space-y-1">
                  <span className="text-[11px] text-slate-400">Max Drawdown</span>
                  <p className="font-mono text-xl font-bold text-rose-400">
                    -${backtestResult.maxDrawdown} ({backtestResult.maxDrawdownPercent}%)
                  </p>
                </div>
              </div>

              {/* Equity Curve Card */}
              <div className="bg-[#090D16] border border-slate-800 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                  <h4 className="font-semibold text-slate-100 text-xs">
                    Strategy Balance Over Trade Sequence
                  </h4>
                  <div className="flex items-center gap-3 text-[11px] font-mono text-slate-400">
                    <span>Initial: ${backtestResult.initialBalance}</span>
                    <span>→</span>
                    <span
                      className={`font-bold ${
                        backtestResult.finalBalance >= backtestResult.initialBalance
                          ? 'text-emerald-400'
                          : 'text-rose-400'
                      }`}
                    >
                      Final: ${backtestResult.finalBalance}
                    </span>
                  </div>
                </div>

                <EquityCurveChart
                  data={backtestResult.balanceCurve}
                  initialBalance={backtestResult.initialBalance}
                />
              </div>

              {/* Monte Carlo Section */}
              {backtestResult.monteCarloPaths && (
                <MonteCarloSimulation
                  paths={backtestResult.monteCarloPaths}
                  initialBalance={backtestResult.initialBalance}
                />
              )}

              {/* Simulated Trade Execution Log */}
              <div className="bg-[#090D16] border border-slate-800 rounded-xl overflow-hidden">
                <div className="p-3 bg-slate-900/60 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
                  <h4 className="font-semibold text-slate-200">
                    Backtest Order Log ({backtestResult.trades.length} Trades)
                  </h4>

                  {/* Filter tabs */}
                  <div className="flex items-center bg-slate-800 p-0.5 rounded-md">
                    <button
                      onClick={() => setTradeFilter('all')}
                      className={`px-2.5 py-1 text-[11px] rounded font-medium transition-colors ${
                        tradeFilter === 'all' ? 'bg-slate-700 text-slate-100' : 'text-slate-400'
                      }`}
                    >
                      All
                    </button>
                    <button
                      onClick={() => setTradeFilter('won')}
                      className={`px-2.5 py-1 text-[11px] rounded font-medium transition-colors ${
                        tradeFilter === 'won' ? 'bg-slate-700 text-emerald-400' : 'text-slate-400'
                      }`}
                    >
                      Wins ({backtestResult.wins})
                    </button>
                    <button
                      onClick={() => setTradeFilter('lost')}
                      className={`px-2.5 py-1 text-[11px] rounded font-medium transition-colors ${
                        tradeFilter === 'lost' ? 'bg-slate-700 text-rose-400' : 'text-slate-400'
                      }`}
                    >
                      Losses ({backtestResult.losses})
                    </button>
                  </div>
                </div>

                <div className="max-h-72 overflow-y-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-900/90 text-[11px] text-slate-400 font-mono sticky top-0 border-b border-slate-800">
                      <tr>
                        <th className="py-2 px-3">#</th>
                        <th className="py-2 px-3">Contract</th>
                        <th className="py-2 px-3">Entry</th>
                        <th className="py-2 px-3">Exit</th>
                        <th className="py-2 px-3">Stake</th>
                        <th className="py-2 px-3">Result</th>
                        <th className="py-2 px-3 text-right">Net P&L</th>
                        <th className="py-2 px-3 text-right">Balance</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
                      {filteredTrades.map((t) => (
                        <tr key={t.id} className="hover:bg-slate-900/40 transition-colors">
                          <td className="py-2 px-3 text-slate-500">{t.tradeIndex}</td>
                          <td className="py-2 px-3 text-slate-200 font-sans font-medium">
                            {t.contractType}
                          </td>
                          <td className="py-2 px-3 text-slate-300">{t.entryPrice.toFixed(selectedMarket.decimals)}</td>
                          <td className="py-2 px-3 text-slate-300">{t.exitPrice.toFixed(selectedMarket.decimals)}</td>
                          <td className="py-2 px-3 text-slate-300">${t.stake}</td>
                          <td className="py-2 px-3">
                            <span
                              className={`inline-flex items-center gap-1 font-semibold ${
                                t.isWin ? 'text-emerald-400' : 'text-rose-400'
                              }`}
                            >
                              {t.isWin ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                              <span>{t.isWin ? 'Won' : 'Lost'}</span>
                            </span>
                          </td>
                          <td
                            className={`py-2 px-3 text-right font-bold ${
                              t.pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
                            }`}
                          >
                            {t.pnl >= 0 ? '+' : ''}${t.pnl}
                          </td>
                          <td className="py-2 px-3 text-right text-slate-200">
                            ${t.balanceAfter}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : (
            /* Empty state prior to backtest execution */
            <div className="bg-[#090D16] border border-slate-800 rounded-xl p-12 text-center space-y-4">
              <div className="w-12 h-12 rounded-full bg-indigo-500/10 text-indigo-400 flex items-center justify-center mx-auto">
                <FlaskConical className="w-6 h-6" />
              </div>
              <div className="max-w-md mx-auto space-y-1.5">
                <h4 className="font-semibold text-slate-200 text-sm">
                  Ready to Evaluate Strategy Performance
                </h4>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Configure starting balance, stake sizing, and sample tick sequence on the left, then click "Run Backtest Analysis" to evaluate empirical win rate, drawdown, and Monte Carlo risk of ruin.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
