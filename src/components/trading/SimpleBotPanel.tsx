import React, { useState, useEffect } from 'react';
import { ContractType, Market } from '../../types/trading';
import { storage } from '../../services/storage';
import { AdminRiskState } from '../../services/authClient';
import {
  Play,
  Square,
  AlertTriangle,
  ShieldAlert,
  ShieldCheck,
  RotateCcw,
  Sliders,
  Info,
  OctagonAlert,
  Sparkles,
  Bot,
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
  botPhase?: string;
  liveSignalLabel?: string;
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
  onManualTrade?: (type: ContractType, stake?: number, durationTicks?: number) => void;
  adminRiskState?: AdminRiskState | null;
  onResetRiskPeriod?: (maxLoss?: number) => Promise<void>;
}

export const SimpleBotPanel: React.FC<SimpleBotPanelProps> = ({
  market,
  onSelectMarket,
  availableMarkets,
  tradingMode,
  availableBalance,
  botStatus,
  botPhase,
  liveSignalLabel,
  stopReason,
  onStartBot,
  onStopBot,
  onEmergencyStop,
  sessionStats,
  onOpenAIScanner,
  onScanMarket,
  onScanAndTradeForMe,
  activeTradesCount,
  onManualTrade,
  adminRiskState,
  onResetRiskPeriod,
}) => {
  const [initialPrefs] = useState(() => storage.getBotPreferences());
  const [executionMode, setExecutionMode] = useState<TradingExecutionMode>(initialPrefs.executionMode);

  const [targetProfit, setTargetProfit] = useState<number>(initialPrefs.targetProfit);
  const [maxLoss, setMaxLoss] = useState<number>(initialPrefs.maxLoss);
  const [stake, setStake] = useState<number>(initialPrefs.stake);
  const [contractType, setContractType] = useState<ContractType>(initialPrefs.contractType);
  const [durationTicks, setDurationTicks] = useState<number>(initialPrefs.durationTicks);
  const [validationError, setValidationError] = useState<string>('');
  const [isMarketDropdownOpen, setIsMarketDropdownOpen] = useState<boolean>(false);
  const [confirmingPeriodReset, setConfirmingPeriodReset] = useState<boolean>(false);
  const [resettingPeriod, setResettingPeriod] = useState<boolean>(false);

  useEffect(() => {
    storage.saveBotPreferences({
      executionMode,
      stake,
      contractType,
      durationTicks,
      targetProfit,
      maxLoss,
    });
  }, [executionMode, stake, contractType, durationTicks, targetProfit, maxLoss]);

  const isRunning = botStatus === 'running' || botStatus === 'stopping';
  const payoutRate = market.payoutRate || 0.95;
  const safeStake = Number.isFinite(stake) && stake > 0 ? stake : 0;
  const estimatedProfit = Number((safeStake * payoutRate).toFixed(2));
  const estimatedPayout = Number((safeStake + estimatedProfit).toFixed(2));

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

  const hasPeriodLock = Boolean(
    adminRiskState?.enabled &&
      (adminRiskState.totalLosses >= adminRiskState.maxTotalLosses ||
        adminRiskState.haltCode === 'MAX_TOTAL_LOSSES' ||
        adminRiskState.cumulativeLoss >= adminRiskState.configuredMaxLoss ||
        adminRiskState.haltCode === 'MAX_LOSS_REACHED')
  );

  const handleConfirmPeriodReset = async () => {
    if (!onResetRiskPeriod || resettingPeriod) return;
    setResettingPeriod(true);
    setValidationError('');
    try {
      await onResetRiskPeriod(maxLoss);
      setConfirmingPeriodReset(false);
    } catch (err) {
      setValidationError(err instanceof Error ? err.message : 'Could not reset risk period.');
    } finally {
      setResettingPeriod(false);
    }
  };

  const handleStart = () => {
    setValidationError('');

    if (tradingMode === 'real') {
      setValidationError('Switch to Demo account to run the automated bot.');
      return;
    }
    if (adminRiskState?.enabled) {
      if (adminRiskState.totalLosses >= adminRiskState.maxTotalLosses || adminRiskState.haltCode === 'MAX_TOTAL_LOSSES') {
        setValidationError(
          'Maximum 5 total losing trades reached for this risk-control period. Reset the risk period before restarting.'
        );
        return;
      }
      if (adminRiskState.cumulativeLoss >= adminRiskState.configuredMaxLoss || adminRiskState.haltCode === 'MAX_LOSS_REACHED') {
        setValidationError(
          `Maximum loss threshold reached ($${adminRiskState.cumulativeLoss.toFixed(2)} / $${adminRiskState.configuredMaxLoss.toFixed(2)}). Reset the risk period before restarting.`
        );
        return;
      }
      if (stake > adminRiskState.remainingLossAllowance) {
        setValidationError(
          `Stake ($${stake.toFixed(2)}) exceeds remaining max loss allowance ($${adminRiskState.remainingLossAllowance.toFixed(2)}).`
        );
        return;
      }
    }
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

  const handleManualClick = (type: ContractType) => {
    setValidationError('');
    if (adminRiskState?.enabled) {
      if (adminRiskState.halted) {
        setValidationError(
          adminRiskState.haltReason || 'Risk protection has locked trading until manual intervention.'
        );
        return;
      }
      if (stake > adminRiskState.remainingLossAllowance) {
        setValidationError(
          `Trade blocked: stake ($${stake.toFixed(2)}) exceeds remaining max loss allowance ($${adminRiskState.remainingLossAllowance.toFixed(2)}).`
        );
        return;
      }
    }
    if (stake < (market.minStake || 1)) {
      setValidationError(`Minimum stake for ${market.displayName} is $${market.minStake || 1}.00.`);
      return;
    }
    if (stake > availableBalance) {
      setValidationError(`Stake ($${stake}) exceeds available balance ($${availableBalance.toFixed(2)}).`);
      return;
    }
    if (onManualTrade) {
      onManualTrade(type, stake, durationTicks);
    }
  };

  const getStatusBadge = () => {
    switch (botStatus) {
      case 'running':
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-800/80 text-[10px] font-mono font-semibold">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span>{activeTradesCount > 0 ? 'IN POSITION' : botPhase || 'ANALYZING'}</span>
          </span>
        );
      case 'stopping':
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-amber-950/80 text-amber-300 border border-amber-800/80 text-[10px] font-mono font-semibold">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
            <span>STOPPING</span>
          </span>
        );
      case 'stopped':
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-slate-900 text-rose-300 border border-rose-800/70 text-[10px] font-mono font-semibold">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
            <span>{botPhase || 'STOPPED'}</span>
          </span>
        );
      case 'error':
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-rose-950/80 text-rose-300 border border-rose-800/80 text-[10px] font-mono font-semibold">
            <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
            <span>PAUSED</span>
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-slate-900 text-slate-400 border border-slate-800 text-[10px] font-mono font-semibold">
            <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
            <span>IDLE</span>
          </span>
        );
    }
  };

  const winRate =
    sessionStats.tradesCount > 0
      ? Math.round((sessionStats.wins / sessionStats.tradesCount) * 100)
      : 0;

  return (
    <div className="space-y-1.5 select-none text-slate-200">
      {/* 1. Trade Ticket Header */}
      <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-slate-800/80">
        <div className="flex items-center gap-2">
          <Sliders className="w-3.5 h-3.5 text-cyan-400" />
          <h2 className="text-xs font-semibold text-slate-100 font-mono tracking-wide uppercase">
            Order Ticket
          </h2>
          <span
            className={`text-[9px] font-mono px-1.5 py-0.5 rounded font-semibold uppercase ${
              tradingMode === 'real'
                ? 'bg-emerald-950/90 text-emerald-300 border border-emerald-800/80'
                : 'bg-amber-950/90 text-amber-300 border border-amber-800/80'
            }`}
          >
            {tradingMode}
          </span>
        </div>

        <div className="shrink-0">{getStatusBadge()}</div>
      </div>

      {/* 2. Execution Mode Selector */}
      <div className="grid grid-cols-2 gap-1 bg-slate-950 p-0.5 rounded-md border border-slate-800 text-[10px] font-mono">
        <button
          type="button"
          onClick={() => setExecutionMode('automated')}
          className={`py-1 px-2 rounded-sm font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
            executionMode === 'automated'
              ? 'bg-slate-800 text-cyan-300 border border-slate-700'
              : 'text-slate-400 hover:text-slate-200 border border-transparent'
          }`}
        >
          <Bot className="w-3 h-3" />
          <span>Automated Bot</span>
        </button>

        <button
          type="button"
          onClick={() => setExecutionMode('manual')}
          className={`py-1 px-2 rounded-sm font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
            executionMode === 'manual'
              ? 'bg-slate-800 text-cyan-300 border border-slate-700'
              : 'text-slate-400 hover:text-slate-200 border border-transparent'
          }`}
        >
          <Zap className="w-3 h-3 text-amber-400" />
          <span>Manual 1-Click</span>
        </button>
      </div>

      {/* 3. Selected Instrument & Payout */}
      <div className="flex items-center justify-between gap-2 px-2 py-1 rounded-md bg-slate-950 border border-slate-800/90 text-xs">
        <div className="min-w-0 flex-1">
          <span className="text-[9px] text-slate-500 uppercase font-mono block">
            Instrument
          </span>
          {availableMarkets && onSelectMarket ? (
            <div className="relative">
              <button
                type="button"
                disabled={isRunning}
                onClick={() => setIsMarketDropdownOpen(!isMarketDropdownOpen)}
                className="flex items-center gap-1 text-[11px] font-semibold text-slate-100 hover:text-cyan-300 font-mono transition-colors disabled:opacity-60 cursor-pointer"
              >
                <span className="truncate max-w-[175px]">{market.displayName}</span>
                <ChevronDown className="w-3 h-3 text-slate-400 shrink-0" />
              </button>

              {isMarketDropdownOpen && (
                <div className="absolute left-0 top-full mt-1 w-64 bg-[#0D1322] border border-slate-700 rounded-md shadow-2xl p-1 z-50 space-y-0.5 max-h-56 overflow-y-auto">
                  <div className="px-2 py-1 text-[9px] font-mono uppercase text-slate-500 font-semibold border-b border-slate-800">
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
                      className={`w-full text-left p-1.5 rounded-sm flex items-center justify-between text-xs transition-colors cursor-pointer ${
                        market.symbol === m.symbol
                          ? 'bg-slate-800 text-cyan-300 font-semibold'
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
            <span className="text-[11px] font-semibold font-mono text-slate-200">{market.displayName}</span>
          )}
        </div>

        <div className="text-right shrink-0">
          <span className="text-[9px] text-slate-500 uppercase font-mono block">Return</span>
          <span className="text-[11px] font-mono font-semibold text-emerald-400 tabular-nums">
            +{Math.round(payoutRate * 100)}%
          </span>
        </div>
      </div>

      {/* Stop / Error Alerts */}
      {stopReason && (
        <div className="p-2 rounded-md bg-amber-950/25 border border-amber-500/30 text-amber-200 text-[10px] flex items-center gap-1.5 font-mono">
          <AlertTriangle className="w-3 h-3 shrink-0 text-amber-400" />
          <span>{stopReason}</span>
        </div>
      )}

      {validationError && (
        <div className="p-2 rounded-md bg-rose-950/25 border border-rose-500/30 text-rose-200 text-[10px] flex items-center gap-1.5 font-mono">
          <ShieldAlert className="w-3 h-3 shrink-0 text-rose-400" />
          <span>{validationError}</span>
        </div>
      )}

      {/* 4. Stake Amount */}
      <div className="space-y-0.5">
        <label className="text-[10px] font-semibold text-slate-400 uppercase font-mono flex items-center justify-between">
          <span>Stake</span>
          <span className="text-[9px] text-slate-500 font-mono">Min ${market.minStake || 1}</span>
        </label>

        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={isRunning || stake <= (market.minStake || 1)}
            onClick={() => adjustStake(-1)}
            className="w-7 h-7 rounded-md bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-slate-200 border border-slate-800 flex items-center justify-center font-semibold text-xs transition-colors cursor-pointer"
            title="Decrease stake by $1"
          >
            <Minus className="w-3 h-3" />
          </button>

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
              className="w-full h-7 bg-slate-950 border border-slate-800 rounded-md pl-6 pr-2 text-slate-100 font-mono font-semibold text-xs text-center tabular-nums focus:border-cyan-500 focus:outline-none disabled:opacity-60"
              placeholder="5"
            />
          </div>

          <button
            type="button"
            disabled={isRunning}
            onClick={() => adjustStake(1)}
            className="w-7 h-7 rounded-md bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-slate-200 border border-slate-800 flex items-center justify-center font-semibold text-xs transition-colors cursor-pointer"
            title="Increase stake by $1"
          >
            <Plus className="w-3 h-3" />
          </button>

          <button
            type="button"
            disabled={isRunning}
            onClick={() => adjustStake(stake)}
            className="px-2 h-7 rounded-md bg-slate-900 hover:bg-slate-800 text-[10px] font-mono text-cyan-300 border border-slate-800 font-semibold transition-colors cursor-pointer"
            title="Double stake"
          >
            2X
          </button>
        </div>
      </div>

      {/* 5. Contract Type & Duration */}
      <div className="grid grid-cols-2 gap-1.5 text-xs">
        <div className="space-y-0.5">
          <label className="text-[10px] font-semibold text-slate-400 uppercase font-mono">
            Contract
          </label>
          <select
            disabled={isRunning}
            value={contractType}
            onChange={(e) => setContractType(e.target.value as ContractType)}
            className="w-full h-7 bg-slate-950 border border-slate-800 rounded-md px-2 text-slate-100 font-mono text-xs focus:border-cyan-500 focus:outline-none disabled:opacity-60 cursor-pointer"
          >
            <option value="CALL">Rise (Call)</option>
            <option value="PUT">Fall (Put)</option>
            <option value="EVEN">Digit Even</option>
            <option value="ODD">Digit Odd</option>
            <option value="DIFFERS">Digit Differs</option>
          </select>
        </div>

        <div className="space-y-0.5">
          <label className="text-[10px] font-semibold text-slate-400 uppercase font-mono flex items-center justify-between">
            <span>Duration</span>
            <span className="text-[9px] text-slate-500 font-mono">Ticks</span>
          </label>
          <select
            disabled={isRunning}
            value={durationTicks}
            onChange={(e) => setDurationTicks(Number(e.target.value))}
            className="w-full h-7 bg-slate-950 border border-slate-800 rounded-md px-2 text-slate-100 font-mono text-xs focus:border-cyan-500 focus:outline-none disabled:opacity-60 cursor-pointer"
          >
            {[1, 2, 3, 5, 8, 10].map((t) => (
              <option key={t} value={t}>
                {t} {t === 1 ? 'Tick' : 'Ticks'}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Payout Summary Row */}
      <div className="px-2 py-1 rounded-md bg-slate-950/80 border border-slate-800/80 flex items-center justify-between text-[10px] font-mono">
        <span className="text-slate-400">Projected Payout</span>
        <span className="text-slate-100 font-semibold tabular-nums">
          ${estimatedPayout.toFixed(2)}{' '}
          <span className="text-emerald-400">(+${estimatedProfit.toFixed(2)})</span>
        </span>
      </div>

      {/* 6. Target Profit & Max Loss */}
      {executionMode === 'automated' && (
        <div className="grid grid-cols-2 gap-1.5 text-xs">
          <div className="space-y-0.5">
            <label className="text-[10px] font-semibold text-slate-400 uppercase font-mono flex items-center justify-between">
              <span>Target Profit</span>
              <span className="text-[9px] text-emerald-400 font-mono">TP</span>
            </label>
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                disabled={isRunning || targetProfit <= 1}
                onClick={() => adjustTargetProfit(-5)}
                className="w-6 h-7 rounded-md bg-slate-900 hover:bg-slate-800 text-slate-400 text-[10px] font-semibold flex items-center justify-center border border-slate-800 cursor-pointer"
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
                  className="w-full bg-slate-950 border border-slate-800 rounded-md pl-4 pr-1 py-1 text-slate-100 font-mono font-semibold text-xs text-center tabular-nums focus:border-cyan-500 focus:outline-none disabled:opacity-60"
                  placeholder="20"
                />
              </div>
              <button
                type="button"
                disabled={isRunning}
                onClick={() => adjustTargetProfit(5)}
                className="w-6 h-7 rounded-md bg-slate-900 hover:bg-slate-800 text-slate-400 text-[10px] font-semibold flex items-center justify-center border border-slate-800 cursor-pointer"
              >
                +
              </button>
            </div>
          </div>

          <div className="space-y-0.5">
            <label className="text-[10px] font-semibold text-slate-400 uppercase font-mono flex items-center justify-between">
              <span>Max Loss</span>
              <span className="text-[9px] text-rose-400 font-mono">SL</span>
            </label>
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                disabled={isRunning || maxLoss <= 1}
                onClick={() => adjustMaxLoss(-5)}
                className="w-6 h-7 rounded-md bg-slate-900 hover:bg-slate-800 text-slate-400 text-[10px] font-semibold flex items-center justify-center border border-slate-800 cursor-pointer"
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
                  className="w-full bg-slate-950 border border-slate-800 rounded-md pl-4 pr-1 py-1 text-slate-100 font-mono font-semibold text-xs text-center tabular-nums focus:border-cyan-500 focus:outline-none disabled:opacity-60"
                  placeholder="15"
                />
              </div>
              <button
                type="button"
                disabled={isRunning}
                onClick={() => adjustMaxLoss(5)}
                className="w-6 h-7 rounded-md bg-slate-900 hover:bg-slate-800 text-slate-400 text-[10px] font-semibold flex items-center justify-center border border-slate-800 cursor-pointer"
              >
                +
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 7. Session Telemetry */}
      <div className="grid grid-cols-2 gap-1.5 bg-slate-950 px-2 py-1.5 rounded-md border border-slate-800/80">
        <div>
          <span className="text-[9px] text-slate-500 block uppercase font-mono">
            Session Net P&amp;L
          </span>
          <span
            className={`font-mono text-sm font-semibold tabular-nums ${
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
            Trades / Win Rate
          </span>
          <span className="font-mono text-sm font-semibold text-slate-200 tabular-nums">
            {sessionStats.tradesCount}{' '}
            <span className="text-[10px] text-slate-400 font-normal">
              ({sessionStats.wins}W/{sessionStats.losses}L • {winRate}%)
            </span>
          </span>
        </div>
      </div>

      {/* Exclusive Admin Risk Guard Summary */}
      {adminRiskState?.enabled && (
        <div
          className={`p-2 rounded-md border space-y-1.5 text-[10px] font-mono ${
            adminRiskState.halted
              ? 'bg-rose-950/30 border-rose-500/40 text-rose-200'
              : 'bg-slate-950/90 border-cyan-500/25 text-slate-300'
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1 font-semibold uppercase tracking-wider text-cyan-300">
              {adminRiskState.halted ? (
                <ShieldAlert className="w-3 h-3 text-rose-400 shrink-0" />
              ) : (
                <ShieldCheck className="w-3 h-3 text-emerald-400 shrink-0" />
              )}
              <span>Admin Risk Guard</span>
            </span>
            <span className="text-[9px] text-slate-400">
              Rem: ${adminRiskState.remainingLossAllowance.toFixed(2)}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-1 text-[9px] tabular-nums">
            <div className="px-1.5 py-1 rounded bg-slate-900/90 border border-slate-800">
              <span className="text-slate-500 block">Streak</span>
              <span className="font-semibold text-slate-100">
                {adminRiskState.consecutiveLosses}/{adminRiskState.maxConsecutiveLosses}
              </span>
            </div>
            <div className="px-1.5 py-1 rounded bg-slate-900/90 border border-slate-800">
              <span className="text-slate-500 block">Period Losses</span>
              <span className="font-semibold text-slate-100">
                {adminRiskState.totalLosses}/{adminRiskState.maxTotalLosses}
              </span>
            </div>
            <div className="px-1.5 py-1 rounded bg-slate-900/90 border border-slate-800">
              <span className="text-slate-500 block">Max Loss</span>
              <span className="font-semibold text-slate-100">
                ${adminRiskState.cumulativeLoss.toFixed(0)}/${adminRiskState.configuredMaxLoss.toFixed(0)}
              </span>
            </div>
          </div>

          {onResetRiskPeriod && (adminRiskState.halted || adminRiskState.totalLosses > 0 || adminRiskState.cumulativeLoss > 0) && (
            <div className="pt-0.5">
              {!confirmingPeriodReset ? (
                <button
                  type="button"
                  disabled={isRunning || activeTradesCount > 0}
                  onClick={() => setConfirmingPeriodReset(true)}
                  className="w-full py-1 px-2 rounded bg-slate-900 hover:bg-slate-800 disabled:opacity-40 border border-slate-700/80 text-cyan-300 font-semibold text-[9px] uppercase flex items-center justify-center gap-1 cursor-pointer transition-colors"
                >
                  <RotateCcw className="w-2.5 h-2.5" />
                  <span>Reset Risk Period</span>
                </button>
              ) : (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={resettingPeriod}
                    onClick={handleConfirmPeriodReset}
                    className="flex-1 py-1 px-2 rounded bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold text-[9px] uppercase cursor-pointer"
                  >
                    {resettingPeriod ? 'Resetting...' : 'Confirm Reset'}
                  </button>
                  <button
                    type="button"
                    disabled={resettingPeriod}
                    onClick={() => setConfirmingPeriodReset(false)}
                    className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[9px] uppercase cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 8. Execution Actions */}
      {executionMode === 'automated' ? (
        <div className="flex items-center gap-1.5 w-full">
          <button
            type="button"
            onClick={handleStart}
            disabled={isRunning || hasPeriodLock}
            className={`flex-1 min-w-0 h-8 flex items-center justify-center gap-1 px-2 rounded-md border font-semibold text-[11px] uppercase tracking-wide transition-colors cursor-pointer ${
              isRunning || hasPeriodLock
                ? 'bg-slate-900 text-slate-500 border-slate-800 cursor-not-allowed opacity-60'
                : 'bg-emerald-600 hover:bg-emerald-500 border-emerald-500/40 text-white'
            }`}
            title={hasPeriodLock ? 'Reset risk-control period before restarting' : 'Start automated trading'}
          >
            <Play className="w-3 h-3 fill-current shrink-0" />
            <span className="truncate">Start</span>
          </button>

          <button
            type="button"
            onClick={onStopBot}
            disabled={!isRunning}
            className={`flex-1 min-w-0 h-8 flex items-center justify-center gap-1 px-2 rounded-md border font-semibold text-[11px] uppercase tracking-wide transition-colors cursor-pointer ${
              isRunning
                ? 'bg-amber-600 hover:bg-amber-500 border-amber-500/40 text-white'
                : 'bg-slate-900 text-slate-500 border-slate-800 cursor-not-allowed opacity-60'
            }`}
            title="Stop automated trading"
          >
            <Square className="w-3 h-3 fill-current shrink-0" />
            <span className="truncate">Stop</span>
          </button>

          <button
            type="button"
            onClick={onEmergencyStop}
            className="flex-1 min-w-0 h-8 flex items-center justify-center gap-1 px-2 rounded-md border border-rose-500/40 bg-rose-700 hover:bg-rose-600 text-white font-semibold text-[11px] uppercase tracking-wide transition-colors cursor-pointer"
            title="Immediately halt all automated order execution"
          >
            <OctagonAlert className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">Halt</span>
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-1.5 w-full">
          <button
            type="button"
            onClick={() => handleManualClick('CALL')}
            className="flex-1 min-w-0 h-9 flex items-center justify-center gap-1.5 px-3 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs uppercase tracking-wide transition-colors cursor-pointer"
          >
            <ArrowUpRight className="w-4 h-4 stroke-[2.2]" />
            <span>Rise</span>
          </button>

          <button
            type="button"
            onClick={() => handleManualClick('PUT')}
            className="flex-1 min-w-0 h-9 flex items-center justify-center gap-1.5 px-3 rounded-md bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs uppercase tracking-wide transition-colors cursor-pointer"
          >
            <ArrowDownRight className="w-4 h-4 stroke-[2.2]" />
            <span>Fall</span>
          </button>
        </div>
      )}

      {/* 9. Market Scanner Tools */}
      <div className="pt-1.5 border-t border-slate-800/80">
        <div className="flex items-center gap-1.5 w-full">
          <button
            type="button"
            onClick={onOpenAIScanner}
            className="flex-1 min-w-0 h-8 flex items-center justify-center gap-1.5 px-2 rounded-md bg-slate-900 hover:bg-slate-800 text-cyan-300 border border-slate-700/80 text-[11px] font-mono font-semibold transition-colors cursor-pointer"
          >
            <Sparkles className="w-3 h-3 text-cyan-400 shrink-0" />
            <span className="truncate">AI Scanner</span>
          </button>

          <button
            type="button"
            onClick={onScanAndTradeForMe}
            className="flex-1 min-w-0 h-8 flex items-center justify-center gap-1.5 px-2 rounded-md bg-cyan-700 hover:bg-cyan-600 border border-cyan-600/40 text-white text-[11px] font-mono font-semibold transition-colors cursor-pointer"
            title="Scan instruments and configure optimal automated strategy"
          >
            <Bot className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">Auto Setup</span>
          </button>
        </div>
      </div>
    </div>
  );
};
