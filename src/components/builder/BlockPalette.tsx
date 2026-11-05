import React from 'react';
import { BlockType, BlockCategory } from '../../types/trading';
import {
  Activity,
  Layers,
  Scale,
  GitBranch,
  PlayCircle,
  ShieldCheck,
  Plus,
} from 'lucide-react';

interface BlockTemplate {
  type: BlockType;
  category: BlockCategory;
  title: string;
  desc: string;
  defaultParams: Record<string, any>;
  inputs: { id: string; name: string; type: 'number' | 'boolean' | 'action' | 'any' }[];
  outputs: { id: string; name: string; type: 'number' | 'boolean' | 'action' | 'any' }[];
}

export const AVAILABLE_BLOCKS: BlockTemplate[] = [
  {
    type: 'market_data',
    category: 'market',
    title: 'Market Data Feed',
    desc: 'Streams real-time ticks & candle series from Deriv.',
    defaultParams: { symbol: 'R_100' },
    inputs: [],
    outputs: [
      { id: 'tick_price', name: 'Close Price', type: 'number' },
      { id: 'candle_series', name: 'Candles', type: 'any' },
    ],
  },
  {
    type: 'indicator_rsi',
    category: 'indicator',
    title: 'RSI Oscillator',
    desc: 'Calculates Relative Strength Index over period.',
    defaultParams: { period: 14, overbought: 70, oversold: 30 },
    inputs: [{ id: 'in_price', name: 'Price In', type: 'number' }],
    outputs: [
      { id: 'rsi_val', name: 'RSI Value', type: 'number' },
      { id: 'is_oversold', name: 'Oversold (< 30)', type: 'boolean' },
      { id: 'is_overbought', name: 'Overbought (> 70)', type: 'boolean' },
    ],
  },
  {
    type: 'indicator_ema',
    category: 'indicator',
    title: 'Exponential Moving Average',
    desc: 'Calculates weighted EMA for trend detection.',
    defaultParams: { period: 9 },
    inputs: [{ id: 'in_price', name: 'Price In', type: 'number' }],
    outputs: [{ id: 'ema_val', name: 'EMA Value', type: 'number' }],
  },
  {
    type: 'indicator_bollinger',
    category: 'indicator',
    title: 'Bollinger Bands',
    desc: 'Volatility envelope (Upper, Middle, Lower).',
    defaultParams: { period: 20, multiplier: 2 },
    inputs: [{ id: 'in_price', name: 'Price In', type: 'number' }],
    outputs: [
      { id: 'upper_band', name: 'Upper Band', type: 'number' },
      { id: 'lower_band', name: 'Lower Band', type: 'number' },
    ],
  },
  {
    type: 'last_digit',
    category: 'indicator',
    title: 'Last-Digit Analyzer',
    desc: 'Extracts terminal digit (0-9) and parity.',
    defaultParams: { lookback: 20 },
    inputs: [{ id: 'in_price', name: 'Price In', type: 'number' }],
    outputs: [
      { id: 'digit_val', name: 'Last Digit', type: 'number' },
      { id: 'is_even', name: 'Is Even', type: 'boolean' },
      { id: 'is_odd', name: 'Is Odd', type: 'boolean' },
    ],
  },
  {
    type: 'compare_greater',
    category: 'comparison',
    title: 'Price Greater Than (A > B)',
    desc: 'Evaluates if Input A is greater than Input B.',
    defaultParams: { threshold: 50 },
    inputs: [
      { id: 'val_a', name: 'Value A', type: 'number' },
      { id: 'val_b', name: 'Value B', type: 'number' },
    ],
    outputs: [{ id: 'result', name: 'Condition Met', type: 'boolean' }],
  },
  {
    type: 'compare_cross_above',
    category: 'comparison',
    title: 'Crosses Above',
    desc: 'Triggers when Fast line crosses above Slow line.',
    defaultParams: {},
    inputs: [
      { id: 'series_a', name: 'Fast Series', type: 'number' },
      { id: 'series_b', name: 'Slow Series', type: 'number' },
    ],
    outputs: [{ id: 'condition', name: 'Crossed', type: 'boolean' }],
  },
  {
    type: 'logic_and',
    category: 'logic',
    title: 'Logical AND',
    desc: 'Returns true only if both input conditions are true.',
    defaultParams: {},
    inputs: [
      { id: 'cond_1', name: 'Condition 1', type: 'boolean' },
      { id: 'cond_2', name: 'Condition 2', type: 'boolean' },
    ],
    outputs: [{ id: 'out_bool', name: 'Both True', type: 'boolean' }],
  },
  {
    type: 'action_trade',
    category: 'action',
    title: 'Execute Contract',
    desc: 'Places demo or real binary options contract.',
    defaultParams: { contractType: 'CALL', stake: 10, durationTicks: 5 },
    inputs: [{ id: 'trigger', name: 'Trigger', type: 'boolean' }],
    outputs: [{ id: 'trade_placed', name: 'Trade Done', type: 'action' }],
  },
  {
    type: 'risk_management',
    category: 'risk',
    title: 'Risk Guard & Limits',
    desc: 'Stops bot on daily stop loss or consecutive losses.',
    defaultParams: { takeProfit: 100, stopLoss: 50, maxConsecutiveLosses: 3, maxStake: 50 },
    inputs: [{ id: 'trade_in', name: 'Trade In', type: 'action' }],
    outputs: [{ id: 'safe_out', name: 'Status Safe', type: 'boolean' }],
  },
];

interface BlockPaletteProps {
  onAddBlock: (template: BlockTemplate) => void;
}

export const BlockPalette: React.FC<BlockPaletteProps> = ({ onAddBlock }) => {
  const getCategoryIcon = (category: BlockCategory) => {
    switch (category) {
      case 'market':
        return Activity;
      case 'indicator':
        return Layers;
      case 'comparison':
        return Scale;
      case 'logic':
        return GitBranch;
      case 'action':
        return PlayCircle;
      case 'risk':
        return ShieldCheck;
      default:
        return Plus;
    }
  };

  return (
    <div className="w-64 bg-[#090D16] border-r border-slate-800 flex flex-col h-full overflow-hidden select-none">
      <div className="p-3 border-b border-slate-800">
        <h4 className="text-xs font-semibold text-slate-200 uppercase tracking-wider">
          Strategy Blocks
        </h4>
        <p className="text-[11px] text-slate-400 mt-0.5">Click to add onto canvas</p>
      </div>

      <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
        {AVAILABLE_BLOCKS.map((template) => {
          const Icon = getCategoryIcon(template.category);
          return (
            <button
              key={template.type}
              onClick={() => onAddBlock(template)}
              className="w-full text-left p-2.5 bg-slate-900/70 hover:bg-slate-800/80 border border-slate-800/80 hover:border-slate-700 rounded-lg transition-all group"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Icon className="w-3.5 h-3.5 text-cyan-400" />
                  <span className="font-semibold text-xs text-slate-200 group-hover:text-cyan-300 transition-colors">
                    {template.title}
                  </span>
                </div>
                <Plus className="w-3.5 h-3.5 text-slate-500 group-hover:text-cyan-400 transition-colors" />
              </div>
              <p className="text-[10px] text-slate-400 mt-1 line-clamp-1">{template.desc}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
};
