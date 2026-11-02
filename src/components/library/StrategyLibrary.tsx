import React, { useState, useMemo, useRef } from 'react';
import { PageId, Strategy } from '../../types/trading';
import { storage } from '../../services/storage';
import { useToast } from '../common/ToastNotification';
import {
  BookMarked,
  Plus,
  Play,
  FlaskConical,
  Cpu,
  Copy,
  Trash2,
  Download,
  Upload,
  Search,
  Sparkles,
  ShieldCheck,
} from 'lucide-react';

interface StrategyLibraryProps {
  onNavigate: (page: PageId) => void;
  onSelectStrategy: (strat: Strategy) => void;
  onDeployToDemo: (strat: Strategy) => void;
  onBacktest: (strat: Strategy) => void;
}

export const StrategyLibrary: React.FC<StrategyLibraryProps> = ({
  onNavigate,
  onSelectStrategy,
  onDeployToDemo,
  onBacktest,
}) => {
  const { showToast } = useToast();
  const [strategies, setStrategies] = useState<Strategy[]>(() => storage.getStrategies());
  const [searchQuery, setSearchQuery] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const filteredStrategies = useMemo(() => {
    if (!searchQuery) return strategies;
    const q = searchQuery.toLowerCase();
    return strategies.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.marketSymbol.toLowerCase().includes(q)
    );
  }, [strategies, searchQuery]);

  const handleDuplicate = (strat: Strategy) => {
    const dup: Strategy = {
      ...strat,
      id: `strat_${Date.now()}`,
      name: `${strat.name} (Copy)`,
      isBuiltIn: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const updated = storage.saveStrategy(dup);
    setStrategies(updated);
    showToast('success', 'Strategy Duplicated', `Created "${dup.name}"`);
  };

  const handleDelete = (id: string, name: string) => {
    if (confirm(`Are you sure you want to delete strategy "${name}"?`)) {
      const updated = storage.deleteStrategy(id);
      setStrategies(updated);
      showToast('info', 'Strategy Deleted', `Removed "${name}"`);
    }
  };

  const handleExport = (strat: Strategy) => {
    const blob = new Blob([JSON.stringify(strat, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${strat.name.toLowerCase().replace(/\s+/g, '_')}_strategy.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('success', 'Export Complete', 'Strategy JSON saved.');
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        if (parsed.blocks && parsed.connections) {
          const newStrat: Strategy = {
            ...parsed,
            id: `strat_${Date.now()}`,
            name: `${parsed.name || 'Imported'} (Imported)`,
            isBuiltIn: false,
          };
          const updated = storage.saveStrategy(newStrat);
          setStrategies(updated);
          showToast('success', 'Strategy Imported', `Added "${newStrat.name}" to library.`);
        }
      } catch (err) {
        showToast('error', 'Parse Error', 'Failed to import strategy JSON.');
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-7xl mx-auto">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2.5">
            <BookMarked className="w-5 h-5 text-cyan-400" />
            <h2 className="text-xl font-bold tracking-tight text-slate-100">
              Strategy Repository & Library
            </h2>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Browse, manage, and duplicate custom rule sets and verified templates
          </p>
        </div>

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold border border-slate-700/60 cursor-pointer transition-colors">
            <Upload className="w-3.5 h-3.5 text-cyan-400" />
            <span>Import JSON</span>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={handleImport}
              className="hidden"
            />
          </label>

          <button
            onClick={() => onNavigate('builder')}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold rounded-lg text-xs transition-colors shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span>Create New Strategy</span>
          </button>
        </div>
      </div>

      {/* Search Input Bar */}
      <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 max-w-md w-full">
        <Search className="w-4 h-4 text-slate-500" />
        <input
          type="text"
          placeholder="Search by strategy title, indicator, or market..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="bg-transparent text-xs text-slate-200 focus:outline-none w-full"
        />
      </div>

      {/* Strategy Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {filteredStrategies.map((strat) => (
          <div
            key={strat.id}
            className="bg-[#090D16] border border-slate-800 hover:border-slate-700 rounded-xl p-5 flex flex-col justify-between space-y-4 transition-all hover:shadow-lg"
          >
            <div className="space-y-2.5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-semibold text-slate-100 text-sm">{strat.name}</h3>
                  <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-0.5">
                    <span className="font-mono text-cyan-400">{strat.marketSymbol}</span>
                    <span>·</span>
                    <span>{strat.blocks.length} Logic Blocks</span>
                  </div>
                </div>

                {strat.isBuiltIn && (
                  <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/30 shrink-0">
                    Verified
                  </span>
                )}
              </div>

              <p className="text-xs text-slate-400 leading-relaxed line-clamp-2">
                {strat.description}
              </p>

              {/* Risk Limits Snapshot */}
              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800/80 text-[11px] font-mono">
                <div>
                  <span className="text-slate-500 block font-sans text-[10px]">Take Profit</span>
                  <span className="text-emerald-400 font-semibold">
                    ${strat.riskLimits.takeProfitTarget}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block font-sans text-[10px]">Stop Loss</span>
                  <span className="text-rose-400 font-semibold">
                    ${strat.riskLimits.stopLossLimit}
                  </span>
                </div>
              </div>
            </div>

            {/* Actions Toolbar */}
            <div className="pt-3 border-t border-slate-800 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => {
                    onSelectStrategy(strat);
                    onNavigate('builder');
                  }}
                  className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-md transition-colors"
                  title="Open in Visual Builder"
                >
                  <Cpu className="w-3.5 h-3.5 text-cyan-400" />
                </button>
                <button
                  onClick={() => {
                    onBacktest(strat);
                    onNavigate('backtesting');
                  }}
                  className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-md transition-colors"
                  title="Run Historical Backtest"
                >
                  <FlaskConical className="w-3.5 h-3.5 text-indigo-400" />
                </button>
                <button
                  onClick={() => handleDuplicate(strat)}
                  className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-md transition-colors"
                  title="Duplicate Strategy"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => handleExport(strat)}
                  className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-md transition-colors"
                  title="Export JSON"
                >
                  <Download className="w-3.5 h-3.5" />
                </button>
                {!strat.isBuiltIn && (
                  <button
                    onClick={() => handleDelete(strat.id, strat.name)}
                    className="p-1.5 bg-slate-800 hover:bg-rose-950 text-slate-400 hover:text-rose-400 rounded-md transition-colors"
                    title="Delete Strategy"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              <button
                onClick={() => {
                  onDeployToDemo(strat);
                  onNavigate('trading');
                }}
                className="flex items-center gap-1 px-2.5 py-1.5 bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 rounded-lg text-xs font-semibold transition-colors"
              >
                <Play className="w-3 h-3 fill-current" />
                <span>Deploy</span>
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
