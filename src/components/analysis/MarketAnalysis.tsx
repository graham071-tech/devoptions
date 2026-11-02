import React, { useState, useEffect, useMemo } from 'react';
import { Candle, Market, PageId, Tick } from '../../types/trading';
import { SYNTHETIC_MARKETS } from '../../data/syntheticMarkets';
import { derivWsService } from '../../services/derivWs';
import { extractLastDigit } from '../../utils/indicators';
import { useToast } from '../common/ToastNotification';
import { TradingChart } from './TradingChart';
import { LastDigitAnalyzer } from './LastDigitAnalyzer';
import { DisclaimerBanner } from '../common/DisclaimerBanner';
import {
  BarChart3,
  TrendingUp,
  Download,
  RefreshCw,
  Search,
  Filter,
  Calendar,
  Layers,
  ArrowUpRight,
  ArrowDownRight,
} from 'lucide-react';

interface MarketAnalysisProps {
  onNavigate: (page: PageId) => void;
}

export const MarketAnalysis: React.FC<MarketAnalysisProps> = ({ onNavigate }) => {
  const { showToast } = useToast();

  const [selectedMarket, setSelectedMarket] = useState<Market>(SYNTHETIC_MARKETS[0]);
  const [currentQuote, setCurrentQuote] = useState<number>(derivWsService.getCurrentQuote());
  const [candles, setCandles] = useState<Candle[]>(derivWsService.getCandles());
  const [ticksList, setTicksList] = useState<Tick[]>([]);
  const [tableSearch, setTableSearch] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'chart_analysis' | 'digit_stats' | 'historical_table'>('chart_analysis');

  useEffect(() => {
    derivWsService.setMarket(selectedMarket);

    const unsubTick = derivWsService.subscribeToTicks((t) => {
      setCurrentQuote(t.quote);
      setTicksList((prev) => [t, ...prev].slice(0, 300));
    });

    const unsubCandles = derivWsService.subscribeToCandles((c) => {
      setCandles(c);
    });

    return () => {
      unsubTick();
      unsubCandles();
    };
  }, [selectedMarket]);

  // Derived market statistics
  const quotes = useMemo(() => candles.map((c) => c.close), [candles]);

  const stats = useMemo(() => {
    if (candles.length === 0) {
      return { high: 0, low: 0, change: 0, changePct: 0, volatilityPct: 0 };
    }
    let h = -Infinity;
    let l = Infinity;
    candles.forEach((c) => {
      if (c.high > h) h = c.high;
      if (c.low < l) l = c.low;
    });

    const first = candles[0].open;
    const last = currentQuote;
    const change = last - first;
    const changePct = first > 0 ? (change / first) * 100 : 0;

    // Standard deviation volatility
    const mean = quotes.reduce((a, b) => a + b, 0) / Math.max(quotes.length, 1);
    const variance =
      quotes.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / Math.max(quotes.length, 1);
    const stdDev = Math.sqrt(variance);
    const volatilityPct = mean > 0 ? (stdDev / mean) * 100 : 0;

    return {
      high: h,
      low: l,
      change,
      changePct: Number(changePct.toFixed(2)),
      volatilityPct: Number(volatilityPct.toFixed(2)),
    };
  }, [candles, currentQuote, quotes]);

  // Export CSV
  const handleExportCSV = () => {
    if (candles.length === 0) {
      showToast('error', 'No Data', 'Historical series is empty.');
      return;
    }

    const headers = ['Timestamp', 'Date', 'Open', 'High', 'Low', 'Close', 'Last Digit'];
    const rows = candles.map((c) => {
      const d = new Date(c.epoch).toISOString();
      const lastDigit = extractLastDigit(c.close, selectedMarket.decimals);
      return [c.epoch, d, c.open, c.high, c.low, c.close, lastDigit].join(',');
    });

    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${selectedMarket.symbol}_candles_${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    showToast('success', 'CSV Exported', `Downloaded ${candles.length} rows.`);
  };

  const filteredCandles = useMemo(() => {
    if (!tableSearch) return candles.slice(-50).reverse();
    return candles
      .filter((c) => c.close.toString().includes(tableSearch) || c.epoch.toString().includes(tableSearch))
      .slice(-50)
      .reverse();
  }, [candles, tableSearch]);

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header & Market Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2.5">
            <BarChart3 className="w-5 h-5 text-cyan-400" />
            <h2 className="text-xl font-bold tracking-tight text-slate-100">
              Market Analysis & Statistical Engine
            </h2>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Institutional charting, technical oscillators, volatility measurements, and digit distributions
          </p>
        </div>

        {/* Market Picker */}
        <div className="flex items-center gap-3">
          <select
            value={selectedMarket.symbol}
            onChange={(e) => {
              const found = SYNTHETIC_MARKETS.find((m) => m.symbol === e.target.value);
              if (found) setSelectedMarket(found);
            }}
            className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs font-semibold text-slate-100 focus:outline-none focus:border-cyan-500"
          >
            {SYNTHETIC_MARKETS.map((m) => (
              <option key={m.symbol} value={m.symbol}>
                {m.displayName} ({m.volatilityLabel})
              </option>
            ))}
          </select>

          <button
            onClick={() => derivWsService.reconnect()}
            className="p-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-lg text-slate-300 transition-colors"
            title="Refresh Market Stream"
          >
            <RefreshCw className="w-4 h-4 text-cyan-400" />
          </button>
        </div>
      </div>

      <DisclaimerBanner />

      {/* KPI Market Metrics Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {/* Live Spot */}
        <div className="p-3.5 bg-[#090D16] border border-slate-800 rounded-xl space-y-1">
          <span className="text-[11px] text-slate-400">Current Quote</span>
          <div className="flex items-center gap-2">
            <span className="font-mono text-xl font-bold text-slate-100 tabular-nums">
              {currentQuote.toFixed(selectedMarket.decimals)}
            </span>
          </div>
        </div>

        {/* 24h Change */}
        <div className="p-3.5 bg-[#090D16] border border-slate-800 rounded-xl space-y-1">
          <span className="text-[11px] text-slate-400">Session Change</span>
          <div className="flex items-center gap-1.5 font-mono text-lg font-bold">
            {stats.changePct >= 0 ? (
              <span className="text-emerald-400 flex items-center">
                <ArrowUpRight className="w-4 h-4 mr-0.5" />+{stats.changePct}%
              </span>
            ) : (
              <span className="text-rose-400 flex items-center">
                <ArrowDownRight className="w-4 h-4 mr-0.5" />{stats.changePct}%
              </span>
            )}
          </div>
        </div>

        {/* 24h Range High / Low */}
        <div className="p-3.5 bg-[#090D16] border border-slate-800 rounded-xl space-y-1">
          <span className="text-[11px] text-slate-400">Period Range (H / L)</span>
          <div className="font-mono text-xs font-semibold text-slate-300 space-y-0.5">
            <div className="text-emerald-400">H: {stats.high.toFixed(selectedMarket.decimals)}</div>
            <div className="text-rose-400">L: {stats.low.toFixed(selectedMarket.decimals)}</div>
          </div>
        </div>

        {/* Empirical Volatility StdDev */}
        <div className="p-3.5 bg-[#090D16] border border-slate-800 rounded-xl space-y-1">
          <span className="text-[11px] text-slate-400">Realized Volatility (σ)</span>
          <p className="font-mono text-xl font-bold text-cyan-400">
            {stats.volatilityPct}%
          </p>
        </div>
      </div>

      {/* Analysis Section Tabs */}
      <div className="flex bg-slate-900 p-1 rounded-lg border border-slate-800 w-fit">
        <button
          onClick={() => setActiveTab('chart_analysis')}
          className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-colors ${
            activeTab === 'chart_analysis'
              ? 'bg-slate-800 text-slate-100 shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Interactive Technical Chart
        </button>
        <button
          onClick={() => setActiveTab('digit_stats')}
          className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-colors ${
            activeTab === 'digit_stats'
              ? 'bg-slate-800 text-slate-100 shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Last-Digit Frequency Analyzer
        </button>
        <button
          onClick={() => setActiveTab('historical_table')}
          className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-colors ${
            activeTab === 'historical_table'
              ? 'bg-slate-800 text-slate-100 shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Historical Ticks & Data Export
        </button>
      </div>

      {/* Viewport Panels */}
      {activeTab === 'chart_analysis' && (
        <div className="space-y-4">
          <TradingChart
            candles={candles}
            symbolName={selectedMarket.displayName}
            decimals={selectedMarket.decimals}
            currentQuote={currentQuote}
            height={420}
          />
        </div>
      )}

      {activeTab === 'digit_stats' && (
        <LastDigitAnalyzer
          quotes={quotes}
          decimals={selectedMarket.decimals}
          symbolName={selectedMarket.displayName}
        />
      )}

      {activeTab === 'historical_table' && (
        <div className="bg-[#090D16] border border-slate-800 rounded-xl overflow-hidden space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 max-w-xs w-full">
              <Search className="w-3.5 h-3.5 text-slate-500" />
              <input
                type="text"
                placeholder="Search quotes..."
                value={tableSearch}
                onChange={(e) => setTableSearch(e.target.value)}
                className="bg-transparent text-xs text-slate-200 focus:outline-none w-full"
              />
            </div>

            <button
              onClick={handleExportCSV}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold border border-slate-700/60 transition-colors"
            >
              <Download className="w-3.5 h-3.5 text-cyan-400" />
              <span>Export CSV ({candles.length} Candles)</span>
            </button>
          </div>

          <div className="max-h-96 overflow-y-auto border border-slate-800/80 rounded-lg">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-slate-900/90 text-[11px] text-slate-400 sticky top-0 border-b border-slate-800">
                <tr>
                  <th className="py-2.5 px-3">Epoch Time</th>
                  <th className="py-2.5 px-3">Open</th>
                  <th className="py-2.5 px-3">High</th>
                  <th className="py-2.5 px-3">Low</th>
                  <th className="py-2.5 px-3">Close</th>
                  <th className="py-2.5 px-3 text-right">Terminal Digit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-[11px]">
                {filteredCandles.map((c) => {
                  const digit = extractLastDigit(c.close, selectedMarket.decimals);
                  return (
                    <tr key={c.epoch} className="hover:bg-slate-900/40 transition-colors">
                      <td className="py-2 px-3 text-slate-400">
                        {new Date(c.epoch).toLocaleTimeString()}
                      </td>
                      <td className="py-2 px-3 text-slate-300">{c.open.toFixed(selectedMarket.decimals)}</td>
                      <td className="py-2 px-3 text-emerald-400">{c.high.toFixed(selectedMarket.decimals)}</td>
                      <td className="py-2 px-3 text-rose-400">{c.low.toFixed(selectedMarket.decimals)}</td>
                      <td className="py-2 px-3 font-bold text-slate-100">{c.close.toFixed(selectedMarket.decimals)}</td>
                      <td className="py-2 px-3 text-right">
                        <span
                          className={`inline-block w-6 h-5 leading-5 text-center rounded font-bold text-xs ${
                            digit % 2 === 0
                              ? 'bg-emerald-950/60 text-emerald-300'
                              : 'bg-indigo-950/60 text-indigo-300'
                          }`}
                        >
                          {digit}
                        </span>
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
  );
};
