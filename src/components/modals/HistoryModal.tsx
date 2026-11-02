import React, { useState, useMemo, useEffect } from 'react';
import { Trade, Transaction } from '../../types/trading';
import { SYNTHETIC_MARKETS } from '../../data/syntheticMarkets';
import { storage } from '../../services/storage';
import { paynectaClient, PaynectaDeposit } from '../../services/paynectaClient';
import {
  X,
  History,
  CheckCircle2,
  XCircle,
  Filter,
  Trash2,
  ArrowDownLeft,
  ArrowUpRight,
  DollarSign,
  Percent,
  Activity,
  Layers,
  ChevronRight,
  CreditCard,
  Building,
  Smartphone,
  RefreshCw,
} from 'lucide-react';

interface HistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  trades: Trade[];
  onClearHistory?: () => void;
}

export const HistoryModal: React.FC<HistoryModalProps> = ({
  isOpen,
  onClose,
  trades,
  onClearHistory,
}) => {
  const [activeTab, setActiveTab] = useState<'all' | 'trades' | 'payments'>('all');
  const [outcomeFilter, setOutcomeFilter] = useState<'all' | 'won' | 'lost'>('all');
  const [modeFilter, setModeFilter] = useState<'all' | 'demo' | 'real'>('all');
  const [paymentStatusFilter, setPaymentStatusFilter] = useState<'all' | 'succeeded' | 'pending' | 'failed'>('all');
  const [serverDeposits, setServerDeposits] = useState<PaynectaDeposit[]>([]);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);

  const localTransactions = useMemo(() => {
    return storage.getTransactions();
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      loadServerDeposits();
    }
  }, [isOpen]);

  const loadServerDeposits = async () => {
    try {
      const deposits = await paynectaClient.getDepositHistory();
      setServerDeposits(deposits);
    } catch (err) {
      console.warn('Could not load server deposit history in modal:', err);
    }
  };

  const handleVerifyPending = async (depositId: string) => {
    setVerifyingId(depositId);
    try {
      await paynectaClient.verifyDeposit(depositId);
      await loadServerDeposits();
    } catch (err) {
      console.error('Error verifying pending deposit:', err);
    } finally {
      setVerifyingId(null);
    }
  };

  if (!isOpen) return null;

  // Filtered trades
  const filteredTrades = trades.filter((t) => {
    if (outcomeFilter === 'won' && t.status !== 'won') return false;
    if (outcomeFilter === 'lost' && t.status !== 'lost') return false;
    if (modeFilter !== 'all' && t.mode !== modeFilter) return false;
    return true;
  });

  // Summary Metrics
  const totalTradesCount = filteredTrades.length;
  const wins = filteredTrades.filter((t) => t.status === 'won').length;
  const losses = filteredTrades.filter((t) => t.status === 'lost').length;
  const winRate = totalTradesCount > 0 ? (wins / totalTradesCount) * 100 : 0;
  const totalPnl = filteredTrades.reduce((acc, t) => acc + (t.profitLoss || 0), 0);
  const totalDeposited = useMemo(() => {
    const serverTotal = serverDeposits
      .filter((d) => d.status === 'succeeded')
      .reduce((acc, d) => acc + d.amountUsd, 0);
    const localTotal = localTransactions
      .filter((tx: Transaction) => tx.type === 'deposit' && tx.status === 'completed')
      .reduce((acc: number, tx: Transaction) => acc + tx.netAmountUSD, 0);
    return serverTotal > 0 ? serverTotal : localTotal;
  }, [serverDeposits, localTransactions]);

  const getMarketName = (symbol: string) => {
    return SYNTHETIC_MARKETS.find((m) => m.symbol === symbol)?.displayName || symbol;
  };

  const getMarketDecimals = (symbol: string) => {
    return SYNTHETIC_MARKETS.find((m) => m.symbol === symbol)?.decimals || 2;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-[#090D16] border border-slate-800 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/60">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
              <History className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100">
                Account & Execution History
              </h2>
              <p className="text-[11px] text-slate-400">
                Authoritative record of completed trades, deposits, and withdrawals
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

        {/* Tab Switcher & Metric Ribbon */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 p-4 border-b border-slate-800/80 bg-slate-950/40">
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3">
            <span className="text-[10px] text-slate-400 uppercase font-mono block">
              Settled Trades
            </span>
            <div className="flex items-baseline justify-between mt-0.5">
              <span className="font-mono text-lg font-bold text-slate-100">{totalTradesCount}</span>
              <span className="text-[11px] text-slate-400 font-mono">
                {wins}W • {losses}L
              </span>
            </div>
          </div>

          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3">
            <span className="text-[10px] text-slate-400 uppercase font-mono block">Win Rate</span>
            <div className="flex items-baseline justify-between mt-0.5">
              <span
                className={`font-mono text-lg font-bold ${
                  winRate >= 60 ? 'text-emerald-400' : 'text-cyan-300'
                }`}
              >
                {winRate.toFixed(1)}%
              </span>
              <Percent className="w-3.5 h-3.5 text-slate-500" />
            </div>
          </div>

          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3">
            <span className="text-[10px] text-slate-400 uppercase font-mono block">
              Net Trade P&L
            </span>
            <div className="flex items-baseline justify-between mt-0.5">
              <span
                className={`font-mono text-lg font-bold ${
                  totalPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {totalPnl >= 0 ? `+$${totalPnl.toFixed(2)}` : `-$${Math.abs(totalPnl).toFixed(2)}`}
              </span>
              <DollarSign className="w-3.5 h-3.5 text-slate-500" />
            </div>
          </div>

          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-3">
            <span className="text-[10px] text-slate-400 uppercase font-mono block">
              Total Deposits
            </span>
            <div className="flex items-baseline justify-between mt-0.5">
              <span className="font-mono text-lg font-bold text-slate-100">
                ${totalDeposited.toFixed(2)}
              </span>
              <Activity className="w-3.5 h-3.5 text-slate-500" />
            </div>
          </div>
        </div>

        {/* View Selection & Filter Ribbon */}
        <div className="px-5 py-2.5 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800">
            <button
              onClick={() => setActiveTab('all')}
              className={`px-3 py-1 rounded-lg font-semibold transition-colors ${
                activeTab === 'all'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              All Records
            </button>
            <button
              onClick={() => setActiveTab('trades')}
              className={`px-3 py-1 rounded-lg font-semibold transition-colors ${
                activeTab === 'trades'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Trades ({trades.length})
            </button>
            <button
              onClick={() => {
                setActiveTab('payments');
                loadServerDeposits();
              }}
              className={`px-3 py-1 rounded-lg font-semibold transition-colors ${
                activeTab === 'payments'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Deposits & Payments ({serverDeposits.length || localTransactions.length})
            </button>
          </div>

          {activeTab === 'payments' ? (
            <div className="flex items-center gap-2">
              <Filter className="w-3.5 h-3.5 text-slate-400" />
              <div className="flex bg-slate-950 p-0.5 rounded-lg border border-slate-800 font-mono text-[11px]">
                {(['all', 'succeeded', 'pending', 'failed'] as const).map((st) => (
                  <button
                    key={st}
                    onClick={() => setPaymentStatusFilter(st)}
                    className={`px-2 py-0.5 rounded uppercase font-semibold transition-colors cursor-pointer ${
                      paymentStatusFilter === st
                        ? 'bg-cyan-500/20 text-cyan-300 font-bold'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {st}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Filter className="w-3.5 h-3.5 text-slate-400" />
              <div className="flex bg-slate-950 p-0.5 rounded-lg border border-slate-800 font-mono text-[11px]">
                {(['all', 'won', 'lost'] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setOutcomeFilter(mode)}
                    className={`px-2 py-0.5 rounded uppercase font-semibold transition-colors cursor-pointer ${
                      outcomeFilter === mode
                        ? 'bg-cyan-500/20 text-cyan-300 font-bold'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Table View */}
        <div className="flex-1 overflow-y-auto">
          {activeTab === 'payments' ? (
            /* Transactions & Server Deposits Table */
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-950/70 text-[10px] font-mono uppercase text-slate-400 sticky top-0">
                    <th className="py-2.5 px-4 font-semibold">Type</th>
                    <th className="py-2.5 px-3 font-semibold">Gateway / Provider</th>
                    <th className="py-2.5 px-3 font-semibold">Amount (KES / USD)</th>
                    <th className="py-2.5 px-3 font-semibold">Status</th>
                    <th className="py-2.5 px-4 font-semibold">Reference</th>
                    <th className="py-2.5 px-4 font-semibold text-right">Date / Time</th>
                    <th className="py-2.5 px-4 font-semibold text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono">
                  {serverDeposits
                    .filter((d) => {
                      if (paymentStatusFilter === 'all') return true;
                      if (paymentStatusFilter === 'succeeded') return d.status === 'succeeded';
                      if (paymentStatusFilter === 'pending') return d.status === 'pending' || d.status === 'verifying';
                      if (paymentStatusFilter === 'failed') return d.status === 'failed' || d.status === 'cancelled';
                      return true;
                    })
                    .map((d) => {
                      const isSucceeded = d.status === 'succeeded';
                      const isPending = d.status === 'pending' || d.status === 'verifying';
                      const isCancelled = d.status === 'cancelled';
                      const isFailed = d.status === 'failed';

                      return (
                        <tr key={d.id} className="hover:bg-slate-850/50 transition-colors">
                          <td className="py-2.5 px-4">
                            <span className="inline-flex items-center gap-1 font-bold text-emerald-400">
                              <ArrowDownLeft className="w-3.5 h-3.5" />
                              <span>Deposit</span>
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-slate-300">
                            <div className="font-sans font-medium text-slate-200">Paynecta M-Pesa</div>
                            <div className="text-[10px] text-slate-400">Kenyan Shillings</div>
                          </td>
                          <td className="py-2.5 px-3 font-bold text-slate-100">
                            <div>KES {d.amountKes.toLocaleString()}</div>
                            <div className="text-[10px] text-emerald-400 font-normal">
                              ≈ ${d.amountUsd.toFixed(2)} USD
                            </div>
                          </td>
                          <td className="py-2.5 px-3">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase border ${
                                isSucceeded
                                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                                  : isPending
                                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                                  : isCancelled
                                  ? 'bg-slate-800 text-slate-400 border-slate-700'
                                  : 'bg-rose-500/20 text-rose-300 border-rose-500/30'
                              }`}
                            >
                              {d.status === 'verification_delayed' ? 'Delayed' : d.status}
                            </span>
                          </td>
                          <td className="py-2.5 px-4 text-slate-400 text-[10px]">
                            <div className="text-slate-300">{d.merchantReference}</div>
                            {d.receiptNumber && (
                              <div className="text-emerald-400 text-[9px]">Receipt: {d.receiptNumber}</div>
                            )}
                          </td>
                          <td className="py-2.5 px-4 text-right text-slate-400 text-[11px]">
                            {new Date(d.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}{' '}
                            {new Date(d.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </td>
                          <td className="py-2.5 px-4 text-right">
                            {isPending && (
                              <button
                                type="button"
                                disabled={verifyingId === d.id}
                                onClick={() => handleVerifyPending(d.id)}
                                className="px-2 py-1 rounded bg-cyan-950 text-cyan-300 border border-cyan-800 text-[10px] font-bold hover:bg-cyan-900 transition-colors cursor-pointer inline-flex items-center gap-1"
                              >
                                {verifyingId === d.id ? (
                                  <RefreshCw className="w-3 h-3 animate-spin" />
                                ) : (
                                  <span>Verify</span>
                                )}
                              </button>
                            )}
                            {isSucceeded && (
                              <span className="text-[10px] text-emerald-400 font-mono">Credited</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}

                  {serverDeposits.length === 0 &&
                    localTransactions.map((tx) => {
                      const isDeposit = tx.type === 'deposit';
                      return (
                        <tr key={tx.id} className="hover:bg-slate-850/50 transition-colors">
                          <td className="py-2.5 px-4">
                            <span
                              className={`inline-flex items-center gap-1 font-bold ${
                                isDeposit ? 'text-emerald-400' : 'text-cyan-400'
                              }`}
                            >
                              {isDeposit ? <ArrowDownLeft className="w-3.5 h-3.5" /> : <ArrowUpRight className="w-3.5 h-3.5" />}
                              <span className="capitalize">{tx.type}</span>
                            </span>
                          </td>
                          <td className="py-2.5 px-3 uppercase text-slate-300">
                            {tx.method === 'mpesa' ? 'M-Pesa (KES)' : tx.method === 'card' ? 'Bank Card' : 'Bank Wire'}
                          </td>
                          <td className="py-2.5 px-3 font-bold text-slate-100">
                            ${tx.netAmountUSD.toFixed(2)} USD
                          </td>
                          <td className="py-2.5 px-3">
                            <span className="px-2 py-0.5 rounded-full text-[9px] font-bold uppercase bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                              {tx.status}
                            </span>
                          </td>
                          <td className="py-2.5 px-4 text-slate-400 text-[10px]">
                            {tx.reference}
                          </td>
                          <td className="py-2.5 px-4 text-right text-slate-400 text-[11px]">
                            {new Date(tx.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </td>
                          <td className="py-2.5 px-4 text-right">
                            <span className="text-[10px] text-emerald-400 font-mono">Completed</span>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          ) : (
            /* Trades Table */
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-950/70 text-[10px] font-mono uppercase text-slate-400 sticky top-0">
                    <th className="py-2.5 px-4 font-semibold">Trade ID</th>
                    <th className="py-2.5 px-3 font-semibold">Market / Type</th>
                    <th className="py-2.5 px-3 font-semibold">Mode</th>
                    <th className="py-2.5 px-3 font-semibold">Entry / Exit</th>
                    <th className="py-2.5 px-3 font-semibold">Stake</th>
                    <th className="py-2.5 px-3 font-semibold">Outcome</th>
                    <th className="py-2.5 px-4 font-semibold text-right">Net P&L</th>
                    <th className="py-2.5 px-4 font-semibold text-right">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono">
                  {filteredTrades.map((trade) => {
                    const isWin = trade.status === 'won';
                    const decimals = getMarketDecimals(trade.symbol);
                    const marketName = getMarketName(trade.symbol);
                    const timeStr = new Date(trade.exitTime || trade.entryTime).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    });

                    return (
                      <tr key={trade.id} className="hover:bg-slate-850/50 transition-colors">
                        <td className="py-2.5 px-4 text-slate-500 text-[10px]">
                          {trade.id.slice(-8)}
                        </td>

                        <td className="py-2.5 px-3">
                          <div className="font-sans font-bold text-slate-200">{marketName}</div>
                          <div
                            className={`text-[10px] font-bold ${
                              trade.contractType === 'CALL' || trade.contractType === 'EVEN'
                                ? 'text-emerald-400'
                                : 'text-rose-400'
                            }`}
                          >
                            {trade.contractType}
                          </div>
                        </td>

                        <td className="py-2.5 px-3">
                          <span
                            className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase ${
                              trade.mode === 'real'
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                : 'bg-slate-800 text-slate-400'
                            }`}
                          >
                            {trade.mode}
                          </span>
                        </td>

                        <td className="py-2.5 px-3 text-slate-300 text-xs">
                          <div className="flex items-center gap-1">
                            <span>{trade.entryPrice.toFixed(decimals)}</span>
                            <ChevronRight className="w-3 h-3 text-slate-600" />
                            <span className={isWin ? 'text-emerald-300' : 'text-slate-300'}>
                              {trade.exitPrice?.toFixed(decimals) ?? '—'}
                            </span>
                          </div>
                        </td>

                        <td className="py-2.5 px-3 text-slate-300 font-medium">
                          ${trade.stake.toFixed(2)}
                        </td>

                        <td className="py-2.5 px-3">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${
                              isWin
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                            }`}
                          >
                            {isWin ? 'WIN' : 'LOSS'}
                          </span>
                        </td>

                        <td className="py-2.5 px-4 text-right font-bold">
                          <span className={trade.profitLoss >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                            {trade.profitLoss >= 0
                              ? `+$${trade.profitLoss.toFixed(2)}`
                              : `-$${Math.abs(trade.profitLoss).toFixed(2)}`}
                          </span>
                        </td>

                        <td className="py-2.5 px-4 text-right text-slate-400 text-[11px]">
                          {timeStr}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
