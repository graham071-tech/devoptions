import React from 'react';
import { StrategyBlock, BlockPort } from '../../types/trading';
import { SYNTHETIC_MARKETS } from '../../data/syntheticMarkets';
import {
  Activity,
  Layers,
  Scale,
  GitBranch,
  PlayCircle,
  ShieldCheck,
  Copy,
  Trash2,
  Sliders,
} from 'lucide-react';

interface BlockNodeProps {
  block: StrategyBlock;
  isSelected: boolean;
  onSelect: () => void;
  onUpdateParams: (blockId: string, newParams: Record<string, any>) => void;
  onDelete: (blockId: string) => void;
  onDuplicate: (blockId: string) => void;
  onStartConnect: (blockId: string, portId: string, isOutput: boolean) => void;
  onEndConnect: (blockId: string, portId: string, isOutput: boolean) => void;
  connectedPorts: Set<string>; // set of "blockId:portId"
  onDragStart: (e: React.MouseEvent, blockId: string) => void;
}

export const BlockNode: React.FC<BlockNodeProps> = ({
  block,
  isSelected,
  onSelect,
  onUpdateParams,
  onDelete,
  onDuplicate,
  onStartConnect,
  onEndConnect,
  connectedPorts,
  onDragStart,
}) => {
  const getCategoryTheme = () => {
    switch (block.category) {
      case 'market':
        return {
          icon: Activity,
          accent: 'border-cyan-500/50 bg-cyan-950/20 text-cyan-400',
          badge: 'Market Data',
        };
      case 'indicator':
        return {
          icon: Layers,
          accent: 'border-indigo-500/50 bg-indigo-950/20 text-indigo-400',
          badge: 'Indicator',
        };
      case 'comparison':
        return {
          icon: Scale,
          accent: 'border-amber-500/50 bg-amber-950/20 text-amber-400',
          badge: 'Compare',
        };
      case 'logic':
        return {
          icon: GitBranch,
          accent: 'border-purple-500/50 bg-purple-950/20 text-purple-400',
          badge: 'Logic',
        };
      case 'action':
        return {
          icon: PlayCircle,
          accent: 'border-emerald-500/50 bg-emerald-950/20 text-emerald-400',
          badge: 'Execution',
        };
      case 'risk':
        return {
          icon: ShieldCheck,
          accent: 'border-rose-500/50 bg-rose-950/20 text-rose-400',
          badge: 'Risk Control',
        };
      default:
        return {
          icon: Sliders,
          accent: 'border-slate-500/50 bg-slate-950/20 text-slate-400',
          badge: 'Rule',
        };
    }
  };

  const theme = getCategoryTheme();
  const Icon = theme.icon;

  const renderInlineParams = () => {
    switch (block.type) {
      case 'market_data':
        return (
          <div className="space-y-1.5 text-xs">
            <label className="text-[10px] text-slate-400 block font-medium">Index</label>
            <select
              value={block.params.symbol || 'R_100'}
              onChange={(e) => onUpdateParams(block.id, { ...block.params, symbol: e.target.value })}
              className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-200 text-xs focus:outline-none focus:border-cyan-500"
            >
              {SYNTHETIC_MARKETS.map((m) => (
                <option key={m.symbol} value={m.symbol}>
                  {m.displayName}
                </option>
              ))}
            </select>
          </div>
        );

      case 'indicator_rsi':
        return (
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div>
              <label className="text-[10px] text-slate-400 block font-medium">Period</label>
              <input
                type="number"
                min="2"
                max="50"
                value={block.params.period || 14}
                onChange={(e) =>
                  onUpdateParams(block.id, { ...block.params, period: Number(e.target.value) })
                }
                className="w-full bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-slate-200 text-xs font-mono"
              />
            </div>
            <div>
              <label className="text-[10px] text-slate-400 block font-medium">Overbought</label>
              <input
                type="number"
                min="50"
                max="95"
                value={block.params.overbought || 70}
                onChange={(e) =>
                  onUpdateParams(block.id, { ...block.params, overbought: Number(e.target.value) })
                }
                className="w-full bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-slate-200 text-xs font-mono"
              />
            </div>
            <div>
              <label className="text-[10px] text-slate-400 block font-medium">Oversold</label>
              <input
                type="number"
                min="5"
                max="50"
                value={block.params.oversold || 30}
                onChange={(e) =>
                  onUpdateParams(block.id, { ...block.params, oversold: Number(e.target.value) })
                }
                className="w-full bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-slate-200 text-xs font-mono"
              />
            </div>
          </div>
        );

      case 'indicator_sma':
      case 'indicator_ema':
        return (
          <div className="space-y-1.5 text-xs">
            <label className="text-[10px] text-slate-400 block font-medium">Smoothing Period</label>
            <input
              type="number"
              min="2"
              max="200"
              value={block.params.period || 14}
              onChange={(e) =>
                onUpdateParams(block.id, { ...block.params, period: Number(e.target.value) })
              }
              className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-200 text-xs font-mono"
            />
          </div>
        );

      case 'action_trade':
        return (
          <div className="space-y-2 text-xs">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-slate-400 block font-medium">Contract</label>
                <select
                  value={block.params.contractType || 'CALL'}
                  onChange={(e) =>
                    onUpdateParams(block.id, { ...block.params, contractType: e.target.value })
                  }
                  className="w-full bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-slate-200 text-xs"
                >
                  <option value="CALL">RISE (Call)</option>
                  <option value="PUT">FALL (Put)</option>
                  <option value="EVEN">DIGIT EVEN</option>
                  <option value="ODD">DIGIT ODD</option>
                  <option value="MATCHES">MATCHES</option>
                  <option value="DIFFERS">DIFFERS</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] text-slate-400 block font-medium">Stake ($)</label>
                <input
                  type="number"
                  min="0.5"
                  step="0.5"
                  value={block.params.stake || 10}
                  onChange={(e) =>
                    onUpdateParams(block.id, { ...block.params, stake: Number(e.target.value) })
                  }
                  className="w-full bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-slate-200 text-xs font-mono"
                />
              </div>
            </div>

            <div>
              <label className="text-[10px] text-slate-400 block font-medium">Duration (Ticks)</label>
              <input
                type="number"
                min="1"
                max="10"
                value={block.params.durationTicks || 5}
                onChange={(e) =>
                  onUpdateParams(block.id, { ...block.params, durationTicks: Number(e.target.value) })
                }
                className="w-full bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-slate-200 text-xs font-mono"
              />
            </div>
          </div>
        );

      case 'risk_management':
        return (
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <label className="text-[10px] text-slate-400 block font-medium">Take Profit ($)</label>
              <input
                type="number"
                min="5"
                value={block.params.takeProfit || 100}
                onChange={(e) =>
                  onUpdateParams(block.id, { ...block.params, takeProfit: Number(e.target.value) })
                }
                className="w-full bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-emerald-400 text-xs font-mono"
              />
            </div>
            <div>
              <label className="text-[10px] text-slate-400 block font-medium">Stop Loss ($)</label>
              <input
                type="number"
                min="5"
                value={block.params.stopLoss || 50}
                onChange={(e) =>
                  onUpdateParams(block.id, { ...block.params, stopLoss: Number(e.target.value) })
                }
                className="w-full bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-rose-400 text-xs font-mono"
              />
            </div>
            <div>
              <label className="text-[10px] text-slate-400 block font-medium">Max Losses</label>
              <input
                type="number"
                min="1"
                max="10"
                value={block.params.maxConsecutiveLosses || 3}
                onChange={(e) =>
                  onUpdateParams(block.id, {
                    ...block.params,
                    maxConsecutiveLosses: Number(e.target.value),
                  })
                }
                className="w-full bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-slate-200 text-xs font-mono"
              />
            </div>
            <div>
              <label className="text-[10px] text-slate-400 block font-medium">Max Stake ($)</label>
              <input
                type="number"
                min="1"
                value={block.params.maxStake || 50}
                onChange={(e) =>
                  onUpdateParams(block.id, { ...block.params, maxStake: Number(e.target.value) })
                }
                className="w-full bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-slate-200 text-xs font-mono"
              />
            </div>
          </div>
        );

      case 'last_digit':
        return (
          <div className="space-y-1.5 text-xs">
            <label className="text-[10px] text-slate-400 block font-medium">Lookback Ticks</label>
            <input
              type="number"
              min="5"
              max="100"
              value={block.params.lookback || 20}
              onChange={(e) =>
                onUpdateParams(block.id, { ...block.params, lookback: Number(e.target.value) })
              }
              className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-200 text-xs font-mono"
            />
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div
      onClick={onSelect}
      style={{
        transform: `translate(${block.position.x}px, ${block.position.y}px)`,
      }}
      className={`absolute w-64 bg-[#0D1322] rounded-xl border shadow-xl select-none transition-shadow ${
        isSelected
          ? 'border-cyan-400 ring-2 ring-cyan-400/20 shadow-cyan-950/50'
          : 'border-slate-800 hover:border-slate-700'
      }`}
    >
      {/* Header / Drag Handle */}
      <div
        onMouseDown={(e) => onDragStart(e, block.id)}
        className="px-3 py-2.5 bg-slate-900/90 rounded-t-xl border-b border-slate-800/80 flex items-center justify-between cursor-grab active:cursor-grabbing"
      >
        <div className="flex items-center gap-2 min-w-0">
          <div className={`p-1 rounded ${theme.accent}`}>
            <Icon className="w-3.5 h-3.5" />
          </div>
          <span className="font-semibold text-xs text-slate-200 truncate">{block.title}</span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDuplicate(block.id);
            }}
            title="Duplicate Block"
            className="p-1 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded transition-colors"
          >
            <Copy className="w-3 h-3" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(block.id);
            }}
            title="Delete Block"
            className="p-1 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded transition-colors"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Inputs / Content / Outputs Container */}
      <div className="p-3 space-y-3">
        {/* Inline Parameters */}
        {renderInlineParams()}

        {/* Ports Row */}
        <div className="flex justify-between items-start pt-2 border-t border-slate-800/60 gap-4 text-[11px]">
          {/* Inputs */}
          <div className="space-y-2 flex-1">
            {block.inputs.map((port) => {
              const portKey = `${block.id}:${port.id}`;
              const isConnected = connectedPorts.has(portKey);
              return (
                <div
                  key={port.id}
                  className="flex items-center gap-1.5 group cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEndConnect(block.id, port.id, false);
                  }}
                >
                  <span
                    className={`w-3 h-3 rounded-full border transition-all ${
                      isConnected
                        ? 'bg-cyan-400 border-cyan-300 ring-2 ring-cyan-500/30'
                        : 'bg-slate-900 border-slate-600 hover:border-cyan-400'
                    }`}
                  />
                  <span className="text-slate-400 group-hover:text-slate-200 font-mono text-[10px] truncate">
                    {port.name}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Outputs */}
          <div className="space-y-2 flex-1 text-right">
            {block.outputs.map((port) => {
              const portKey = `${block.id}:${port.id}`;
              const isConnected = connectedPorts.has(portKey);
              return (
                <div
                  key={port.id}
                  className="flex items-center justify-end gap-1.5 group cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    onStartConnect(block.id, port.id, true);
                  }}
                >
                  <span className="text-slate-400 group-hover:text-slate-200 font-mono text-[10px] truncate">
                    {port.name}
                  </span>
                  <span
                    className={`w-3 h-3 rounded-full border transition-all ${
                      isConnected
                        ? 'bg-emerald-400 border-emerald-300 ring-2 ring-emerald-500/30'
                        : 'bg-slate-900 border-slate-600 hover:border-emerald-400'
                    }`}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
