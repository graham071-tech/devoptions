import React, { useState, useEffect, useMemo } from 'react';
import {
  Candle,
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
import { TradingChart } from '../analysis/TradingChart';
import { DisclaimerBanner } from '../common/DisclaimerBanner';
import {
  LayoutDashboard,
  Cpu,
  BarChart3,
  FlaskConical,
  PlaySquare,
  TrendingUp,
  TrendingDown,
  ArrowUpRight,
  ArrowDownRight,
  CheckCircle2,
  XCircle,
  Radio,
  Clock,
  Sparkles,
  ArrowRight,
  ShieldCheck,
} from 'lucide-react';

interface DashboardProps {
  profile: UserProfile;
  tradingMode: 'demo' | 'real';
  isWsConnected: boolean;
  dataSource: 'live' | 'simulated';
  latencyMs: number;
  onNavigate: (page: PageId) => void;
  onSelectStrategy: (strat: Strategy) => void;
  onOpenDerivModal: () => void;
}

export const Dashboard: React.FC<DashboardProps> = ({
  profile,
  tradingMode,
  isWsConnected,
  dataSource,
  latencyMs,
  onNavigate,
  onSelectStrategy,
  onOpenDerivModal,
}) => {
  const [selectedMarket, setSelectedMarket] = useState<Market>(SYNTHETIC_MARKETS[0]);
  const [currentQuote, setCurrentQuote] = useState<number>(derivWsService.getCurrentQuote());
  const [candles, setCandles] = useState<Candle[]>(derivWsService.getCandles());
  const [recentTrades, setRecentTrades] = useState<Trade[]>([]);

  const strategies = useMemo(() => storage.getStrategies(), []);

  useEffect(() => {
    derivWsService.setMarket(selectedMarket);

    const unsubTick = derivWsService.subscribeToTicks((t) => {
      setCurrentQuote(t.quote);
    });

    const unsubCandles = derivWsService.subscribeToCandles((c) => {
      setCandles(c);
    });

    setRecentTrades(storage.getTradeHistory().slice(0, 8));

    return () => {
      unsubTick();
      unsubCandles();
    };
  }, [selectedMarket]);

  // Trade metrics
  const tradeStats = useMemo(() => {
    const all = storage.getTradeHistory();
    const wins = all.filter((t) => t.status === 'won').length;
    const losses = all.filter((t) => t.status === 'lost').length;
    const total = wins + losses;
    const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) : '0.0';
    const netPnl = all.reduce((sum, t) => sum + (t.profitLoss || 0), 0);

    return { total, wins, losses, winRate, netPnl: Number(netPnl.toFixed(2)) };
  }, []);

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-7xl mx-auto">
      {/* Top Welcome & Mode Status Strip */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-slate-100">
              Trading Terminal Overview
            </h1>
            <span
              className={`text-xs px-2 py-0.5 rounded font-mono font-bold uppercase tracking-wider ${
                tradingMode === 'demo'
                  ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20'
                  : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
              }`}
            >
              {tradingMode.toUpperCase()} ACCOUNT
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Real-time synthetic volatility streaming with visual block automation
          </p>
        </div>

        {/* Quick Nav Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => onNavigate('builder')}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold border border-slate-700/60 transition-colors"
          >
            <Cpu className="w-3.5 h-3.5 text-cyan-400" />
            <span>Open Builder</span>
          </button>
          <button
            onClick={() => onNavigate('trading')}
            className="flex items-center gap-1.5 px-3.5 py-1.5 bg-cyan-500 hover:bg-cyan-400 text-slate-950 rounded-lg text-xs font-bold transition-colors shadow-sm"
          >
            <PlaySquare className="w-3.5 h-3.5 fill-current" />
            <span>Trade Demo</span>
          </button>
        </div>
      </div>

      <DisclaimerBanner compact />

      {/* Account Balances & Terminal Telemetry Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Demo Balance Card */}
        <div className="p-4 bg-[#090D16] border border-slate-800 rounded-xl space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Practice Demo Balance</span>
            <span className="text-[10px] uppercase font-bold text-cyan-400">DEMO</span>
          </div>
          <p className="font-mono text-2xl font-bold text-slate-100 tabular-nums">
            ${profile.demoBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
          <p className="text-[10px] text-slate-500">Risk-free execution capital</p>
        </div>

        {/* Real Balance Card */}
        <div className="p-4 bg-[#090D16] border border-slate-800 rounded-xl space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Real Deriv Account</span>
            <span
              className={`text-[10px] uppercase font-bold ${
                profile.isRealAuthorized ? 'text-emerald-400' : 'text-slate-500'
              }`}
            >
              {profile.isRealAuthorized ? 'CONNECTED' : 'STANDBY'}
            </span>
          </div>
          <p className="font-mono text-2xl font-bold text-slate-100 tabular-nums">
            ${profile.realBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
          <button
            onClick={onOpenDerivModal}
            className="text-[11px] text-cyan-400 hover:text-cyan-300 font-medium underline block text-left"
          >
            {profile.isRealAuthorized ? 'Manage Gateway Token' : 'Connect Deriv API'}
          </button>
        </div>

        {/* Data Stream Connection */}
        <div className="p-4 bg-[#090D16] border border-slate-800 rounded-xl space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Feed Telemetry</span>
            <Radio
              className={`w-3.5 h-3.5 ${
                dataSource === 'live' && isWsConnected ? 'text-emerald-400' : 'text-amber-400'
              }`}
            />
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`font-mono text-sm font-bold ${
                dataSource === 'live' && isWsConnected ? 'text-emerald-400' : 'text-amber-400'
              }`}
            >
              {dataSource === 'live' && isWsConnected
                ? 'Deriv WebSocket Live'
                : 'Real-Time Tick Engine'}
            </span>
          </div>
          <p className="text-[10px] text-slate-500 font-mono">
            Ping: {latencyMs}ms · Endpoint: ws.derivws.com
          </p>
        </div>

        {/* Lifetime Performance Win Rate */}
        <div className="p-4 bg-[#090D16] border border-slate-800 rounded-xl space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Historical Win Rate</span>
            <span className="font-mono text-slate-400 text-xs">{tradeStats.total} Trades</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-2xl font-bold text-cyan-400">
              {tradeStats.winRate}%
            </span>
            <span
              className={`font-mono text-xs font-bold ${
                tradeStats.netPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              ({tradeStats.netPnl >= 0 ? '+' : ''}${tradeStats.netPnl})
            </span>
          </div>
          <p className="text-[10px] text-slate-500">
            {tradeStats.wins} Wins · {tradeStats.losses} Losses
          </p>
        </div>
      </div>

      {/* Main Terminal Area: Active Market Chart + Quick Action Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Chart View (8 cols) */}
        <div className="lg:col-span-8 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 bg-[#090D16] border border-slate-800 rounded-xl p-3">
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-400 font-medium">Select Market:</span>
              <select
                value={selectedMarket.symbol}
                onChange={(e) => {
                  const m = SYNTHETIC_MARKETS.find((item) => item.symbol === e.target.value);
                  if (m) setSelectedMarket(m);
                }}
                className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1 text-xs font-semibold text-slate-100 focus:outline-none focus:border-cyan-500"
              >
                {SYNTHETIC_MARKETS.map((m) => (
                  <option key={m.symbol} value={m.symbol}>
                    {m.displayName}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-3 text-xs">
              <span className="text-slate-400">Payout Rate:</span>
              <span className="font-mono font-bold text-emerald-400">
                {(selectedMarket.payoutRate * 100).toFixed(1)}%
              </span>
            </div>
          </div>

          <TradingChart
            candles={candles}
            symbolName={selectedMarket.displayName}
            decimals={selectedMarket.decimals}
            currentQuote={currentQuote}
            height={360}
          />
        </div>

        {/* Right Shortcuts & Fast Strategy Launcher (4 cols) */}
        <div className="lg:col-span-4 space-y-4">
          {/* Quick Access Tools */}
          <div className="bg-[#090D16] border border-slate-800 rounded-xl p-4 space-y-3">
            <h3 className="font-semibold text-slate-200 text-xs uppercase tracking-wider pb-2 border-b border-slate-800">
              Terminal Workspaces
            </h3>

            <div className="space-y-2">
              <button
                onClick={() => onNavigate('builder')}
                className="w-full flex items-center justify-between p-2.5 rounded-lg bg-slate-900/60 hover:bg-slate-800 border border-slate-800/80 transition-colors group text-left"
              >
                <div className="flex items-center gap-2.5">
                  <div className="p-1.5 rounded bg-cyan-500/10 text-cyan-400">
                    <Cpu className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold text-slate-200 group-hover:text-cyan-400 transition-colors">
                      Visual Strategy Builder
                    </h4>
                    <p className="text-[10px] text-slate-400">
                      Assemble block logic without writing code
                    </p>
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-slate-500 group-hover:text-cyan-400 transition-colors" />
              </button>

              <button
                onClick={() => onNavigate('analysis')}
                className="w-full flex items-center justify-between p-2.5 rounded-lg bg-slate-900/60 hover:bg-slate-800 border border-slate-800/80 transition-colors group text-left"
              >
                <div className="flex items-center gap-2.5">
                  <div className="p-1.5 rounded bg-amber-500/10 text-amber-400">
                    <BarChart3 className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold text-slate-200 group-hover:text-amber-400 transition-colors">
                      Last-Digit & Technical Analysis
                    </h4>
                    <p className="text-[10px] text-slate-400">
                      Distribution histograms & candle statistics
                    </p>
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-slate-500 group-hover:text-amber-400 transition-colors" />
              </button>

              <button
                onClick={() => onNavigate('backtesting')}
                className="w-full flex items-center justify-between p-2.5 rounded-lg bg-slate-900/60 hover:bg-slate-800 border border-slate-800/80 transition-colors group text-left"
              >
                <div className="flex items-center gap-2.5">
                  <div className="p-1.5 rounded bg-indigo-500/10 text-indigo-400">
                    <FlaskConical className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold text-slate-200 group-hover:text-indigo-400 transition-colors">
                      Backtest & Monte Carlo Engine
                    </h4>
                    <p className="text-[10px] text-slate-400">
                      Multi-path risk of ruin modeling
                    </p>
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-slate-500 group-hover:text-indigo-400 transition-colors" />
              </button>
            </div>
          </div>

          {/* Strategy Quick Deploy */}
          <div className="bg-[#090D16] border border-slate-800 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <h3 className="font-semibold text-slate-200 text-xs uppercase tracking-wider">
                Saved Strategies ({strategies.length})
              </h3>
              <button
                onClick={() => onNavigate('library')}
                className="text-[11px] text-cyan-400 hover:text-cyan-300 font-medium"
              >
                View Library
              </button>
            </div>

            <div className="space-y-2 max-h-48 overflow-y-auto">
              {strategies.slice(0, 4).map((strat) => (
                <div
                  key={strat.id}
                  onClick={() => {
                    onSelectStrategy(strat);
                    onNavigate('builder');
                  }}
                  className="p-2.5 bg-slate-900/80 hover:bg-slate-800 border border-slate-800 rounded-lg cursor-pointer transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-xs text-slate-200">{strat.name}</span>
                    <span className="font-mono text-[10px] text-cyan-400">
                      {strat.marketSymbol}
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1 line-clamp-1">
                    {strat.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Synthetic Markets Table & Recent Trade Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Markets Ticker Table (7 cols) */}
        <div className="lg:col-span-7 bg-[#090D16] border border-slate-800 rounded-xl overflow-hidden">
          <div className="p-3.5 bg-slate-900/60 border-b border-slate-800 flex items-center justify-between">
            <h3 className="font-semibold text-slate-200 text-xs">
              Deriv Synthetic Volatility Indices
            </h3>
            <span className="text-[11px] text-slate-500 font-mono">10 Instruments</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-slate-900/90 text-[11px] text-slate-400 border-b border-slate-800 font-sans">
                <tr>
                  <th className="py-2.5 px-3">Symbol</th>
                  <th className="py-2.5 px-3">Index Name</th>
                  <th className="py-2.5 px-3">Volatility</th>
                  <th className="py-2.5 px-3">Payout</th>
                  <th className="py-2.5 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-[11px]">
                {SYNTHETIC_MARKETS.map((m) => (
                  <tr
                    key={m.symbol}
                    className={`hover:bg-slate-900/40 transition-colors cursor-pointer ${
                      selectedMarket.symbol === m.symbol ? 'bg-slate-900/50' : ''
                    }`}
                    onClick={() => setSelectedMarket(m)}
                  >
                    <td className="py-2.5 px-3 font-bold text-cyan-400">{m.symbol}</td>
                    <td className="py-2.5 px-3 font-sans text-slate-200 font-medium">
                      {m.displayName}
                    </td>
                    <td className="py-2.5 px-3 text-slate-400">{m.volatilityLabel}</td>
                    <td className="py-2.5 px-3 text-emerald-400 font-bold">
                      {(m.payoutRate * 100).toFixed(1)}%
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedMarket(m);
                          onNavigate('trading');
                        }}
                        className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-[10px] font-sans font-semibold transition-colors"
                      >
                        Trade
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Recent Trades Stream (5 cols) */}
        <div className="lg:col-span-5 bg-[#090D16] border border-slate-800 rounded-xl overflow-hidden">
          <div className="p-3.5 bg-slate-900/60 border-b border-slate-800 flex items-center justify-between">
            <h3 className="font-semibold text-slate-200 text-xs">Recent Trade Executions</h3>
            <button
              onClick={() => onNavigate('history')}
              className="text-[11px] text-cyan-400 hover:text-cyan-300 font-medium"
            >
              Full History
            </button>
          </div>

          {recentTrades.length > 0 ? (
            <div className="divide-y divide-slate-800/60 max-h-80 overflow-y-auto">
              {recentTrades.map((t) => (
                <div
                  key={t.id}
                  className="p-3 flex items-center justify-between hover:bg-slate-900/30 transition-colors text-xs"
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-1.5 font-semibold text-slate-200">
                      <span
                        className={`w-2 h-2 rounded-full ${
                          t.status === 'won' ? 'bg-emerald-400' : 'bg-rose-400'
                        }`}
                      />
                      <span>{t.symbol}</span>
                      <span className="font-mono text-slate-400 text-[11px]">
                        ({t.contractType})
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-500 font-mono">
                      {new Date(t.entryTime).toLocaleTimeString()} · Stake ${t.stake}
                    </p>
                  </div>

                  <div className="text-right font-mono">
                    <span
                      className={`font-bold block ${
                        t.profitLoss >= 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {t.profitLoss >= 0 ? '+' : ''}${t.profitLoss}
                    </span>
                    <span className="text-[10px] text-slate-500 uppercase font-sans">
                      {t.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-8 text-center text-slate-500 text-xs font-mono">
              No recent demo trades recorded. Place a trade in Demo Trading to inspect results.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
