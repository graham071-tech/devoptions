import React, { useState } from 'react';
import { ContractType, Market } from '../../types/trading';
import {
  Play,
  Square,
  AlertTriangle,
  ShieldAlert,
  Sliders,
  DollarSign,
  TrendingUp,
  TrendingDown,
  Info,
  Clock,
  RotateCcw,
  OctagonAlert,
  Sparkles,
  Bot,
  Layers,
  ChevronDown,
  Activity,
  Zap,
  Plus,
  Minus,
  ArrowUpRight,
  ArrowDownRight,
} from 'lucide-react';

export type BotStatus =
  | 'idle'
  | 'scanning'
  | 'ready'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'error';

export type TradingExecutionMode = 'automated' | 'manual';

export interface BotConfig {
  targetProfit: number;
  maxLoss: number;
  stake: number;
  contractType: ContractType;
  durationTicks: number;
}

interface SimpleBotPanelProps {
  market: Market;
  onSelectMarket?: (market: Market) => void;
  availableMarkets?: Market[];
  currentQuote: number;
  tradingMode: 'demo' | 'real';
  availableBalance: number;
  botStatus: BotStatus;
  stopReason: string;
  onStartBot: (config: BotConfig) => void;
  onStopBot: () => void;
  onEmergencyStop: () => void;
  sessionStats: {
    realizedPnl: number;
    tradesCount: number;
    wins: number;
    losses: number;
  };
  onOpenAIScanner: () => void;
  onScanMarket: () => void;
  onScanAndTradeForMe: () => void;
  isScanning: boolean;
  activeTradesCount: number;
  onManualTrade?: (type: ContractType) => void;
}

