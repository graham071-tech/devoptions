import React, { useState, useMemo } from 'react';
import { Trade, Tick } from '../../types/trading';
import { extractLastDigit } from '../../utils/indicators';
import {
  Clock,
  CheckCircle2,
  XCircle,
  Activity,
  History,
  TrendingUp,
  BarChart2,
  Sliders,
  DollarSign,
  ArrowUp,
  ArrowDown,
  Info,
} from 'lucide-react';

interface BottomTradingPanelProps {
  activeTrades: Trade[];
  completedTrades: Trade[];
  currentQuote: number;
  decimals: number;
  tradingMode: 'demo' | 'real';
  recentTicks: Tick[];
}

export const BottomTradingPanel: React.FC<BottomTradingPanelProps> = ({
  activeTrades,
  completedTrades,
  currentQuote,
  decimals,
  tradingMode,
  recentTicks,
}) => {
  const [activeTab, setActiveTab] = useState<
    'open' | 'completed' | 'history' | 'summary' | 'stats'
  >('open');

  // Session summary calculations
  const sessionStats = useMemo(() => {
    const wins = completedTrades.filter((t) => t.status === 'won').length;
    const losses = completedTrades.filter((t) => t.status === 'lost').length;
    const total = completedTrades.length;
    const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) : '0.0';
    const netPnl = completedTrades.reduce((sum, t) => sum + (t.profitLoss || 0), 0);
    const totalStake = completedTrades.reduce((sum, t) => sum + t.stake, 0);

    // Consecutive streaks
    let maxWins = 0;
    let maxLosses = 0;
    let currWins = 0;
    let currLosses = 0;
    completedTrades.forEach((t) => {
      if (t.status === 'won') {
        currWins++;
        currLosses = 0;
        if (currWins > maxWins) maxWins = currWins;
      } else {
        currLosses++;
        currWins = 0;
        if (currLosses > maxLosses) maxLosses = currLosses;
      }
    });

    const grossProfit = completedTrades
      .filter((t) => t.status === 'won')
      .reduce((sum, t) => sum + t.profitLoss, 0);
    const grossLoss = completedTrades
      .filter((t) => t.status === 'lost')
      .reduce((sum, t) => sum + Math.abs(t.profitLoss), 0);
    const profitFactor = grossLoss > 0 ? (grossProfit / grossLoss).toFixed(2) : grossProfit > 0 ? '99.9' : '0.00';

    return {
      wins,
      losses,
      total,
      winRate,
      netPnl: Number(netPnl.toFixed(2)),
      totalStake: Number(totalStake.toFixed(2)),
      maxWins,
      maxLosses,
      profitFactor,
    };
  }, [completedTrades]);

  // Last digits calculation from recent ticks
  const digitCounts = useMemo(() => {
    const counts = Array(10).fill(0);
    const sample = recentTicks.slice(0, 100);
    sample.forEach((t) => {
      const d = extractLastDigit(t.quote, decimals);
      counts[d]++;
    });
    const total = Math.max(sample.length, 1);
    const percentages = counts.map((c) => Number(((c / total) * 100).toFixed(1)));
    return { counts, percentages, sampleCount: sample.length };
  }, [recentTicks, decimals]);

  return (
    <div className="bg-[#090D16] border border-slate-800 rounded-xl overflow-hidden shadow-lg flex flex-col">
      {/* Top Tab Switcher */}
      <div className="flex flex-wrap items-center justify-between px-3 py-2 bg-slate-900/80 border-b border-slate-800 text-xs">
        <div className="flex items-center gap-1 overflow-x-auto">
          <button
            onClick={() => setActiveTab('open')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold text-xs transition-colors ${
              activeTab === 'open'
                ? 'bg-slate-800 text-cyan-300 shadow-sm border border-slate-700/80'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>Open Positions</span>
            {activeTrades.length > 0 && (
              <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-cyan-500/20 text-cyan-300 font-mono font-bold">
                {activeTrades.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('completed')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold text-xs transition-colors ${
              activeTab === 'completed'
                ? 'bg-slate-800 text-cyan-300 shadow-sm border border-slate-700/80'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Completed Trades</span>
            {completedTrades.length > 0 && (
              <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-slate-800 text-slate-300 font-mono">
                {completedTrades.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('summary')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold text-xs transition-colors ${
              activeTab === 'summary'
                ? 'bg-slate-800 text-cyan-300 shadow-sm border border-slate-700/80'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <TrendingUp className="w-3.5 h-3.5" />
            <span>Session Summary</span>
          </button>

          <button
            onClick={() => setActiveTab('stats')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold text-xs transition-colors ${
              activeTab === 'stats'
                ? 'bg-slate-800 text-cyan-300 shadow-sm border border-slate-700/80'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <BarChart2 className="w-3.5 h-3.5" />
            <span>Last-Digit Tape & Stats</span>
          </button>
        </div>

        <div className="flex items-center gap-2 text-[11px] font-mono text-slate-400">
          <span className="text-slate-500">Mode:</span>
          <span className="font-bold text-slate-200 uppercase">{tradingMode}</span>
        </div>
      </div>

      {/* Tab Panels */}
      <div className="p-3 min-h-[160px] max-h-[260px] overflow-y-auto">
        {/* Open Positions Tab */}
        {activeTab === 'open' && (
          <div>
            {activeTrades.length > 0 ? (
              <div className="divide-y divide-slate-800/80">
                <table className="w-full text-left text-xs font-mono">
                  <thead className="bg-slate-950/60 text-[10px] text-slate-400 font-sans border-b border-slate-800">
                    <tr>
                      <th className="py-2 px-3">Contract</th>
                      <th className="py-2 px-3">Instrument</th>
                      <th className="py-2 px-3">Entry Spot</th>
                      <th className="py-2 px-3">Current Spot</th>
                      <th className="py-2 px-3">Ticks Left</th>
                      <th className="py-2 px-3">Stake</th>
                      <th className="py-2 px-3 text-right">Potential Profit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/40 text-[11px]">
                    {activeTrades.map((trade) => {
                      const isCall = trade.contractType === 'CALL';
                      const isWinning = isCall
                        ? currentQuote > trade.entryPrice
                        : currentQuote < trade.entryPrice;
                      const progressPct =
                        ((trade.durationTicks - trade.remainingTicks) / trade.durationTicks) * 100;

                      return (
                        <tr key={trade.id} className="hover:bg-slate-900/40 transition-colors">
                          <td className="py-2.5 px-3 font-sans">
                            <span
                              className={`inline-flex items-center gap-1 font-bold px-2 py-0.5 rounded text-[10px] ${
                                isCall
                                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                                  : 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                              }`}
                            >
                              {isCall ? (
                                <ArrowUp className="w-3 h-3" />
                              ) : (
                                <ArrowDown className="w-3 h-3" />
                              )}
                              {trade.contractType}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 font-semibold text-slate-200">
                            {trade.symbol}
                          </td>
                          <td className="py-2.5 px-3 text-slate-300">
                            {trade.entryPrice.toFixed(decimals)}
                          </td>
                          <td
                            className={`py-2.5 px-3 font-bold ${
                              isWinning ? 'text-emerald-400' : 'text-rose-400'
                            }`}
                          >
                            {currentQuote.toFixed(decimals)}
                          </td>
                          <td className="py-2.5 px-3">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-cyan-400">
                                {trade.remainingTicks}t
                              </span>
                              <div className="w-16 bg-slate-800 rounded-full h-1 overflow-hidden">
                                <div
                                  className="bg-cyan-400 h-full transition-all duration-300"
                                  style={{ width: `${progressPct}%` }}
                                />
                              </div>
                            </div>
                          </td>
                          <td className="py-2.5 px-3 text-slate-200">${trade.stake}</td>
                          <td className="py-2.5 px-3 text-right font-bold text-emerald-400">
                            +${(trade.potentialPayout - trade.stake).toFixed(2)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="py-10 text-center text-slate-500 text-xs font-mono space-y-1">
                <p>No open positions in flight.</p>
                <p className="text-[11px] text-slate-600 font-sans">
                  Choose your trade direction (Rise or Fall) in the right panel to execute an order.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Completed Trades Tab */}
        {activeTab === 'completed' && (
          <div>
            {completedTrades.length > 0 ? (
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-slate-950/60 text-[10px] text-slate-400 font-sans border-b border-slate-800 sticky top-0">
                  <tr>
                    <th className="py-2 px-3">Time</th>
                    <th className="py-2 px-3">Instrument</th>
                    <th className="py-2 px-3">Contract</th>
                    <th className="py-2 px-3">Entry</th>
                    <th className="py-2 px-3">Exit</th>
                    <th className="py-2 px-3">Stake</th>
                    <th className="py-2 px-3">Result</th>
                    <th className="py-2 px-3 text-right">Net Return</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/40 text-[11px]">
                  {completedTrades.slice(0, 20).map((t) => (
                    <tr key={t.id} className="hover:bg-slate-900/40 transition-colors">
                      <td className="py-2 px-3 text-slate-400">
                        {new Date(t.entryTime).toLocaleTimeString()}
                      </td>
                      <td className="py-2 px-3 font-semibold text-slate-200">{t.symbol}</td>
                      <td className="py-2 px-3 font-sans font-medium text-slate-300">
                        {t.contractType}
                      </td>
                      <td className="py-2 px-3 text-slate-300">{t.entryPrice.toFixed(decimals)}</td>
                      <td className="py-2 px-3 text-slate-300">
                        {t.exitPrice ? t.exitPrice.toFixed(decimals) : '--'}
                      </td>
                      <td className="py-2 px-3 text-slate-300">${t.stake}</td>
                      <td className="py-2 px-3">
                        <span
                          className={`inline-flex items-center gap-1 font-sans font-semibold text-[11px] ${
                            t.status === 'won' ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {t.status === 'won' ? (
                            <CheckCircle2 className="w-3.5 h-3.5" />
                          ) : (
                            <XCircle className="w-3.5 h-3.5" />
                          )}
                          <span>{t.status === 'won' ? 'Won' : 'Lost'}</span>
                        </span>
                      </td>
                      <td
                        className={`py-2 px-3 text-right font-bold ${
                          t.profitLoss >= 0 ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {t.profitLoss >= 0 ? '+' : ''}${t.profitLoss}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="py-10 text-center text-slate-500 text-xs font-mono">
                No trades completed in this session yet.
              </div>
            )}
          </div>
        )}

        {/* Session Summary Tab */}
        {activeTab === 'summary' && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 py-1">
            <div className="p-3 bg-slate-900/60 rounded-lg border border-slate-800 space-y-1">
              <span className="text-[10px] text-slate-400 block">Session Win Rate</span>
              <div className="flex items-center gap-2">
                <span
                  className={`font-mono text-xl font-bold ${
                    Number(sessionStats.winRate) >= 50 ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {sessionStats.winRate}%
                </span>
                <span className="text-[11px] font-mono text-slate-500">
                  ({sessionStats.wins}W / {sessionStats.losses}L)
                </span>
              </div>
            </div>

            <div className="p-3 bg-slate-900/60 rounded-lg border border-slate-800 space-y-1">
              <span className="text-[10px] text-slate-400 block">Net Session P&L</span>
              <p
                className={`font-mono text-xl font-bold ${
                  sessionStats.netPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {sessionStats.netPnl >= 0 ? '+' : ''}${sessionStats.netPnl}
              </p>
            </div>

            <div className="p-3 bg-slate-900/60 rounded-lg border border-slate-800 space-y-1">
              <span className="text-[10px] text-slate-400 block">Profit Factor</span>
              <p className="font-mono text-xl font-bold text-cyan-400">
                {sessionStats.profitFactor}
              </p>
            </div>

            <div className="p-3 bg-slate-900/60 rounded-lg border border-slate-800 space-y-1">
              <span className="text-[10px] text-slate-400 block">Best Winning Streak</span>
              <p className="font-mono text-xl font-bold text-amber-400">
                {sessionStats.maxWins} Consecutive
              </p>
            </div>
          </div>
        )}

        {/* Market Stats & Last Digits Tab */}
        {activeTab === 'stats' && (
          <div className="space-y-3 py-1">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>Last 100 Ticks Terminal Digit Distribution (0 to 9)</span>
              <span className="font-mono text-[10px] text-slate-500">
                Sample: {digitCounts.sampleCount} ticks
              </span>
            </div>

            <div className="grid grid-cols-10 gap-1.5">
              {digitCounts.counts.map((count, d) => {
                const pct = digitCounts.percentages[d];
                return (
                  <div
                    key={d}
                    className="p-1.5 rounded bg-slate-900/90 border border-slate-800 text-center space-y-1"
                  >
                    <span className="font-mono text-[10px] text-slate-400 block">{pct}%</span>
                    <span
                      className={`inline-block w-5 h-5 leading-5 rounded font-mono font-bold text-xs ${
                        d % 2 === 0
                          ? 'bg-emerald-950/60 text-emerald-300'
                          : 'bg-indigo-950/60 text-indigo-300'
                      }`}
                    >
                      {d}
                    </span>
                    <span className="text-[9px] text-slate-500 font-mono block">{count}x</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
