import React, { useState, useMemo } from 'react';
import { PageId, Trade } from '../../types/trading';
import { storage } from '../../services/storage';
import { useToast } from '../common/ToastNotification';
import {
  History,
  Download,
  Trash2,
  CheckCircle2,
  XCircle,
  Filter,
  TrendingUp,
  DollarSign,
  Activity,
} from 'lucide-react';

interface TradeHistoryProps {
  onNavigate: (page: PageId) => void;
}

export const TradeHistory: React.FC<TradeHistoryProps> = ({ onNavigate }) => {
  const { showToast } = useToast();
  const [trades, setTrades] = useState<Trade[]>(() => storage.getTradeHistory());
  const [statusFilter, setStatusFilter] = useState<'all' | 'won' | 'lost' | 'active'>('all');
  const [symbolFilter, setSymbolFilter] = useState<string>('all');

  // Summary Metrics
  const summary = useMemo(() => {
    const completed = trades.filter((t) => t.status !== 'active');
    const wins = completed.filter((t) => t.status === 'won').length;
    const losses = completed.filter((t) => t.status === 'lost').length;
    const total = completed.length;
    const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) : '0.0';
    const netPnl = completed.reduce((sum, t) => sum + (t.profitLoss || 0), 0);
    const totalVolume = trades.reduce((sum, t) => sum + (t.stake || 0), 0);

    return {
      total,
      wins,
      losses,
      winRate,
      netPnl: Number(netPnl.toFixed(2)),
      totalVolume: Number(totalVolume.toFixed(2)),
    };
  }, [trades]);

  // Unique symbols for filter
  const symbols = useMemo(() => {
    const set = new Set(trades.map((t) => t.symbol));
    return Array.from(set);
  }, [trades]);

  // Filtered trades
  const filteredTrades = useMemo(() => {
    return trades.filter((t) => {
      if (statusFilter !== 'all' && t.status !== statusFilter) return false;
      if (symbolFilter !== 'all' && t.symbol !== symbolFilter) return false;
      return true;
    });
  }, [trades, statusFilter, symbolFilter]);

  // Export CSV
  const handleExportCSV = () => {
    if (trades.length === 0) {
      showToast('error', 'Empty History', 'No trade executions to export.');
      return;
    }

    const headers = [
      'Order ID',
      'Date UTC',
      'Symbol',
      'Contract Type',
      'Mode',
      'Stake',
      'Entry Spot',
      'Exit Spot',
      'Status',
      'Net PnL',
    ];

    const rows = trades.map((t) => [
      t.id,
      new Date(t.entryTime).toISOString(),
      t.symbol,
      t.contractType,
      t.mode,
      t.stake,
      t.entryPrice,
      t.exitPrice || '',
      t.status,
      t.profitLoss,
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `stratum_trade_history_${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    showToast('success', 'History Exported', `Exported ${trades.length} trade records.`);
  };

  // Clear History
  const handleClearHistory = () => {
    if (confirm('Clear entire simulated trade history? This action cannot be reversed.')) {
      storage.clearTradeHistory();
      setTrades([]);
      showToast('info', 'History Cleared', 'All trade records deleted.');
    }
  };

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2.5">
            <History className="w-5 h-5 text-cyan-400" />
            <h2 className="text-xl font-bold tracking-tight text-slate-100">
              Trade Execution History & Audit Log
            </h2>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Complete record of simulated demo and authorized contracts with entry/exit spot settlements
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleExportCSV}
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold border border-slate-700/60 transition-colors"
          >
            <Download className="w-3.5 h-3.5 text-cyan-400" />
            <span>Export CSV</span>
          </button>

          <button
            onClick={handleClearHistory}
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-rose-950/60 text-slate-300 hover:text-rose-300 rounded-lg text-xs font-semibold border border-slate-700/60 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Clear Log</span>
          </button>
        </div>
      </div>

      {/* KPI Summary Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-3.5 bg-[#090D16] border border-slate-800 rounded-xl space-y-1">
          <span className="text-[11px] text-slate-400">Total Settled Trades</span>
          <p className="font-mono text-xl font-bold text-slate-100">{summary.total}</p>
        </div>

        <div className="p-3.5 bg-[#090D16] border border-slate-800 rounded-xl space-y-1">
          <span className="text-[11px] text-slate-400">Win Rate</span>
          <div className="flex items-center gap-2">
            <span
              className={`font-mono text-xl font-bold ${
                Number(summary.winRate) >= 50 ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {summary.winRate}%
            </span>
            <span className="text-[11px] text-slate-500 font-mono">
              ({summary.wins}W / {summary.losses}L)
            </span>
          </div>
        </div>

        <div className="p-3.5 bg-[#090D16] border border-slate-800 rounded-xl space-y-1">
          <span className="text-[11px] text-slate-400">Cumulative Net P&L</span>
          <p
            className={`font-mono text-xl font-bold ${
              summary.netPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            {summary.netPnl >= 0 ? '+' : ''}${summary.netPnl}
          </p>
        </div>

        <div className="p-3.5 bg-[#090D16] border border-slate-800 rounded-xl space-y-1">
          <span className="text-[11px] text-slate-400">Total Volume Staked</span>
          <p className="font-mono text-xl font-bold text-cyan-400">${summary.totalVolume}</p>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-[#090D16] border border-slate-800 rounded-xl p-3">
        {/* Status Filter */}
        <div className="flex items-center bg-slate-900 p-1 rounded-lg border border-slate-800">
          {(['all', 'won', 'lost', 'active'] as const).map((st) => (
            <button
              key={st}
              onClick={() => setStatusFilter(st)}
              className={`px-3 py-1 text-xs font-semibold rounded-md capitalize transition-colors ${
                statusFilter === st
                  ? 'bg-slate-800 text-slate-100 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {st}
            </button>
          ))}
        </div>

        {/* Symbol Filter */}
        {symbols.length > 0 && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-400 font-medium">Filter Symbol:</span>
            <select
              value={symbolFilter}
              onChange={(e) => setSymbolFilter(e.target.value)}
              className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1 text-slate-100 font-mono text-xs focus:outline-none focus:border-cyan-500"
            >
              <option value="all">All Instruments</option>
              {symbols.map((sym) => (
                <option key={sym} value={sym}>
                  {sym}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Trade Log Table */}
      <div className="bg-[#090D16] border border-slate-800 rounded-xl overflow-hidden">
        {filteredTrades.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-slate-900/90 text-[11px] text-slate-400 font-sans border-b border-slate-800">
                <tr>
                  <th className="py-2.5 px-3">Time</th>
                  <th className="py-2.5 px-3">Instrument</th>
                  <th className="py-2.5 px-3">Contract</th>
                  <th className="py-2.5 px-3">Entry Spot</th>
                  <th className="py-2.5 px-3">Exit Spot</th>
                  <th className="py-2.5 px-3">Stake</th>
                  <th className="py-2.5 px-3">Result</th>
                  <th className="py-2.5 px-3 text-right">Net P&L</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-[11px]">
                {filteredTrades.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-900/40 transition-colors">
                    <td className="py-2.5 px-3 text-slate-400">
                      {new Date(t.entryTime).toLocaleTimeString()}
                    </td>
                    <td className="py-2.5 px-3 font-bold text-slate-200">{t.symbol}</td>
                    <td className="py-2.5 px-3 text-slate-300 font-sans font-medium">
                      {t.contractType}
                    </td>
                    <td className="py-2.5 px-3 text-slate-300">{t.entryPrice}</td>
                    <td className="py-2.5 px-3 text-slate-300">{t.exitPrice ?? '--'}</td>
                    <td className="py-2.5 px-3 text-slate-300">${t.stake}</td>
                    <td className="py-2.5 px-3 font-sans">
                      <span
                        className={`inline-flex items-center gap-1 font-semibold ${
                          t.status === 'won'
                            ? 'text-emerald-400'
                            : t.status === 'lost'
                            ? 'text-rose-400'
                            : 'text-amber-400'
                        }`}
                      >
                        {t.status === 'won' ? (
                          <CheckCircle2 className="w-3.5 h-3.5" />
                        ) : t.status === 'lost' ? (
                          <XCircle className="w-3.5 h-3.5" />
                        ) : (
                          <Activity className="w-3.5 h-3.5 animate-pulse" />
                        )}
                        <span className="capitalize">{t.status}</span>
                      </span>
                    </td>
                    <td
                      className={`py-2.5 px-3 text-right font-bold ${
                        t.profitLoss >= 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {t.profitLoss >= 0 ? '+' : ''}${t.profitLoss}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-12 text-center text-slate-500 text-xs font-mono space-y-2">
            <p>No trade execution records matching selected criteria.</p>
            <button
              onClick={() => onNavigate('trading')}
              className="text-cyan-400 hover:text-cyan-300 font-sans font-semibold underline text-xs"
            >
              Open Demo Trading Terminal
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
