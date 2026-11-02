import React, { useState, useMemo } from 'react';
import { ContractType, Market, PageId, Trade, UserProfile } from '../../types/trading';
import { SYNTHETIC_MARKETS } from '../../data/syntheticMarkets';
import { storage } from '../../services/storage';
import { extractLastDigit } from '../../utils/indicators';
import {
  Clock,
  CheckCircle2,
  XCircle,
  TrendingUp,
  TrendingDown,
  Layers,
  History,
  Trash2,
  ArrowRight,
  Activity,
  DollarSign,
  Percent,
  Timer,
  ChevronRight,
  Filter,
} from 'lucide-react';

interface PositionsPageProps {
  activeTrades: Trade[];
  completedTrades: Trade[];
  onClearHistory?: () => void;
  onNavigate: (page: PageId) => void;
  currentQuote: number;
  profile: UserProfile;
  tradingMode: 'demo' | 'real';
}

export const PositionsPage: React.FC<PositionsPageProps> = ({
  activeTrades,
  completedTrades,
  onClearHistory,
  onNavigate,
  currentQuote,
  profile,
  tradingMode,
}) => {
  const [activeTab, setActiveTab] = useState<'open' | 'history'>('open');
  const [historyFilter, setHistoryFilter] = useState<'all' | 'won' | 'lost'>('all');
  const [modeFilter, setModeFilter] = useState<'all' | 'demo' | 'real'>('all');

  // Filter completed trades
  const filteredHistory = useMemo(() => {
    return completedTrades.filter((t) => {
      if (historyFilter === 'won' && t.status !== 'won') return false;
      if (historyFilter === 'lost' && t.status !== 'lost') return false;
      if (modeFilter !== 'all' && t.mode !== modeFilter) return false;
      return true;
    });
  }, [completedTrades, historyFilter, modeFilter]);

  // Compute summary stats
  const stats = useMemo(() => {
    const relevantTrades = completedTrades.filter((t) =>
      modeFilter === 'all' ? true : t.mode === modeFilter
    );
    const total = relevantTrades.length;
    const wins = relevantTrades.filter((t) => t.status === 'won').length;
    const losses = relevantTrades.filter((t) => t.status === 'lost').length;
    const winRate = total > 0 ? (wins / total) * 100 : 0;
    const netPL = relevantTrades.reduce((sum, t) => sum + t.profitLoss, 0);
    const totalVolume = relevantTrades.reduce((sum, t) => sum + t.stake, 0);

    return { total, wins, losses, winRate, netPL, totalVolume };
  }, [completedTrades, modeFilter]);

  // Helper to determine whether an active contract is currently winning
  const isTradeInProfit = (trade: Trade): boolean => {
    const market = SYNTHETIC_MARKETS.find((m) => m.symbol === trade.symbol);
    const decimals = market?.decimals ?? 2;
    const currentDigit = extractLastDigit(currentQuote, decimals);

    switch (trade.contractType) {
      case 'CALL':
        return currentQuote > trade.entryPrice;
      case 'PUT':
        return currentQuote < trade.entryPrice;
      case 'EVEN':
        return currentDigit % 2 === 0;
      case 'ODD':
        return currentDigit % 2 !== 0;
      case 'MATCHES':
        return currentDigit === (trade.targetDigit ?? 0);
      case 'DIFFERS':
        return currentDigit !== (trade.targetDigit ?? 0);
      case 'OVER':
        return currentDigit > (trade.targetDigit ?? 5);
      case 'UNDER':
        return currentDigit < (trade.targetDigit ?? 5);
      case 'TOUCH':
        return Boolean(trade.barrier && currentQuote >= trade.barrier);
      case 'NOTOUCH':
        return Boolean(trade.barrier && currentQuote < trade.barrier);
      default:
        return false;
    }
  };

  const getMarketName = (symbol: string): string => {
    return SYNTHETIC_MARKETS.find((m) => m.symbol === symbol)?.displayName || symbol;
  };

  const getMarketDecimals = (symbol: string): number => {
    return SYNTHETIC_MARKETS.find((m) => m.symbol === symbol)?.decimals || 2;
  };

  return (
    <div className="p-3 sm:p-5 lg:p-6 max-w-6xl mx-auto space-y-5 select-none">
      {/* Top Header & Page Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-100 flex items-center gap-2.5">
            <Layers className="w-6 h-6 text-cyan-400" />
            <span>Positions & Orders</span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Track active live contracts and analyze completed trade outcomes in real time.
          </p>
        </div>

        {/* Tab Buttons */}
        <div className="flex items-center gap-1.5 bg-slate-900/90 p-1 rounded-xl border border-slate-800">
          <button
            onClick={() => setActiveTab('open')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'open'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>Open Positions</span>
            {activeTrades.length > 0 && (
              <span className="w-5 h-5 rounded-full bg-cyan-400 text-slate-950 font-bold text-[10px] flex items-center justify-center animate-pulse">
                {activeTrades.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('history')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'history'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>Trade History</span>
            <span className="px-1.5 py-0.5 rounded-full bg-slate-800 text-slate-400 text-[10px] font-mono">
              {completedTrades.length}
            </span>
          </button>
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────
          TAB 1: OPEN POSITIONS
      ───────────────────────────────────────────────────────────── */}
      {activeTab === 'open' && (
        <div className="space-y-4">
          {activeTrades.length === 0 ? (
            /* Empty State for Open Positions */
            <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-10 text-center space-y-4 max-w-lg mx-auto my-8">
              <div className="w-14 h-14 rounded-2xl bg-slate-800/80 border border-slate-700/60 flex items-center justify-center mx-auto text-slate-400 shadow-inner">
                <Clock className="w-7 h-7 text-cyan-400/80" />
              </div>
              <div className="space-y-1.5">
                <h3 className="text-base font-bold text-slate-200">No Open Positions</h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  You currently have no active binary option contracts running. Choose a market, select your contract type, and place a trade to start.
                </p>
              </div>
              <div className="pt-2">
                <button
                  onClick={() => onNavigate('home')}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs tracking-wide transition-colors shadow-lg shadow-cyan-500/20"
                >
                  <span>Go to Trading Terminal</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ) : (
            /* Open Positions Grid / List */
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {activeTrades.map((trade) => {
                const marketDecimals = getMarketDecimals(trade.symbol);
                const marketName = getMarketName(trade.symbol);
                const inProfit = isTradeInProfit(trade);
                const totalTicks = trade.durationTicks;
                const elapsedTicks = totalTicks - trade.remainingTicks;
                const progressPct = Math.min(100, Math.max(0, (elapsedTicks / totalTicks) * 100));

                return (
                  <div
                    key={trade.id}
                    className={`bg-slate-900/80 rounded-xl border p-4 space-y-3.5 transition-all shadow-md ${
                      inProfit
                        ? 'border-emerald-500/40 shadow-emerald-950/20'
                        : 'border-rose-500/40 shadow-rose-950/20'
                    }`}
                  >
                    {/* Header Row: Symbol & Status Pill */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-slate-100">{marketName}</span>
                        <span
                          className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold uppercase ${
                            trade.contractType === 'CALL' || trade.contractType === 'EVEN'
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                              : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                          }`}
                        >
                          {trade.contractType}
                        </span>
                        <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">
                          {trade.mode}
                        </span>
                      </div>

                      <div
                        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold font-mono ${
                          inProfit
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 animate-pulse'
                            : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            inProfit ? 'bg-emerald-400' : 'bg-rose-400'
                          }`}
                        />
                        <span>{inProfit ? 'IN THE MONEY' : 'OUT OF MONEY'}</span>
                      </div>
                    </div>

                    {/* Prices: Entry vs Spot */}
                    <div className="grid grid-cols-2 gap-2 bg-slate-950/60 p-2.5 rounded-lg border border-slate-800/80 text-xs">
                      <div>
                        <span className="text-[10px] text-slate-500 block uppercase font-mono">
                          Entry Price
                        </span>
                        <span className="font-mono font-semibold text-slate-300">
                          {trade.entryPrice.toFixed(marketDecimals)}
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] text-slate-500 block uppercase font-mono">
                          Current Spot
                        </span>
                        <span
                          className={`font-mono font-bold ${
                            inProfit ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {currentQuote.toFixed(marketDecimals)}
                        </span>
                      </div>
                    </div>

                    {/* Financials: Stake & Potential Payout */}
                    <div className="flex items-center justify-between text-xs font-mono">
                      <div>
                        <span className="text-[10px] text-slate-500 block">Stake</span>
                        <span className="text-slate-200 font-bold">${trade.stake.toFixed(2)}</span>
                      </div>
                      <div className="text-center">
                        <span className="text-[10px] text-slate-500 block">Return</span>
                        <span className="text-emerald-400 font-bold">
                          +{Number(trade.payoutRate * 100).toFixed(0)}%
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] text-slate-500 block">Potential Payout</span>
                        <span className="text-cyan-300 font-bold">
                          ${trade.potentialPayout.toFixed(2)}
                        </span>
                      </div>
                    </div>

                    {/* Progress Bar & Countdown */}
                    <div className="space-y-1.5 pt-1">
                      <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
                        <span className="flex items-center gap-1">
                          <Timer className="w-3 h-3 text-cyan-400" />
                          <span>Duration Progress</span>
                        </span>
                        <span className="font-bold text-slate-200">
                          {trade.remainingTicks} / {trade.durationTicks} ticks left
                        </span>
                      </div>
                      <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-cyan-500 to-emerald-400 rounded-full transition-all duration-300"
                          style={{ width: `${progressPct}%` }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          TAB 2: TRADE HISTORY
      ───────────────────────────────────────────────────────────── */}
      {activeTab === 'history' && (
        <div className="space-y-4">
          {/* Summary KPI Cards Bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {/* Total Trades */}
            <div className="bg-slate-900/80 border border-slate-800/80 rounded-xl p-3.5 space-y-1">
              <span className="text-[10px] text-slate-400 uppercase font-mono font-medium block">
                Total Trades
              </span>
              <div className="flex items-baseline justify-between">
                <span className="text-xl font-bold font-mono text-slate-100">{stats.total}</span>
                <span className="text-[11px] text-slate-400 font-mono">
                  {stats.wins}W / {stats.losses}L
                </span>
              </div>
            </div>

            {/* Win Rate */}
            <div className="bg-slate-900/80 border border-slate-800/80 rounded-xl p-3.5 space-y-1">
              <span className="text-[10px] text-slate-400 uppercase font-mono font-medium block">
                Win Rate
              </span>
              <div className="flex items-baseline justify-between">
                <span
                  className={`text-xl font-bold font-mono ${
                    stats.winRate >= 60
                      ? 'text-emerald-400'
                      : stats.winRate >= 40
                      ? 'text-cyan-400'
                      : 'text-slate-300'
                  }`}
                >
                  {stats.winRate.toFixed(1)}%
                </span>
                <Percent className="w-3.5 h-3.5 text-slate-500" />
              </div>
            </div>

            {/* Total Net P&L */}
            <div className="bg-slate-900/80 border border-slate-800/80 rounded-xl p-3.5 space-y-1">
              <span className="text-[10px] text-slate-400 uppercase font-mono font-medium block">
                Net Profit / Loss
              </span>
              <div className="flex items-baseline justify-between">
                <span
                  className={`text-xl font-bold font-mono ${
                    stats.netPL >= 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {stats.netPL >= 0 ? `+$${stats.netPL.toFixed(2)}` : `-$${Math.abs(stats.netPL).toFixed(2)}`}
                </span>
                <DollarSign className="w-3.5 h-3.5 text-slate-500" />
              </div>
            </div>

            {/* Total Volume */}
            <div className="bg-slate-900/80 border border-slate-800/80 rounded-xl p-3.5 space-y-1">
              <span className="text-[10px] text-slate-400 uppercase font-mono font-medium block">
                Total Turnover
              </span>
              <div className="flex items-baseline justify-between">
                <span className="text-xl font-bold font-mono text-slate-100">
                  ${stats.totalVolume.toFixed(2)}
                </span>
                <Activity className="w-3.5 h-3.5 text-slate-500" />
              </div>
            </div>
          </div>

          {/* Filter Bar & Controls */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900/60 p-2.5 rounded-xl border border-slate-800/80">
            <div className="flex items-center gap-2">
              <Filter className="w-3.5 h-3.5 text-slate-400 ml-1" />
              <span className="text-xs font-semibold text-slate-400">Filter:</span>
              <div className="flex bg-slate-950 p-0.5 rounded-lg border border-slate-800 text-xs font-mono">
                {(['all', 'won', 'lost'] as const).map((filter) => (
                  <button
                    key={filter}
                    onClick={() => setHistoryFilter(filter)}
                    className={`px-2.5 py-1 rounded text-[11px] font-semibold uppercase transition-colors ${
                      historyFilter === filter
                        ? 'bg-cyan-500/20 text-cyan-300 font-bold'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {filter}
                  </button>
                ))}
              </div>

              <div className="flex bg-slate-950 p-0.5 rounded-lg border border-slate-800 text-xs font-mono">
                {(['all', 'demo', 'real'] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setModeFilter(mode)}
                    className={`px-2.5 py-1 rounded text-[11px] font-semibold uppercase transition-colors ${
                      modeFilter === mode
                        ? 'bg-cyan-500/20 text-cyan-300 font-bold'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>

            {onClearHistory && completedTrades.length > 0 && (
              <button
                onClick={onClearHistory}
                className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors border border-transparent hover:border-rose-500/20 font-mono"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Clear History</span>
              </button>
            )}
          </div>

          {/* Table / List of Completed Trades */}
          {filteredHistory.length === 0 ? (
            <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-10 text-center space-y-4 max-w-lg mx-auto my-6">
              <div className="w-12 h-12 rounded-2xl bg-slate-800/80 border border-slate-700/60 flex items-center justify-center mx-auto text-slate-400">
                <History className="w-6 h-6 text-slate-400" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-bold text-slate-200">No Trade History Found</h3>
                <p className="text-xs text-slate-400">
                  {completedTrades.length === 0
                    ? 'No contracts have been executed yet in your account.'
                    : 'No trades match the selected filter criteria.'}
                </p>
              </div>
              {completedTrades.length === 0 && (
                <button
                  onClick={() => onNavigate('home')}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs tracking-wide transition-colors"
                >
                  <span>Trade Now</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ) : (
            <div className="bg-slate-900/80 border border-slate-800/80 rounded-xl overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800 bg-slate-950/60 text-[11px] font-mono uppercase text-slate-400">
                      <th className="py-3 px-4 font-semibold">Market / Contract</th>
                      <th className="py-3 px-3 font-semibold">Mode</th>
                      <th className="py-3 px-3 font-semibold">Entry / Exit Spot</th>
                      <th className="py-3 px-3 font-semibold">Stake</th>
                      <th className="py-3 px-3 font-semibold">Outcome</th>
                      <th className="py-3 px-4 font-semibold text-right">Net P&L</th>
                      <th className="py-3 px-4 font-semibold text-right">Date / Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-mono">
                    {filteredHistory.map((trade) => {
                      const isWin = trade.status === 'won';
                      const decimals = getMarketDecimals(trade.symbol);
                      const marketName = getMarketName(trade.symbol);
                      const formattedTime = new Date(trade.exitTime || trade.entryTime).toLocaleTimeString(
                        [],
                        { hour: '2-digit', minute: '2-digit', second: '2-digit' }
                      );
                      const formattedDate = new Date(trade.exitTime || trade.entryTime).toLocaleDateString(
                        [],
                        { month: 'short', day: 'numeric' }
                      );

                      return (
                        <tr
                          key={trade.id}
                          className="hover:bg-slate-800/40 transition-colors"
                        >
                          {/* Symbol & Type */}
                          <td className="py-3 px-4">
                            <div className="flex flex-col">
                              <span className="font-bold text-slate-200 font-sans text-xs">
                                {marketName}
                              </span>
                              <span
                                className={`text-[10px] font-bold ${
                                  trade.contractType === 'CALL' || trade.contractType === 'EVEN'
                                    ? 'text-emerald-400'
                                    : 'text-rose-400'
                                }`}
                              >
                                {trade.contractType}
                              </span>
                            </div>
                          </td>

                          {/* Mode */}
                          <td className="py-3 px-3">
                            <span
                              className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase ${
                                trade.mode === 'real'
                                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                  : 'bg-slate-800 text-slate-300'
                              }`}
                            >
                              {trade.mode}
                            </span>
                          </td>

                          {/* Prices */}
                          <td className="py-3 px-3 text-slate-300">
                            <div className="flex items-center gap-1.5 text-xs">
                              <span>{trade.entryPrice.toFixed(decimals)}</span>
                              <ChevronRight className="w-3 h-3 text-slate-600" />
                              <span className={isWin ? 'text-emerald-300 font-semibold' : 'text-slate-300'}>
                                {trade.exitPrice?.toFixed(decimals) ?? '—'}
                              </span>
                            </div>
                          </td>

                          {/* Stake */}
                          <td className="py-3 px-3 text-slate-300 font-medium">
                            ${trade.stake.toFixed(2)}
                          </td>

                          {/* Outcome Badge */}
                          <td className="py-3 px-3">
                            <span
                              className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                                isWin
                                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                  : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                              }`}
                            >
                              {isWin ? (
                                <>
                                  <CheckCircle2 className="w-3 h-3" />
                                  <span>WIN</span>
                                </>
                              ) : (
                                <>
                                  <XCircle className="w-3 h-3" />
                                  <span>LOSS</span>
                                </>
                              )}
                            </span>
                          </td>

                          {/* Net P&L */}
                          <td className="py-3 px-4 text-right">
                            <span
                              className={`font-bold ${
                                trade.profitLoss >= 0 ? 'text-emerald-400' : 'text-rose-400'
                              }`}
                            >
                              {trade.profitLoss >= 0
                                ? `+$${trade.profitLoss.toFixed(2)}`
                                : `-$${Math.abs(trade.profitLoss).toFixed(2)}`}
                            </span>
                          </td>

                          {/* Date/Time */}
                          <td className="py-3 px-4 text-right text-slate-400 text-[11px]">
                            <div>{formattedTime}</div>
                            <div className="text-[10px] text-slate-500">{formattedDate}</div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