export const SimpleBotPanel: React.FC<SimpleBotPanelProps> = ({
  market,
  onSelectMarket,
  availableMarkets,
  currentQuote,
  tradingMode,
  availableBalance,
  botStatus,
  stopReason,
  onStartBot,
  onStopBot,
  onEmergencyStop,
  sessionStats,
  onOpenAIScanner,
  onScanMarket,
  onScanAndTradeForMe,
  isScanning,
  activeTradesCount,
  onManualTrade,
}) => {
  // Mode selection: Automated bot vs Manual 1-Click
  const [executionMode, setExecutionMode] = useState<TradingExecutionMode>('automated');

  // Inputs
  const [targetProfit, setTargetProfit] = useState<number>(20);
  const [maxLoss, setMaxLoss] = useState<number>(15);
  const [stake, setStake] = useState<number>(5);
  const [contractType, setContractType] = useState<ContractType>('CALL');
  const [durationTicks, setDurationTicks] = useState<number>(5);
  const [validationError, setValidationError] = useState<string>('');
  const [isMarketDropdownOpen, setIsMarketDropdownOpen] = useState<boolean>(false);

  const isRunning = botStatus === 'running' || botStatus === 'stopping';

  // Increment / Decrement Helpers
  const adjustStake = (delta: number) => {
    if (isRunning) return;
    const min = market.minStake || 1;
    setStake((prev) => Math.max(min, Number((prev + delta).toFixed(2))));
  };

  const adjustTargetProfit = (delta: number) => {
    if (isRunning) return;
    setTargetProfit((prev) => Math.max(1, prev + delta));
  };

  const adjustMaxLoss = (delta: number) => {
    if (isRunning) return;
    setMaxLoss((prev) => Math.max(1, prev + delta));
  };

  const handleStart = () => {
    setValidationError('');

    if (targetProfit <= 0 || isNaN(targetProfit)) {
      setValidationError('Please enter a positive Target Profit amount ($).');
      return;
    }
    if (maxLoss <= 0 || isNaN(maxLoss)) {
      setValidationError('Please enter a positive Maximum Loss limit ($).');
      return;
    }
    if (stake < (market.minStake || 1)) {
      setValidationError(`Minimum stake for ${market.displayName} is $${market.minStake || 1}.00.`);
      return;
    }
    if (stake > availableBalance) {
      setValidationError(`Stake ($${stake}) exceeds available balance ($${availableBalance.toFixed(2)}).`);
      return;
    }

    onStartBot({
      targetProfit,
      maxLoss,
      stake,
      contractType,
      durationTicks,
    });
  };

  const getStatusBadge = () => {
    switch (botStatus) {
      case 'running':
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-emerald-950/80 text-emerald-400 border border-emerald-800/80 text-[10px] font-mono font-bold">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            RUNNING
          </span>
        );
      case 'stopping':
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-amber-950/80 text-amber-400 border border-amber-800/80 text-[10px] font-mono font-bold">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
            STOPPING
          </span>
        );
      case 'scanning':
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-cyan-950/80 text-cyan-400 border border-cyan-800/80 text-[10px] font-mono font-bold">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />
            SCANNING
          </span>
        );
      case 'ready':
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-slate-900 text-cyan-300 border border-cyan-800/60 text-[10px] font-mono font-bold">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
            READY
          </span>
        );
      case 'stopped':
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-rose-950/80 text-rose-400 border border-rose-800/80 text-[10px] font-mono font-bold">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
            STOPPED
          </span>
        );
      case 'error':
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-rose-950/80 text-rose-400 border border-rose-800/80 text-[10px] font-mono font-bold">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
            ERROR
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-slate-900 text-slate-400 border border-slate-800 text-[10px] font-mono font-semibold">
            <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
            IDLE
          </span>
        );
    }
  };

  return (
    <div className="bg-[#0B0F19] border border-slate-800/90 rounded-xl p-2.5 sm:p-3 space-y-2.5 select-none text-slate-200">
      {/* ─────────────────────────────────────────────────────────────
          1. HEADER: "Trading" + Account Mode + Status Badge
      ───────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-800/80">
        <div className="flex items-center gap-2">
          <h2 className="text-xs font-bold text-slate-100 font-mono tracking-tight uppercase flex items-center gap-1.5">
            <Sliders className="w-3.5 h-3.5 text-cyan-400" />
            <span>Trading</span>
          </h2>
          <span
            className={`text-[9px] font-mono px-1.5 py-0.2 rounded font-bold uppercase ${
              tradingMode === 'real'
                ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                : 'bg-amber-950 text-amber-300 border border-amber-800'
            }`}
          >
            {tradingMode}
          </span>
        </div>

        <div className="shrink-0">{getStatusBadge()}</div>
      </div>

      {/* ─────────────────────────────────────────────────────────────
          2. TRADING EXECUTION MODE SELECTOR (Automated vs Manual)
      ───────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-1 bg-slate-950 p-0.5 rounded-lg border border-slate-800 text-[10px] font-mono">
        <button
          type="button"
          onClick={() => setExecutionMode('automated')}
          className={`py-1.5 px-2 rounded font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
            executionMode === 'automated'
              ? 'bg-cyan-950 text-cyan-300 border border-cyan-800 shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Bot className="w-3 h-3" />
          <span>Automated Bot</span>
        </button>

        <button
          type="button"
          onClick={() => setExecutionMode('manual')}
          className={`py-1.5 px-2 rounded font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
            executionMode === 'manual'
              ? 'bg-purple-950 text-purple-300 border border-purple-800 shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Zap className="w-3 h-3 text-purple-400" />
          <span>Manual 1-Click</span>
        </button>
      </div>

      {/* ─────────────────────────────────────────────────────────────
          3. MARKET INDICATOR & QUICK SWITCHER
      ───────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-2 p-1.5 rounded-lg bg-slate-950 border border-slate-800/90 text-xs">
        <div className="min-w-0 flex-1">
          <span className="text-[9px] text-slate-500 uppercase font-mono block">
            Selected Market
          </span>
          {availableMarkets && onSelectMarket ? (
            <div className="relative">
              <button
                type="button"
                disabled={isRunning}
                onClick={() => setIsMarketDropdownOpen(!isMarketDropdownOpen)}
                className="flex items-center gap-1 text-[11px] font-bold text-slate-100 hover:text-cyan-300 font-mono transition-colors disabled:opacity-60 cursor-pointer"
              >
                <span className="truncate max-w-[170px]">{market.displayName}</span>
                <ChevronDown className="w-3 h-3 text-slate-400 shrink-0" />
              </button>

              {isMarketDropdownOpen && (
                <div className="absolute left-0 top-full mt-1 w-64 bg-[#0D1322] border border-slate-700 rounded-lg shadow-2xl p-1 z-50 space-y-0.5 max-h-56 overflow-y-auto">
                  <div className="px-2 py-1 text-[9px] font-mono uppercase text-slate-500 font-bold border-b border-slate-800">
                    Switch Instrument
                  </div>
                  {availableMarkets.map((m) => (
                    <button
                      key={m.symbol}
                      type="button"
                      onClick={() => {
                        onSelectMarket(m);
                        setIsMarketDropdownOpen(false);
                      }}
                      className={`w-full text-left p-1.5 rounded flex items-center justify-between text-xs transition-colors cursor-pointer ${
                        market.symbol === m.symbol
                          ? 'bg-slate-800 text-cyan-300 font-bold border border-slate-700'
                          : 'hover:bg-slate-900 text-slate-300'
                      }`}
                    >
                      <span className="truncate">{m.displayName}</span>
                      <span className="font-mono text-[10px] text-slate-500">
                        +{Math.round((m.payoutRate || 0.95) * 100)}%
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <span className="text-[11px] font-bold font-mono text-slate-200">{market.displayName}</span>
          )}
        </div>

        <div className="text-right shrink-0">
          <span className="text-[9px] text-slate-500 uppercase font-mono block">Payout</span>
          <span className="text-[10px] font-mono font-bold text-emerald-400">
            +{Math.round((market.payoutRate || 0.95) * 100)}%
          </span>
        </div>
      </div>

      {/* Stop Reason Alert */}
      {stopReason && (
        <div className="p-2 rounded bg-amber-950/20 border border-amber-500/20 text-amber-300 text-[10px] flex items-center gap-1.5 font-mono">
          <AlertTriangle className="w-3 h-3 shrink-0 text-amber-400" />
          <span>{stopReason}</span>
        </div>
      )}

      {/* Validation Error Banner */}
      {validationError && (
        <div className="p-2 rounded bg-rose-950/20 border border-rose-500/20 text-rose-300 text-[10px] flex items-center gap-1.5 font-mono">
          <ShieldAlert className="w-3 h-3 shrink-0 text-rose-400" />
          <span>{validationError}</span>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          4. STAKE AMOUNT WITH INCREMENT & DECREMENT CONTROLS
      ───────────────────────────────────────────────────────────── */}
      <div className="space-y-1">
        <label className="text-[10px] font-semibold text-slate-400 uppercase font-mono flex items-center justify-between">
          <span>Stake Amount ($)</span>
          <span className="text-[9px] text-slate-500 font-mono">Min ${market.minStake || 1}</span>
        </label>

        <div className="flex items-center gap-1">
          {/* Decrement Button */}
          <button
            type="button"
            disabled={isRunning || stake <= (market.minStake || 1)}
            onClick={() => adjustStake(-1)}
            className="w-8 h-8 rounded bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-slate-200 border border-slate-800 flex items-center justify-center font-bold text-xs transition-colors cursor-pointer"
            title="Decrease stake by $1"
          >
            <Minus className="w-3 h-3" />
          </button>

          {/* Stake Input */}
          <div className="relative flex-1">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 font-mono text-xs">
              $
            </span>
            <input
              type="number"
              min={market.minStake || 1}
              step={1}
              disabled={isRunning}
              value={stake}
              onChange={(e) => setStake(Number(e.target.value))}
              className="w-full bg-slate-950 border border-slate-800 rounded pl-6 pr-2 py-1.5 text-slate-100 font-mono font-bold text-xs text-center focus:border-cyan-500 focus:outline-none disabled:opacity-60"
              placeholder="5"
            />
          </div>

          {/* Increment Button */}
          <button
            type="button"
            disabled={isRunning}
            onClick={() => adjustStake(1)}
            className="w-8 h-8 rounded bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-slate-200 border border-slate-800 flex items-center justify-center font-bold text-xs transition-colors cursor-pointer"
            title="Increase stake by $1"
          >
            <Plus className="w-3 h-3" />
          </button>

          {/* Quick 2x button */}
          <button
            type="button"
            disabled={isRunning}
            onClick={() => adjustStake(stake)}
            className="px-2 h-8 rounded bg-slate-900 hover:bg-slate-800 text-[10px] font-mono text-cyan-400 border border-slate-800 font-bold transition-colors cursor-pointer"
            title="Double current stake"
          >
            2X
          </button>
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────
          5. TRADE TYPE & DURATION
      ───────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        {/* Trade Type */}
        <div className="space-y-1">
          <label className="text-[10px] font-semibold text-slate-400 uppercase font-mono">
            Contract Type
          </label>
          <select
            disabled={isRunning}
            value={contractType}
            onChange={(e) => setContractType(e.target.value as ContractType)}
            className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-slate-100 font-mono text-xs focus:border-cyan-500 focus:outline-none disabled:opacity-60 cursor-pointer"
          >
            <option value="CALL">Rise (Call)</option>
            <option value="PUT">Fall (Put)</option>
            <option value="EVEN">Digit Even</option>
            <option value="ODD">Digit Odd</option>
            <option value="DIFFERS">Digit Differs</option>
          </select>
        </div>

        {/* Trade Duration */}
        <div className="space-y-1">
          <label className="text-[10px] font-semibold text-slate-400 uppercase font-mono flex items-center justify-between">
            <span>Duration</span>
            <span className="text-[9px] text-slate-500 font-mono">Ticks</span>
          </label>
          <select
            disabled={isRunning}
            value={durationTicks}
            onChange={(e) => setDurationTicks(Number(e.target.value))}
            className="w-full bg-slate-950 border border-slate-800 rounded px-2 py-1.5 text-slate-100 font-mono text-xs focus:border-cyan-500 focus:outline-none disabled:opacity-60 cursor-pointer"
          >
            {[1, 2, 3, 5, 8, 10].map((t) => (
              <option key={t} value={t}>
                {t} {t === 1 ? 'Tick' : 'Ticks'}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────
          6. TARGET PROFIT AND MAXIMUM LOSS (RISK CONTROLS)
      ───────────────────────────────────────────────────────────── */}
      {executionMode === 'automated' && (
        <div className="grid grid-cols-2 gap-2 text-xs">
          {/* Target Profit */}
          <div className="space-y-1">
            <label className="text-[10px] font-semibold text-slate-400 uppercase font-mono flex items-center justify-between">
              <span>Target Profit</span>
              <span className="text-[9px] text-emerald-400 font-mono">TP</span>
            </label>
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                disabled={isRunning || targetProfit <= 1}
                onClick={() => adjustTargetProfit(-5)}
                className="w-6 h-7 rounded bg-slate-900 hover:bg-slate-800 text-slate-400 text-[10px] font-bold flex items-center justify-center border border-slate-800 cursor-pointer"
              >
                -
              </button>
              <div className="relative flex-1">
                <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-slate-500 font-mono text-[10px]">
                  $
                </span>
                <input
                  type="number"
                  min={1}
                  step={1}
                  disabled={isRunning}
                  value={targetProfit}
                  onChange={(e) => setTargetProfit(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-800 rounded pl-4 pr-1 py-1 text-slate-100 font-mono font-bold text-xs text-center focus:border-cyan-500 focus:outline-none disabled:opacity-60"
                  placeholder="20"
                />
              </div>
              <button
                type="button"
                disabled={isRunning}
                onClick={() => adjustTargetProfit(5)}
                className="w-6 h-7 rounded bg-slate-900 hover:bg-slate-800 text-slate-400 text-[10px] font-bold flex items-center justify-center border border-slate-800 cursor-pointer"
              >
                +
              </button>
            </div>
          </div>

          {/* Maximum Loss */}
          <div className="space-y-1">
            <label className="text-[10px] font-semibold text-slate-400 uppercase font-mono flex items-center justify-between">
              <span>Max Loss</span>
              <span className="text-[9px] text-rose-400 font-mono">SL</span>
            </label>
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                disabled={isRunning || maxLoss <= 1}
                onClick={() => adjustMaxLoss(-5)}
                className="w-6 h-7 rounded bg-slate-900 hover:bg-slate-800 text-slate-400 text-[10px] font-bold flex items-center justify-center border border-slate-800 cursor-pointer"
              >
                -
              </button>
              <div className="relative flex-1">
                <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-slate-500 font-mono text-[10px]">
                  $
                </span>
                <input
                  type="number"
                  min={1}
                  step={1}
                  disabled={isRunning}
                  value={maxLoss}
                  onChange={(e) => setMaxLoss(Number(e.target.value))}
                  className="w-full bg-slate-950 border border-slate-800 rounded pl-4 pr-1 py-1 text-slate-100 font-mono font-bold text-xs text-center focus:border-cyan-500 focus:outline-none disabled:opacity-60"
                  placeholder="15"
                />
              </div>
              <button
                type="button"
                disabled={isRunning}
                onClick={() => adjustMaxLoss(5)}
                className="w-6 h-7 rounded bg-slate-900 hover:bg-slate-800 text-slate-400 text-[10px] font-bold flex items-center justify-center border border-slate-800 cursor-pointer"
              >
                +
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          7. AUTOMATION STATUS & SESSION PROFIT/LOSS
      ───────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-2 bg-slate-950 p-2 rounded-lg border border-slate-800/80">
        <div>
          <span className="text-[9px] text-slate-500 block uppercase font-mono">
            Session Net P&L
          </span>
          <span
            className={`font-mono text-sm font-bold tabular-nums ${
              sessionStats.realizedPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            {sessionStats.realizedPnl >= 0
              ? `+$${sessionStats.realizedPnl.toFixed(2)}`
              : `-$${Math.abs(sessionStats.realizedPnl).toFixed(2)}`}
          </span>
        </div>

        <div>
          <span className="text-[9px] text-slate-500 block uppercase font-mono">
            Executed Trades
          </span>
          <span className="font-mono text-sm font-bold text-slate-200 tabular-nums">
            {sessionStats.tradesCount}{' '}
            <span className="text-[10px] text-slate-500 font-normal">
              ({sessionStats.wins}W / {sessionStats.losses}L)
            </span>
          </span>
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────
          8. BOT EXECUTION CONTROLS OR MANUAL 1-CLICK CONTROLS
      ───────────────────────────────────────────────────────────── */}
      {executionMode === 'automated' ? (
        <div className="space-y-1.5 pt-0.5">
          <div className="grid grid-cols-3 gap-1.5">
            {/* 1. START BOT */}
            <button
              type="button"
              onClick={handleStart}
              disabled={isRunning}
              className={`flex items-center justify-center gap-1 py-2 px-1.5 rounded-lg font-bold text-xs uppercase transition-all cursor-pointer ${
                isRunning
                  ? 'bg-slate-900 text-slate-500 border border-slate-800 cursor-not-allowed opacity-60'
                  : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-md shadow-emerald-950/40'
              }`}
              title="Start automated trading with configured settings"
            >
              <Play className="w-3 h-3 fill-current shrink-0" />
              <span className="truncate">START BOT</span>
            </button>

            {/* 2. STOP BOT */}
            <button
              type="button"
              onClick={onStopBot}
              disabled={!isRunning}
              className={`flex items-center justify-center gap-1 py-2 px-1.5 rounded-lg font-bold text-xs uppercase transition-all cursor-pointer ${
                isRunning
                  ? 'bg-amber-600 hover:bg-amber-500 text-white shadow-md shadow-amber-950/40'
                  : 'bg-slate-900 text-slate-500 border border-slate-800 cursor-not-allowed opacity-60'
              }`}
              title="Gracefully stop automated trades after current tick"
            >
              <Square className="w-3 h-3 fill-current shrink-0" />
              <span className="truncate">STOP BOT</span>
            </button>

            {/* 3. EMERGENCY STOP */}
            <button
              type="button"
              onClick={onEmergencyStop}
              className="flex items-center justify-center gap-1 py-2 px-1 rounded-lg bg-rose-700 hover:bg-rose-600 text-white font-bold text-xs uppercase transition-all shadow-md shadow-rose-950/40 cursor-pointer"
              title="Immediately halt all order processing and reset bot session"
            >
              <OctagonAlert className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">EMERGENCY</span>
            </button>
          </div>
        </div>
      ) : (
        /* Manual 1-Click Fast Trading Execution Buttons */
        <div className="space-y-1.5 pt-0.5">
          <div className="grid grid-cols-2 gap-2">
            {/* Rise (Call) */}
            <button
              type="button"
              onClick={() => onManualTrade && onManualTrade('CALL')}
              className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs uppercase transition-colors shadow-md shadow-emerald-950/40 cursor-pointer"
            >
              <ArrowUpRight className="w-4 h-4 stroke-[2.5]" />
              <span>RISE (CALL)</span>
            </button>

            {/* Fall (Put) */}
            <button
              type="button"
              onClick={() => onManualTrade && onManualTrade('PUT')}
              className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs uppercase transition-colors shadow-md shadow-rose-950/40 cursor-pointer"
            >
              <ArrowDownRight className="w-4 h-4 stroke-[2.5]" />
              <span>FALL (PUT)</span>
            </button>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          9. AI SCANNER, SCAN MARKET & SCAN & TRADE FOR ME
      ───────────────────────────────────────────────────────────── */}
      <div className="pt-2 border-t border-slate-800/80 space-y-1.5">
        <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono">
          <span className="flex items-center gap-1 uppercase tracking-wider font-semibold text-cyan-400">
            <Sparkles className="w-3 h-3" />
            <span>AI Market Scanner</span>
          </span>
          <span className="text-[9px] text-slate-500">Fast Setup</span>
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          {/* AI SCANNER Button */}
          <button
            type="button"
            onClick={onOpenAIScanner}
            className="flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg bg-cyan-950/80 hover:bg-cyan-900 text-cyan-300 border border-cyan-800 text-[11px] font-mono font-semibold transition-colors cursor-pointer"
            title="Open AI Scanner dialog"
          >
            <Sparkles className="w-3 h-3 text-cyan-400 shrink-0" />
            <span>AI SCANNER</span>
          </button>

          {/* SCAN MARKET Button */}
          <button
            type="button"
            onClick={onScanMarket}
            className="flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700 text-[11px] font-mono font-semibold transition-colors cursor-pointer"
            title="Run market scan to detect highest probability asset"
          >
            <Activity className="w-3 h-3 text-cyan-400 shrink-0" />
            <span>SCAN MARKET</span>
          </button>
        </div>

        {/* SCAN & TRADE FOR ME Button */}
        <button
          type="button"
          onClick={onScanAndTradeForMe}
          className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-gradient-to-r from-cyan-600 to-purple-600 hover:from-cyan-500 hover:to-purple-500 text-white font-mono font-bold text-xs uppercase tracking-wide transition-all shadow-md shadow-purple-950/30 cursor-pointer"
          title="AI scans markets, configures optimal bot strategy, and shows confirmation review"
        >
          <Bot className="w-3.5 h-3.5 shrink-0" />
          <span>SCAN &amp; TRADE FOR ME</span>
        </button>
      </div>

      {/* ─────────────────────────────────────────────────────────────
          10. RISK DISCLOSURE POLICY
      ───────────────────────────────────────────────────────────── */}
      <div className="p-2 rounded bg-slate-950/60 border border-slate-800/80 text-[9.5px] text-slate-400 flex items-start gap-1.5 font-mono leading-relaxed">
        <Info className="w-3 h-3 text-slate-500 shrink-0 mt-0.5" />
        <span>
          <strong>Open Positions Policy:</strong> Stopping halts subsequent trade orders. Placed trades resolve at expiry tick.
        </span>
      </div>
    </div>
  );
};
