import React, { useState, useMemo } from 'react';
import { Market, Tick } from '../../types/trading';
import { SYNTHETIC_MARKETS } from '../../data/syntheticMarkets';
import {
  Search,
  Star,
  ChevronDown,
  ArrowUpRight,
  ArrowDownRight,
  Radio,
  RefreshCw,
  Sparkles,
  X,
} from 'lucide-react';

interface MarketSelectorBarProps {
  selectedMarket: Market;
  onSelectMarket: (market: Market) => void;
  currentQuote: number;
  direction: 'up' | 'down' | 'flat';
  lastDigit: number;
  isWsConnected: boolean;
  dataSource: 'live' | 'simulated';
  favorites: string[];
  onToggleFavorite: (symbol: string) => void;
  onReconnect: () => void;
  high24h: number;
  low24h: number;
  change24h: number;
  changePct24h: number;
}

export const MarketSelectorBar: React.FC<MarketSelectorBarProps> = ({
  selectedMarket,
  onSelectMarket,
  currentQuote,
  direction,
  lastDigit,
  isWsConnected,
  dataSource,
  favorites,
  onToggleFavorite,
  onReconnect,
  high24h,
  low24h,
  change24h,
  changePct24h,
}) => {
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'volatility' | 'crash_boom' | 'jump' | 'fav'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const isCurrentFavorite = favorites.includes(selectedMarket.symbol);

  // Filtered list for popup dialog
  const filteredMarkets = useMemo(() => {
    return SYNTHETIC_MARKETS.filter((m) => {
      if (categoryFilter === 'fav' && !favorites.includes(m.symbol)) return false;
      if (categoryFilter === 'volatility' && m.category !== 'volatility') return false;
      if (categoryFilter === 'crash_boom' && m.category !== 'crash_boom') return false;
      if (categoryFilter === 'jump' && m.category !== 'jump') return false;

      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return (
          m.symbol.toLowerCase().includes(q) ||
          m.displayName.toLowerCase().includes(q) ||
          m.volatilityLabel.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [categoryFilter, favorites, searchQuery]);

  return (
    <>
      {/* Horizontal Top Bar Above Chart */}
      <div className="bg-[#090D16] border border-slate-800 rounded-xl p-2.5 px-3 flex flex-wrap items-center justify-between gap-3 shadow-md">
        {/* Left: Market Dropdown Button & Live Quote */}
        <div className="flex items-center gap-3">
          {/* Favorite star */}
          <button
            onClick={() => onToggleFavorite(selectedMarket.symbol)}
            title={isCurrentFavorite ? 'Remove from favorites' : 'Add to favorites'}
            className="p-1 rounded text-slate-500 hover:text-amber-400 transition-colors"
          >
            <Star
              className={`w-4 h-4 ${
                isCurrentFavorite ? 'fill-amber-400 text-amber-400' : 'text-slate-500'
              }`}
            />
          </button>

          {/* Market Picker Trigger */}
          <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700/80 transition-colors text-xs font-semibold text-slate-100 group"
          >
            <span className="font-mono text-cyan-400 font-bold">{selectedMarket.symbol}</span>
            <span className="truncate max-w-[130px] sm:max-w-none text-slate-200">
              {selectedMarket.displayName}
            </span>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-200 transition-transform" />
          </button>

          {/* Current Live Quote Display with Flash */}
          <div className="flex items-center gap-2 pl-2 border-l border-slate-800">
            <span
              className={`font-mono text-lg font-bold tabular-nums transition-colors ${
                direction === 'up'
                  ? 'text-emerald-400'
                  : direction === 'down'
                  ? 'text-rose-400'
                  : 'text-slate-100'
              }`}
            >
              {currentQuote.toFixed(selectedMarket.decimals)}
            </span>

            {/* Terminal Last Digit Badge */}
            <span
              className={`w-6 h-6 rounded flex items-center justify-center font-mono text-xs font-bold ring-1 ${
                lastDigit % 2 === 0
                  ? 'bg-emerald-950/80 text-emerald-300 ring-emerald-500/40'
                  : 'bg-indigo-950/80 text-indigo-300 ring-indigo-500/40'
              }`}
              title={`Last digit: ${lastDigit} (${lastDigit % 2 === 0 ? 'Even' : 'Odd'})`}
            >
              {lastDigit}
            </span>
          </div>
        </div>

        {/* Middle / Right: 24h Metrics & Feed Status */}
        <div className="flex items-center gap-4 text-xs font-mono">
          {/* 24h Change */}
          <div className="hidden sm:flex items-center gap-1.5">
            <span className="text-[10px] text-slate-500 font-sans">24h Chg:</span>
            <span
              className={`font-bold flex items-center ${
                changePct24h >= 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {changePct24h >= 0 ? (
                <ArrowUpRight className="w-3.5 h-3.5" />
              ) : (
                <ArrowDownRight className="w-3.5 h-3.5" />
              )}
              {changePct24h >= 0 ? '+' : ''}
              {changePct24h}%
            </span>
          </div>

          {/* High / Low */}
          <div className="hidden md:flex items-center gap-2 text-[11px] text-slate-400">
            <span>
              H: <strong className="text-slate-200">{high24h.toFixed(selectedMarket.decimals)}</strong>
            </span>
            <span>
              L: <strong className="text-slate-200">{low24h.toFixed(selectedMarket.decimals)}</strong>
            </span>
          </div>

          {/* Feed Indicator */}
          <div className="flex items-center gap-1.5 pl-2 border-l border-slate-800">
            <Radio
              className={`w-3.5 h-3.5 ${
                dataSource === 'live' && isWsConnected
                  ? 'text-emerald-400'
                  : 'text-amber-400 animate-pulse'
              }`}
            />
            <span className="text-[10px] font-mono text-slate-400 hidden lg:inline">
              {dataSource === 'live' && isWsConnected ? 'Deriv Real-Time' : 'Simulation Feed'}
            </span>
            {!isWsConnected && (
              <button
                onClick={onReconnect}
                title="Reconnect WebSocket stream"
                className="text-cyan-400 hover:text-cyan-300 p-0.5"
              >
                <RefreshCw className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Interactive Modal Dialog for Selecting Markets */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
          <div className="bg-[#0D1322] border border-slate-800 rounded-xl max-w-xl w-full shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800">
              <h3 className="font-semibold text-slate-100 text-sm">
                Select Synthetic Instrument
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-slate-200 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Search and Category Filters */}
            <div className="p-4 border-b border-slate-800/80 space-y-3 bg-slate-900/50">
              {/* Search bar */}
              <div className="flex items-center gap-2 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs">
                <Search className="w-4 h-4 text-slate-500 shrink-0" />
                <input
                  type="text"
                  placeholder="Search index name or symbol (e.g. Volatility 100, Crash, Jump)..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="bg-transparent text-slate-200 focus:outline-none w-full"
                  autoFocus
                />
              </div>

              {/* Category pills */}
              <div className="flex items-center gap-1.5 overflow-x-auto text-xs">
                {(
                  [
                    { id: 'all', label: 'All Instruments' },
                    { id: 'fav', label: '★ Favorites' },
                    { id: 'volatility', label: 'Continuous Volatility' },
                    { id: 'crash_boom', label: 'Crash / Boom' },
                    { id: 'jump', label: 'Jump Indices' },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setCategoryFilter(tab.id)}
                    className={`px-3 py-1 rounded-md whitespace-nowrap font-medium text-xs transition-colors ${
                      categoryFilter === tab.id
                        ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-semibold'
                        : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Markets List */}
            <div className="overflow-y-auto divide-y divide-slate-800/60 p-2">
              {filteredMarkets.map((m) => {
                const isSelected = selectedMarket.symbol === m.symbol;
                const isFav = favorites.includes(m.symbol);

                return (
                  <div
                    key={m.symbol}
                    onClick={() => {
                      onSelectMarket(m);
                      setIsModalOpen(false);
                    }}
                    className={`flex items-center justify-between p-3 rounded-lg cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-cyan-500/10 border border-cyan-500/30'
                        : 'hover:bg-slate-800/60'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleFavorite(m.symbol);
                        }}
                        className="text-slate-500 hover:text-amber-400 p-1"
                      >
                        <Star
                          className={`w-4 h-4 ${
                            isFav ? 'fill-amber-400 text-amber-400' : 'text-slate-600'
                          }`}
                        />
                      </button>

                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-cyan-400 font-bold text-xs">
                            {m.symbol}
                          </span>
                          <span className="font-semibold text-slate-100 text-xs">
                            {m.displayName}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400 mt-0.5 line-clamp-1">
                          {m.description}
                        </p>
                      </div>
                    </div>

                    <div className="text-right font-mono shrink-0 pl-3">
                      <span className="text-emerald-400 font-bold text-xs block">
                        {(m.payoutRate * 100).toFixed(1)}% Payout
                      </span>
                      <span className="text-[10px] text-slate-500 font-sans">
                        {m.volatilityLabel}
                      </span>
                    </div>
                  </div>
                );
              })}

              {filteredMarkets.length === 0 && (
                <div className="p-8 text-center text-slate-500 text-xs font-mono">
                  No synthetic markets matched your search filter.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
