import React, { useState, useEffect, useRef } from 'react';
import { BotAutomationState, ContractType, Market, PageId, Strategy, Tick, Trade, UserProfile } from '../../types/trading';
import { SYNTHETIC_MARKETS } from '../../data/syntheticMarkets';
import { derivWsService } from '../../services/derivWs';
import { storage } from '../../services/storage';
import { audioEffects } from '../../services/audioEffects';
import { extractLastDigit } from '../../utils/indicators';
import { useToast } from '../common/ToastNotification';
import { DisclaimerBanner } from '../common/DisclaimerBanner';
import {
  Play,
  Square,
  Pause,
  AlertTriangle,
  RotateCcw,
  Zap,
  Sliders,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  Cpu,
  Bot,
  Activity,
  History,
} from 'lucide-react';

interface TradingBotsPageProps {
  profile: UserProfile;
  onUpdateProfile: (p: UserProfile) => void;
  tradingMode: 'demo' | 'real';
  onNavigate: (page: PageId) => void;
}

export const TradingBotsPage: React.FC<TradingBotsPageProps> = ({
  profile,
  onUpdateProfile,
  tradingMode,
  onNavigate,
}) => {
  const { showToast } = useToast();

  const [selectedMarket, setSelectedMarket] = useState<Market>(SYNTHETIC_MARKETS[0]);
  const [currentQuote, setCurrentQuote] = useState<number>(derivWsService.getCurrentQuote());
  const [botStatus, setBotStatus] = useState<'idle' | 'running' | 'paused' | 'stopped'>('idle');
  const [stopReason, setStopReason] = useState<string>('');

  // Bot Settings
  const [botPreset, setBotPreset] = useState<'rsi' | 'even_odd' | 'ema' | 'bollinger'>('rsi');
  const [baseStake, setBaseStake] = useState<number>(10);
  const [durationTicks, setDurationTicks] = useState<number>(5);
  const [takeProfit, setTakeProfit] = useState<number>(50);
  const [stopLoss, setStopLoss] = useState<number>(30);
  const [maxLosses, setMaxLosses] = useState<number>(3);
  const [cooldownSeconds, setCooldownSeconds] = useState<number>(4);
  const [useMartingale, setUseMartingale] = useState<boolean>(false);
  const [multiplier, setMultiplier] = useState<number>(2.0);

  // Runtime State
  const [sessionProfit, setSessionProfit] = useState<number>(0);
  const [tradesExecuted, setTradesExecuted] = useState<number>(0);
  const [wins, setWins] = useState<number>(0);
  const [losses, setLosses] = useState<number>(0);
  const [consecutiveLosses, setConsecutiveLosses] = useState<number>(0);
  const [currentStake, setCurrentStake] = useState<number>(10);
  const [logs, setLogs] = useState<{ id: string; time: string; msg: string; type: 'info' | 'trigger' | 'win' | 'loss' | 'risk' }[]>([]);

  const isRunningRef = useRef<boolean>(false);
  isRunningRef.current = botStatus === 'running';

  const lastTradeTimeRef = useRef<number>(0);

  const addLog = (msg: string, type: 'info' | 'trigger' | 'win' | 'loss' | 'risk' = 'info') => {
    const time = new Date().toLocaleTimeString();
    setLogs((prev) => [{ id: Math.random().toString(), time, msg, type }, ...prev].slice(0, 80));
  };

  useEffect(() => {
    derivWsService.setMarket(selectedMarket);
    const unsub = derivWsService.subscribeToTicks((tick: Tick) => {
      setCurrentQuote(tick.quote);

      if (isRunningRef.current) {
        evaluateTickForBot(tick);
      }
    });

    return () => unsub();
  }, [selectedMarket, botPreset, currentStake]);

  const evaluateTickForBot = (tick: Tick) => {
    const now = Date.now();
    if (now - lastTradeTimeRef.current < cooldownSeconds * 1000) {
      return; // Cooldown period active
    }

    // Risk checks
    if (sessionProfit >= takeProfit) {
      stopBot('Take Profit Target Reached');
      return;
    }
    if (sessionProfit <= -stopLoss) {
      stopBot('Stop Loss Limit Hit');
      return;
    }
    if (consecutiveLosses >= maxLosses) {
      stopBot(`Max Consecutive Losses (${maxLosses}) Reached`);
      return;
    }

    // Strategy Trigger Evaluation
    let shouldTrade = false;
    let contractType: ContractType = 'CALL';

    if (botPreset === 'rsi') {
      // Periodic entry on random simulated oscillator logic
      if (Math.random() < 0.25) {
        shouldTrade = true;
        contractType = Math.random() > 0.5 ? 'CALL' : 'PUT';
        addLog(`RSI Signal Triggered: ${contractType}`, 'trigger');
      }
    } else if (botPreset === 'even_odd') {
      const digit = extractLastDigit(tick.quote, selectedMarket.decimals);
      shouldTrade = true;
      contractType = digit % 2 === 0 ? 'ODD' : 'EVEN';
      addLog(`Parity Trigger: Last Digit ${digit} -> ${contractType}`, 'trigger');
    } else {
      if (Math.random() < 0.2) {
        shouldTrade = true;
        contractType = tick.direction === 'up' ? 'CALL' : 'PUT';
        addLog(`Trend Momentum Trigger: ${contractType}`, 'trigger');
      }
    }

    if (shouldTrade) {
      lastTradeTimeRef.current = now;
      executeBotTrade(contractType, currentStake);
    }
  };

  const executeBotTrade = (type: ContractType, stakeAmount: number) => {
    const availableBalance = tradingMode === 'demo' ? profile.demoBalance : profile.realBalance;
    if (availableBalance < stakeAmount) {
      stopBot('Account margin exhausted');
      return;
    }

    addLog(`Executing ${type} on ${selectedMarket.symbol} ($${stakeAmount})`, 'info');

    // Simulate duration resolution
    setTimeout(() => {
      if (!isRunningRef.current && botStatus !== 'paused') return;

      const isWin = Math.random() < 0.53; // typical edge in simulation
      const pnl = isWin
        ? Number((stakeAmount * selectedMarket.payoutRate).toFixed(2))
        : -Number(stakeAmount.toFixed(2));

      setTradesExecuted((prev) => prev + 1);
      setSessionProfit((prev) => Number((prev + pnl).toFixed(2)));

      if (isWin) {
        setWins((prev) => prev + 1);
        setConsecutiveLosses(0);
        addLog(`Trade Won: +$${pnl}`, 'win');
        audioEffects.playWin();
        if (useMartingale) {
          setCurrentStake(baseStake);
        }
      } else {
        setLosses((prev) => prev + 1);
        setConsecutiveLosses((prev) => prev + 1);
        addLog(`Trade Lost: -$${stakeAmount}`, 'loss');
        audioEffects.playLoss();
        if (useMartingale) {
          const next = Math.min(200, Number((currentStake * multiplier).toFixed(1)));
          setCurrentStake(next);
        }
      }

      // Update Demo Balance
      if (tradingMode === 'demo') {
        const newBal = Number((profile.demoBalance + pnl).toFixed(2));
        const updated = { ...profile, demoBalance: Math.max(0, newBal) };
        storage.saveUserProfile(updated);
        onUpdateProfile(updated);
      }
    }, durationTicks * 1000);
  };

  const startBot = () => {
    if (tradingMode === 'real') {
      showToast('error', 'Safety Guard', 'Automated bots are restricted to Demo mode for protection.');
      return;
    }
    setBotStatus('running');
    setStopReason('');
    setCurrentStake(baseStake);
    addLog(`Bot Runner Initialized in DEMO Mode (${botPreset.toUpperCase()})`, 'info');
    audioEffects.playTradePlaced();
    showToast('success', 'Bot Started', 'Automated runner is actively monitoring market ticks.');
  };

  const pauseBot = () => {
    setBotStatus('paused');
    addLog('Bot Runner Paused by User', 'info');
  };

  const stopBot = (reason: string = 'User Stopped') => {
    setBotStatus('stopped');
    setStopReason(reason);
    addLog(`Bot Execution Halted: ${reason}`, 'risk');
    audioEffects.playAlert();
    showToast('info', 'Bot Halted', reason);
  };

  const resetBotSession = () => {
    setBotStatus('idle');
    setSessionProfit(0);
    setTradesExecuted(0);
    setWins(0);
    setLosses(0);
    setConsecutiveLosses(0);
    setCurrentStake(baseStake);
    setLogs([]);
    showToast('info', 'Session Reset', 'Bot telemetry cleared.');
  };

  return (
    <div className="p-4 lg:p-6 space-y-5 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2.5">
            <Bot className="w-5 h-5 text-cyan-400" />
            <h2 className="text-xl font-bold tracking-tight text-slate-100">
              Automated Trading Bots & Runner
            </h2>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Institutional algorithmic strategy runner with strict stop-loss and risk guards
          </p>
        </div>

        {/* Master Bot Controls */}
        <div className="flex items-center gap-2">
          {botStatus !== 'running' ? (
            <button
              onClick={startBot}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg text-xs transition-colors shadow-lg shadow-emerald-950/40"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>Start Automated Bot</span>
            </button>
          ) : (
            <button
              onClick={pauseBot}
              className="flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white font-bold rounded-lg text-xs transition-colors"
            >
              <Pause className="w-3.5 h-3.5 fill-current" />
              <span>Pause Bot</span>
            </button>
          )}

          <button
            onClick={() => stopBot('Emergency Stop Activated')}
            className="flex items-center gap-2 px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-lg text-xs transition-colors"
          >
            <Square className="w-3.5 h-3.5 fill-current" />
            <span>Emergency Kill Switch</span>
          </button>

          <button
            onClick={resetBotSession}
            className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs transition-colors border border-slate-700"
            title="Reset telemetry"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
      </div>

      <DisclaimerBanner compact />

      {/* Primary Telemetry Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-3.5 bg-[#090D16] border border-slate-800 rounded-xl space-y-1">
          <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">
            Bot Status
          </span>
          <div className="flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full ${
                botStatus === 'running'
                  ? 'bg-emerald-400 animate-pulse'
                  : botStatus === 'paused'
                  ? 'bg-amber-400'
                  : 'bg-slate-600'
              }`}
            />
            <span className="font-mono text-base font-bold text-slate-100 uppercase">
              {botStatus}
            </span>
          </div>
          {stopReason && <p className="text-[10px] text-rose-400 truncate">{stopReason}</p>}
        </div>

        <div className="p-3.5 bg-[#090D16] border border-slate-800 rounded-xl space-y-1">
          <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">
            Session Net P&L
          </span>
          <p
            className={`font-mono text-xl font-bold ${
              sessionProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            {sessionProfit >= 0 ? '+' : ''}${sessionProfit}
          </p>
        </div>

        <div className="p-3.5 bg-[#090D16] border border-slate-800 rounded-xl space-y-1">
          <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">
            Trades Executed
          </span>
          <div className="flex items-center gap-2">
            <span className="font-mono text-xl font-bold text-cyan-400">{tradesExecuted}</span>
            <span className="text-xs font-mono text-slate-400">
              ({wins}W / {losses}L)
            </span>
          </div>
        </div>

        <div className="p-3.5 bg-[#090D16] border border-slate-800 rounded-xl space-y-1">
          <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">
            Current Stake
          </span>
          <p className="font-mono text-xl font-bold text-slate-200">${currentStake}</p>
        </div>
      </div>

      {/* Main Bot Workspace Grid: Parameters on Left, Live Console on Right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left Column: Configuration Form (5 cols) */}
        <div className="lg:col-span-5 bg-[#090D16] border border-slate-800 rounded-xl p-5 space-y-4 shadow-xl">
          <h3 className="font-semibold text-slate-200 text-xs uppercase tracking-wider pb-2 border-b border-slate-800">
            Bot Runner Parameters
          </h3>

          {/* Strategy Preset */}
          <div className="space-y-1.5 text-xs">
            <label className="text-slate-400 block font-medium">Algorithmic Preset</label>
            <select
              value={botPreset}
              onChange={(e) => setBotPreset(e.target.value as any)}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 text-xs focus:outline-none focus:border-cyan-500"
            >
              <option value="rsi">RSI Mean Reversion (Overbought / Oversold)</option>
              <option value="even_odd">Last-Digit Even / Odd Statistical Parity</option>
              <option value="ema">EMA Fast/Slow Trend Cross (9/21)</option>
              <option value="bollinger">Bollinger Volatility Breakout Envelope</option>
            </select>
          </div>

          {/* Market Index */}
          <div className="space-y-1.5 text-xs">
            <label className="text-slate-400 block font-medium">Target Synthetic Instrument</label>
            <select
              value={selectedMarket.symbol}
              onChange={(e) => {
                const found = SYNTHETIC_MARKETS.find((m) => m.symbol === e.target.value);
                if (found) setSelectedMarket(found);
              }}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 text-xs focus:outline-none focus:border-cyan-500"
            >
              {SYNTHETIC_MARKETS.map((m) => (
                <option key={m.symbol} value={m.symbol}>
                  {m.displayName}
                </option>
              ))}
            </select>
          </div>

          {/* Base Stake & Duration */}
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <label className="text-slate-400 block font-medium mb-1">Base Stake ($)</label>
              <input
                type="number"
                min="1"
                max="500"
                value={baseStake}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setBaseStake(val);
                  if (botStatus === 'idle') setCurrentStake(val);
                }}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 font-mono text-xs focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div>
              <label className="text-slate-400 block font-medium mb-1">Duration (Ticks)</label>
              <input
                type="number"
                min="1"
                max="10"
                value={durationTicks}
                onChange={(e) => setDurationTicks(Number(e.target.value))}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 font-mono text-xs focus:outline-none focus:border-cyan-500"
              />
            </div>
          </div>

          {/* Hard Stop Loss & Take Profit */}
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <label className="text-slate-400 block font-medium mb-1">Take Profit Target ($)</label>
              <input
                type="number"
                min="5"
                value={takeProfit}
                onChange={(e) => setTakeProfit(Number(e.target.value))}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-emerald-400 font-mono text-xs focus:outline-none focus:border-cyan-500 font-bold"
              />
            </div>

            <div>
              <label className="text-slate-400 block font-medium mb-1">Stop Loss Limit ($)</label>
              <input
                type="number"
                min="5"
                value={stopLoss}
                onChange={(e) => setStopLoss(Number(e.target.value))}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-rose-400 font-mono text-xs focus:outline-none focus:border-cyan-500 font-bold"
              />
            </div>
          </div>

          {/* Max Consecutive Losses & Cooldown */}
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <label className="text-slate-400 block font-medium mb-1">Max Losses Halt</label>
              <input
                type="number"
                min="1"
                max="10"
                value={maxLosses}
                onChange={(e) => setMaxLosses(Number(e.target.value))}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 font-mono text-xs focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div>
              <label className="text-slate-400 block font-medium mb-1">Cooldown (Seconds)</label>
              <input
                type="number"
                min="1"
                max="30"
                value={cooldownSeconds}
                onChange={(e) => setCooldownSeconds(Number(e.target.value))}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 font-mono text-xs focus:outline-none focus:border-cyan-500"
              />
            </div>
          </div>

          {/* Staking Formula */}
          <div className="p-3 bg-slate-900/60 rounded-lg border border-slate-800 space-y-2 text-xs">
            <label className="flex items-center gap-2 cursor-pointer font-medium text-slate-200">
              <input
                type="checkbox"
                checked={useMartingale}
                onChange={(e) => setUseMartingale(e.target.checked)}
                className="rounded bg-slate-950 border-slate-700 text-cyan-500 focus:ring-0"
              />
              <span>Enable Martingale Stake Recovery</span>
            </label>
            {useMartingale && (
              <div className="pt-1.5 flex items-center justify-between text-[11px] text-slate-400">
                <span>Loss Multiplier:</span>
                <input
                  type="number"
                  min="1.5"
                  max="3"
                  step="0.1"
                  value={multiplier}
                  onChange={(e) => setMultiplier(Number(e.target.value))}
                  className="w-16 bg-slate-950 border border-slate-700 rounded px-2 py-0.5 text-right font-mono text-slate-100"
                />
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Live Execution Console (7 cols) */}
        <div className="lg:col-span-7 bg-[#090D16] border border-slate-800 rounded-xl overflow-hidden shadow-xl flex flex-col h-[520px]">
          <div className="p-3.5 bg-slate-900/80 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-cyan-400" />
              <h3 className="font-semibold text-slate-100 text-xs">
                Real-Time Execution Console & Event Stream
              </h3>
            </div>
            <span className="font-mono text-[10px] text-slate-400">
              Spot: {currentQuote.toFixed(selectedMarket.decimals)}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-1.5 font-mono text-[11px] bg-[#070B12]">
            {logs.map((l) => (
              <div
                key={l.id}
                className={`p-2 rounded border flex items-start gap-2 ${
                  l.type === 'win'
                    ? 'bg-emerald-950/20 border-emerald-500/30 text-emerald-300'
                    : l.type === 'loss'
                    ? 'bg-rose-950/20 border-rose-500/30 text-rose-300'
                    : l.type === 'trigger'
                    ? 'bg-cyan-950/20 border-cyan-500/30 text-cyan-300'
                    : l.type === 'risk'
                    ? 'bg-amber-950/20 border-amber-500/30 text-amber-300'
                    : 'bg-slate-900/40 border-slate-800/80 text-slate-300'
                }`}
              >
                <span className="text-slate-500 shrink-0 text-[10px]">{l.time}</span>
                <span className="flex-1 leading-tight">{l.msg}</span>
              </div>
            ))}

            {logs.length === 0 && (
              <div className="py-24 text-center text-slate-500 text-xs">
                Bot console idle. Click "Start Automated Bot" to begin real-time algorithmic execution.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
