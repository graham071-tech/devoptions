import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  ContractType,
  Market,
  PageId,
  Tick,
  Trade,
  UserProfile,
} from '../../types/trading';
import { SYNTHETIC_MARKETS } from '../../data/syntheticMarkets';
import { derivWsService } from '../../services/derivWs';
import { storage } from '../../services/storage';
import { audioEffects } from '../../services/audioEffects';
import { extractLastDigit } from '../../utils/indicators';
import { marketScanner, MarketScanResult } from '../../services/marketScanner';
import { useToast } from '../common/ToastNotification';
import { TradingLineChart, PricePoint } from '../analysis/TradingLineChart';
import { LiveDigitBar } from './LiveDigitBar';
import { SimpleBotPanel, BotConfig, BotStatus } from './SimpleBotPanel';
import { AIScannerModal } from '../modals/AIScannerModal';
import { DisclaimerBanner } from '../common/DisclaimerBanner';
import {
  Sparkles,
  Bot,
  ChevronDown,
  ArrowUpRight,
  ArrowDownRight,
  Activity,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Zap,
  Info,
  Clock,
  Radio,
  Layers,
} from 'lucide-react';

interface TradeWorkspaceProps {
  profile: UserProfile;
  onUpdateProfile: (p: UserProfile) => void;
  tradingMode: 'demo' | 'real';
  onNavigate: (page: PageId) => void;
  isWsConnected: boolean;
  dataSource: 'live' | 'demo' | 'simulated';
  activeTrades?: Trade[];
  onSetActiveTrades?: React.Dispatch<React.SetStateAction<Trade[]>>;
  completedTrades?: Trade[];
  onSetCompletedTrades?: React.Dispatch<React.SetStateAction<Trade[]>>;
}

export const TradeWorkspace: React.FC<TradeWorkspaceProps> = ({
  profile,
  onUpdateProfile,
  tradingMode,
  onNavigate,
  isWsConnected,
  dataSource,
  activeTrades: propsActiveTrades,
  onSetActiveTrades: propsSetActiveTrades,
  completedTrades: propsCompletedTrades,
  onSetCompletedTrades: propsSetCompletedTrades,
}) => {
  const { showToast } = useToast();

  const [selectedMarket, setSelectedMarket] = useState<Market>(SYNTHETIC_MARKETS[0]);
  const [currentQuote, setCurrentQuote] = useState<number>(derivWsService.getCurrentQuote());
  const [sessionStartQuote, setSessionStartQuote] = useState<number>(derivWsService.getCurrentQuote());
  const [tickDirection, setTickDirection] = useState<'up' | 'down' | 'flat'>('flat');
  const [priceHistory, setPriceHistory] = useState<PricePoint[]>(() => {
    const q = derivWsService.getCurrentQuote();
    const now = Date.now();
    return Array.from({ length: 45 }).map((_, i) => ({
      time: now - (45 - i) * 1000,
      price: q + Math.sin(i / 3) * 0.4,
    }));
  });
  const [recentQuotes, setRecentQuotes] = useState<number[]>([derivWsService.getCurrentQuote()]);

  // Shared / local trades state
  const [localActiveTrades, setLocalActiveTrades] = useState<Trade[]>([]);
  const [localCompletedTrades, setLocalCompletedTrades] = useState<Trade[]>(() =>
    storage.getTradeHistory().slice(0, 30)
  );

  const activeTrades = propsActiveTrades ?? localActiveTrades;
  const setActiveTrades = propsSetActiveTrades ?? setLocalActiveTrades;
  const completedTrades = propsCompletedTrades ?? localCompletedTrades;
  const setCompletedTrades = propsSetCompletedTrades ?? setLocalCompletedTrades;

  const activeTradesRef = useRef<Trade[]>(activeTrades);
  activeTradesRef.current = activeTrades;

  // Reset baseline quote when instrument changes
  useEffect(() => {
    setSessionStartQuote(currentQuote);
  }, [selectedMarket.symbol]);

  // ─────────────────────────────────────────────────────────────
  // AI MARKET SCANNER STATE
  // ─────────────────────────────────────────────────────────────
  const [isAIScannerModalOpen, setIsAIScannerModalOpen] = useState<boolean>(false);
  const [aiScannerInitialOption, setAiScannerInitialOption] = useState<'scan' | 'trade_for_me'>('scan');
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [scanResult, setScanResult] = useState<MarketScanResult | null>(null);
  const [isMarketSelectorOpen, setIsMarketSelectorOpen] = useState<boolean>(false);

  const handleOpenAIScanner = (option: 'scan' | 'trade_for_me' = 'scan') => {
    setAiScannerInitialOption(option);
    setIsAIScannerModalOpen(true);
  };

  // ─────────────────────────────────────────────────────────────
  // AUTOMATED TRADING BOT STATE
  // ─────────────────────────────────────────────────────────────
  const [botStatus, setBotStatus] = useState<BotStatus>('idle');
  const [botConfig, setBotConfig] = useState<BotConfig | null>(null);
  const [stopReason, setStopReason] = useState<string>('');
  const [sessionStats, setSessionStats] = useState({
    realizedPnl: 0,
    tradesCount: 0,
    wins: 0,
    losses: 0,
  });

  const botStatusRef = useRef<BotStatus>(botStatus);
  botStatusRef.current = botStatus;
  const botConfigRef = useRef<BotConfig | null>(botConfig);
  botConfigRef.current = botConfig;
  const sessionStatsRef = useRef(sessionStats);
  sessionStatsRef.current = sessionStats;

  // Manual execution settings
  const [manualStake, setManualStake] = useState<number>(5);
  const [manualDuration, setManualDuration] = useState<number>(5);

  // Mobile viewport tab toggle ('chart' | 'trading') to prevent mobile page scrolling
  const [mobileTab, setMobileTab] = useState<'chart' | 'trading'>('chart');

  // Live timestamp for terminal status
  const [liveTimeStr, setLiveTimeStr] = useState<string>(() =>
    new Date().toISOString().substring(11, 19) + ' UTC'
  );

  useEffect(() => {
    const timer = setInterval(() => {
      setLiveTimeStr(new Date().toISOString().substring(11, 19) + ' UTC');
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Subscribe to market ticks and update line chart & digit stream
  useEffect(() => {
    derivWsService.setMarket(selectedMarket);

    const unsubTick = derivWsService.subscribeToTicks((tick: Tick) => {
      setCurrentQuote(tick.quote);
      setTickDirection(tick.direction);

      if (sessionStartQuote === 0) {
        setSessionStartQuote(tick.quote);
      }

      // Append to line chart points
      setPriceHistory((prev) => {
        const next = [...prev, { time: tick.epoch || Date.now(), price: tick.quote }];
        return next.slice(-200);
      });

      // Append to digit quote list
      setRecentQuotes((prev) => {
        const next = [...prev, tick.quote];
        return next.slice(-150);
      });

      // If Bot is Running and no trade is currently active for this market, evaluate placing next bot trade
      if (
        botStatusRef.current === 'running' &&
        botConfigRef.current &&
        activeTradesRef.current.length === 0
      ) {
        handleBotPlaceTrade(botConfigRef.current, tick.quote);
      }
    });

    return () => unsubTick();
  }, [selectedMarket]);

  // Handle Stop conditions whenever sessionStats changes
  useEffect(() => {
    if (botStatus !== 'running' || !botConfig) return;

    if (sessionStats.realizedPnl >= botConfig.targetProfit) {
      setBotStatus('stopped');
      setStopReason(
        `Target profit reached! Realized +$${sessionStats.realizedPnl.toFixed(2)} USD. Session locked.`
      );
      audioEffects.playWin();
      showToast(
        'success',
        'Target Profit Reached',
        `Bot achieved +$${sessionStats.realizedPnl.toFixed(2)} USD. Trading stopped.`
      );
    } else if (sessionStats.realizedPnl <= -botConfig.maxLoss) {
      setBotStatus('stopped');
      setStopReason(
        `Max loss limit reached! Realized -$${Math.abs(sessionStats.realizedPnl).toFixed(2)} USD. Session halted.`
      );
      audioEffects.playLoss();
      showToast(
        'error',
        'Max Loss Limit Hit',
        `Bot stopped automatically to protect capital (-$${Math.abs(
          sessionStats.realizedPnl
        ).toFixed(2)}).`
      );
    }
  }, [sessionStats, botStatus, botConfig]);

  // Bot placement execution
  const handleBotPlaceTrade = (cfg: BotConfig, quote: number) => {
    const availableBalance =
      tradingMode === 'demo' ? profile.demoBalance : profile.realBalance;

    if (availableBalance < cfg.stake) {
      setBotStatus('stopped');
      setStopReason(`Insufficient funds: Balance is $${availableBalance.toFixed(2)}.`);
      return;
    }

    const potentialProfit = Number((cfg.stake * (selectedMarket.payoutRate || 0.95)).toFixed(2));
    const potentialPayout = Number((cfg.stake + potentialProfit).toFixed(2));

    const newTrade: Trade = {
      id: `bot_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      symbol: selectedMarket.symbol,
      contractType: cfg.contractType,
      stake: cfg.stake,
      payoutRate: selectedMarket.payoutRate || 0.95,
      potentialPayout,
      entryTime: Date.now(),
      entryPrice: quote,
      status: 'active',
      profitLoss: 0,
      mode: tradingMode,
      durationTicks: cfg.durationTicks,
      remainingTicks: cfg.durationTicks,
      ticksRecorded: [quote],
      strategyName: 'DevOptions Automated Bot',
    };

    setActiveTrades((prev) => [newTrade, ...prev]);
    audioEffects.playTradePlaced();
  };

  // Bot Controls
  const handleStartBot = (cfg: BotConfig) => {
    setBotConfig(cfg);
    setBotStatus('running');
    setStopReason('');
    setSessionStats({
      realizedPnl: 0,
      tradesCount: 0,
      wins: 0,
      losses: 0,
    });
    audioEffects.playClick();
    showToast(
      'success',
      'Trading Bot Started',
      `Trading ${cfg.contractType} on ${selectedMarket.displayName} (Take-Profit: +$${cfg.targetProfit}, Stop-Loss: -$${cfg.maxLoss})`
    );
  };

  const handleStopBot = () => {
    setBotStatus('stopped');
    setStopReason('Manually stopped by trader.');
    audioEffects.playClick();
    showToast('info', 'Bot Stopped', 'Automated trade execution disabled.');
  };

  const handleEmergencyStop = () => {
    setBotStatus('stopped');
    setStopReason('EMERGENCY STOP ACTIVATED: All automated order generation terminated immediately.');
    audioEffects.playAlert();
    showToast('error', 'Emergency Stop Activated', 'Bot halted immediately. No new trades will be placed.');
  };

  // Manual trade placement
  const handleManualTrade = (type: ContractType) => {
    const availableBalance =
      tradingMode === 'demo' ? profile.demoBalance : profile.realBalance;

    if (availableBalance < manualStake) {
      showToast(
        'error',
        'Insufficient Balance',
        `Your balance ($${availableBalance.toFixed(2)}) cannot cover $${manualStake}.`
      );
      return;
    }

    const potentialProfit = Number((manualStake * (selectedMarket.payoutRate || 0.95)).toFixed(2));
    const potentialPayout = Number((manualStake + potentialProfit).toFixed(2));

    const newTrade: Trade = {
      id: `man_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      symbol: selectedMarket.symbol,
      contractType: type,
      stake: manualStake,
      payoutRate: selectedMarket.payoutRate || 0.95,
      potentialPayout,
      entryTime: Date.now(),
      entryPrice: currentQuote,
      status: 'active',
      profitLoss: 0,
      mode: tradingMode,
      durationTicks: manualDuration,
      remainingTicks: manualDuration,
      ticksRecorded: [currentQuote],
      strategyName: 'Manual Execution',
    };

    setActiveTrades((prev) => [newTrade, ...prev]);
    audioEffects.playTradePlaced();
    showToast('info', `Order Placed: ${type}`, `Stake $${manualStake} on ${selectedMarket.displayName}`);
  };

  const availableBalance =
    tradingMode === 'demo' ? profile.demoBalance : profile.realBalance;

  // Percentage change calculation
  const pctChange = useMemo(() => {
    if (!sessionStartQuote || sessionStartQuote === 0 || !currentQuote) return 0;
    return ((currentQuote - sessionStartQuote) / sessionStartQuote) * 100;
  }, [currentQuote, sessionStartQuote]);

  // High & Low in session
  const { sessionHigh, sessionLow } = useMemo(() => {
    if (priceHistory.length === 0) return { sessionHigh: currentQuote, sessionLow: currentQuote };
    let high = -Infinity;
    let low = Infinity;
    for (const p of priceHistory) {
      if (p.price > high) high = p.price;
      if (p.price < low) low = p.price;
    }
    return { sessionHigh: high, sessionLow: low };
  }, [priceHistory, currentQuote]);

  // 14-period Relative Strength Index (RSI)
  const rsi = useMemo(() => {
    if (priceHistory.length < 15) return 50.0;
    const period = 14;
    const slice = priceHistory.slice(-(period + 1));
    let gains = 0;
    let losses = 0;
    for (let i = 1; i < slice.length; i++) {
      const diff = slice[i].price - slice[i - 1].price;
      if (diff >= 0) gains += diff;
      else losses += Math.abs(diff);
    }
    const avgGain = gains / period;
    const avgLoss = losses / period;
    if (avgLoss === 0) return 100.0;
    const rs = avgGain / avgLoss;
    return Number((100 - 100 / (1 + rs)).toFixed(1));
  }, [priceHistory]);

  // Algorithmic momentum signal
  const { signalType, signalLabel } = useMemo(() => {
    if (rsi >= 70) return { signalType: 'PUT', signalLabel: 'SELL (OVERBOUGHT)' };
    if (rsi <= 30) return { signalType: 'CALL', signalLabel: 'BUY (OVERSOLD)' };
    if (rsi > 55) return { signalType: 'CALL', signalLabel: 'CALL (BULLISH)' };
    if (rsi < 45) return { signalType: 'PUT', signalLabel: 'PUT (BEARISH)' };
    return { signalType: 'NEUTRAL', signalLabel: 'NEUTRAL' };
  }, [rsi]);

  return (
    <div className="h-full flex flex-col min-h-0 p-1 sm:p-2 gap-1.5 overflow-hidden select-none relative bg-[#070A0F]">
      {/* ─────────────────────────────────────────────────────────────
          MOBILE VIEW SWITCHER (Only visible on narrow screens < lg)
      ───────────────────────────────────────────────────────────── */}
      <div className="lg:hidden flex items-center bg-[#0D111A] border border-slate-800 rounded-lg p-0.5 shrink-0">
        <button
          onClick={() => setMobileTab('chart')}
          className={`flex-1 py-1.5 text-center font-mono text-[11px] font-semibold rounded-md transition-colors cursor-pointer ${
            mobileTab === 'chart'
              ? 'bg-slate-800 text-cyan-300 border border-slate-700 shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Market &amp; Chart
        </button>
        <button
          onClick={() => setMobileTab('trading')}
          className={`flex-1 py-1.5 text-center font-mono text-[11px] font-semibold rounded-md transition-colors cursor-pointer flex items-center justify-center gap-1.5 ${
            mobileTab === 'trading'
              ? 'bg-slate-800 text-cyan-300 border border-slate-700 shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <span>Trading</span>
          {botStatus === 'running' && (
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          )}
        </button>
      </div>

      {/* ─────────────────────────────────────────────────────────────
          SIDE-BY-SIDE WORKSPACE CONTAINER:
          - Center Section: ~67% of remaining area (approx 55% of full browser)
          - Right Trading Panel: ~33% of remaining area (approx 27% of full browser)
          Both visible side by side horizontally on desktop!
      ───────────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col lg:flex-row gap-1.5 sm:gap-2 min-h-0 overflow-hidden">
        {/* ─────────────────────────────────────────────────────────────
            CENTER SECTION (~55% full viewport width):
            Market selector, quote, percentage change, live line chart,
            circular digit indicators (0-9), and market info.
        ───────────────────────────────────────────────────────────── */}
        <div
          className={`flex-1 lg:w-[67%] flex-col h-full min-h-0 bg-[#090D16] border border-slate-800/90 rounded-xl overflow-hidden shrink min-w-0 ${
            mobileTab === 'chart' ? 'flex' : 'hidden lg:flex'
          }`}
        >
          {/* 1. Header: Market Selector, Live Quote, Percentage Change, High/Low, Scan Actions */}
          <div className="p-2 sm:p-2.5 border-b border-slate-800/90 bg-[#0B0F19] flex flex-wrap items-center justify-between gap-2 shrink-0">
            {/* Market Selector & Quote Block */}
            <div className="flex items-center gap-2 sm:gap-3 flex-wrap min-w-0">
              {/* Market Dropdown */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setIsMarketSelectorOpen(!isMarketSelectorOpen)}
                  className="flex items-center gap-2 px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800 hover:border-slate-700 text-slate-100 transition-colors cursor-pointer"
                  title="Select Market"
                >
                  <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse shrink-0" />
                  <div className="text-left">
                    <span className="font-bold text-xs font-sans tracking-tight block leading-tight">
                      {selectedMarket.displayName}
                    </span>
                    <span className="text-[9px] text-slate-400 font-mono block leading-none">
                      Payout: +{Math.round((selectedMarket.payoutRate || 0.95) * 100)}%
                    </span>
                  </div>
                  <ChevronDown className="w-3 h-3 text-slate-400 shrink-0" />
                </button>

                {/* Market Selector Menu */}
                {isMarketSelectorOpen && (
                  <div className="absolute left-0 top-full mt-1 w-64 bg-[#0D1322] border border-slate-700 rounded-lg shadow-2xl p-1 z-50 space-y-0.5 max-h-72 overflow-y-auto">
                    <div className="px-2 py-1 text-[9px] font-mono uppercase text-slate-500 font-bold border-b border-slate-800">
                      Synthetic Instruments
                    </div>
                    {SYNTHETIC_MARKETS.map((m) => (
                      <button
                        key={m.symbol}
                        onClick={() => {
                          setSelectedMarket(m);
                          derivWsService.setMarket(m);
                          setIsMarketSelectorOpen(false);
                        }}
                        className={`w-full text-left p-1.5 rounded flex items-center justify-between text-xs transition-colors cursor-pointer ${
                          selectedMarket.symbol === m.symbol
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

              {/* Current Price Quote */}
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-800">
                <span className="text-[9px] text-slate-500 font-mono uppercase">Price:</span>
                <span
                  className={`font-mono text-xs sm:text-sm font-bold tabular-nums flex items-center gap-1 ${
                    tickDirection === 'up'
                      ? 'text-emerald-400'
                      : tickDirection === 'down'
                      ? 'text-rose-400'
                      : 'text-slate-100'
                  }`}
                >
                  {currentQuote > 0 ? currentQuote.toFixed(selectedMarket.decimals) : '—'}
                  {tickDirection === 'up' && <ArrowUpRight className="w-3.5 h-3.5 text-emerald-400 stroke-[2.5]" />}
                  {tickDirection === 'down' && <ArrowDownRight className="w-3.5 h-3.5 text-rose-400 stroke-[2.5]" />}
                </span>
              </div>

              {/* Percentage Change Indicator */}
              <div
                className={`flex items-center gap-1 px-2 py-0.5 rounded font-mono text-[11px] font-bold border ${
                  pctChange >= 0
                    ? 'bg-emerald-950/70 text-emerald-300 border-emerald-800/80'
                    : 'bg-rose-950/70 text-rose-300 border-rose-800/80'
                }`}
                title="Session percentage change"
              >
                <span>{pctChange >= 0 ? `+${pctChange.toFixed(2)}%` : `${pctChange.toFixed(2)}%`}</span>
              </div>

              {/* RSI(14) Indicator */}
              <div
                className={`flex items-center gap-1 px-2 py-0.5 rounded font-mono text-[11px] font-bold border ${
                  rsi >= 70
                    ? 'bg-rose-950/70 text-rose-300 border-rose-800/80'
                    : rsi <= 30
                    ? 'bg-emerald-950/70 text-emerald-300 border-emerald-800/80'
                    : 'bg-slate-950/70 text-cyan-300 border-slate-800'
                }`}
                title="14-period Relative Strength Index"
              >
                <span className="text-[9px] text-slate-500 uppercase">RSI:</span>
                <span>{rsi.toFixed(1)}</span>
              </div>

              {/* Algorithmic Signal Information */}
              <div
                className={`hidden md:flex items-center gap-1 px-2 py-0.5 rounded font-mono text-[11px] font-bold border ${
                  signalType === 'CALL'
                    ? 'bg-emerald-950/70 text-emerald-300 border-emerald-800/80'
                    : signalType === 'PUT'
                    ? 'bg-rose-950/70 text-rose-300 border-rose-800/80'
                    : 'bg-slate-950/70 text-slate-400 border-slate-800'
                }`}
                title="Real-time algorithmic momentum signal"
              >
                <span className="text-[9px] text-slate-500 uppercase">SIGNAL:</span>
                <span className="flex items-center gap-0.5">
                  {signalType === 'CALL' && <ArrowUpRight className="w-3 h-3 text-emerald-400 stroke-[2.5]" />}
                  {signalType === 'PUT' && <ArrowDownRight className="w-3 h-3 text-rose-400 stroke-[2.5]" />}
                  <span>{signalLabel}</span>
                </span>
              </div>

              {/* Session High / Low Stats (desktop) */}
              <div className="hidden 2xl:flex items-center gap-2 text-[10px] font-mono text-slate-400 px-2 py-0.5 rounded bg-slate-950/70 border border-slate-800/80">
                <span>H: <span className="text-slate-200">{sessionHigh.toFixed(selectedMarket.decimals)}</span></span>
                <span>L: <span className="text-slate-200">{sessionLow.toFixed(selectedMarket.decimals)}</span></span>
              </div>
            </div>

            {/* Market Scanner Controls */}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => handleOpenAIScanner('scan')}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-900 hover:bg-slate-800 text-cyan-300 border border-slate-700/80 font-mono text-[10px] sm:text-[11px] font-semibold transition-colors cursor-pointer"
                title="Scan Markets for Statistical Confluence"
              >
                <Activity className="w-3 h-3 text-cyan-400" />
                <span className="hidden xs:inline">Market Scanner</span>
                <span className="xs:hidden">Scanner</span>
              </button>

              {/* Bot Trade Assistant */}
              <button
                type="button"
                onClick={() => handleOpenAIScanner('trade_for_me')}
                className="hidden xl:flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-900 hover:bg-purple-950/60 text-purple-300 border border-slate-700/80 hover:border-purple-800 font-mono text-[11px] font-semibold transition-colors cursor-pointer"
                title="Algorithmic Strategy Assistant"
              >
                <Bot className="w-3 h-3 text-purple-400" />
                <span>Auto Trade</span>
              </button>
            </div>
          </div>

          {/* 2. Live Line Chart (Adapts to available height) */}
          <div className="flex-1 min-h-0 relative">
            <TradingLineChart
              data={priceHistory}
              symbolName={selectedMarket.displayName}
              decimals={selectedMarket.decimals}
              currentQuote={currentQuote}
              direction={tickDirection}
              activeTrades={activeTrades}
              isWsConnected={isWsConnected}
              dataSource={dataSource}
            />
          </div>

          {/* 3. Circular Digit Indicators (0 to 9) directly beneath chart */}
          <LiveDigitBar
            quotes={recentQuotes}
            currentQuote={currentQuote}
            decimals={selectedMarket.decimals}
            symbolName={selectedMarket.displayName}
            isLive={isWsConnected}
          />

          {/* 4. Terminal Metadata / Market Info Bar */}
          <div className="px-3 py-1.5 bg-[#070A0F] border-t border-slate-800/80 flex items-center justify-between text-[10px] font-mono text-slate-500 shrink-0">
            <div className="flex items-center gap-2 sm:gap-3">
              <span className="flex items-center gap-1.5 text-slate-300">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="font-semibold">Live Market Feed</span>
              </span>
              <span className="text-slate-600 hidden xs:inline">•</span>
              <span className="hidden xs:inline">1 Tick/sec</span>
              <span className="text-slate-600 hidden sm:inline">•</span>
              <span className="hidden sm:inline">Zero Spread</span>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-slate-400 tabular-nums">{liveTimeStr}</span>
            </div>
          </div>
        </div>

        {/* ─────────────────────────────────────────────────────────────
            RIGHT TRADING PANEL (~27% full viewport width):
            Trade settings, AI Scanner, automation controls, and risk management.
            Horizontally beside the chart on desktop!
        ───────────────────────────────────────────────────────────── */}
        <div
          className={`lg:w-[33%] lg:min-w-[320px] lg:max-w-[390px] flex-col h-full min-h-0 bg-[#0B0F19] border border-slate-800/90 rounded-xl overflow-hidden shrink-0 ${
            mobileTab === 'trading' ? 'flex flex-1' : 'hidden lg:flex'
          }`}
        >
          {/* Scrollable Container with independent vertical scrollbar */}
          <div className="flex-1 overflow-y-auto min-h-0 p-2 sm:p-2.5 space-y-2">
            {/* Dedicated Trading Panel (Controls, Mode, Stake (+/-), Target/Loss, Bot & Manual Actions) */}
            <SimpleBotPanel
              market={selectedMarket}
              onSelectMarket={(m) => {
                setSelectedMarket(m);
                derivWsService.setMarket(m);
              }}
              availableMarkets={SYNTHETIC_MARKETS}
              currentQuote={currentQuote}
              tradingMode={tradingMode}
              availableBalance={availableBalance}
              botStatus={botStatus}
              stopReason={stopReason}
              onStartBot={handleStartBot}
              onStopBot={handleStopBot}
              onEmergencyStop={handleEmergencyStop}
              sessionStats={sessionStats}
              onOpenAIScanner={() => handleOpenAIScanner('scan')}
              onScanMarket={() => handleOpenAIScanner('scan')}
              onScanAndTradeForMe={() => handleOpenAIScanner('trade_for_me')}
              isScanning={isScanning}
              activeTradesCount={activeTrades.length}
              onManualTrade={handleManualTrade}
            />

            {/* Active Positions Quick Monitor */}
            {activeTrades.length > 0 && (
              <div className="bg-[#0D111A] border border-cyan-800/60 rounded-xl p-2.5 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono font-bold text-cyan-300 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />
                    Active Contracts ({activeTrades.length})
                  </span>
                  <button
                    onClick={() => onNavigate('positions')}
                    className="text-[9px] text-cyan-400 hover:underline font-mono cursor-pointer"
                  >
                    View Details &rarr;
                  </button>
                </div>

                <div className="space-y-1 max-h-32 overflow-y-auto pr-0.5">
                  {activeTrades.map((t) => (
                    <div
                      key={t.id}
                      className="p-1.5 rounded bg-slate-950 border border-slate-800 flex items-center justify-between text-xs font-mono"
                    >
                      <div>
                        <span
                          className={`font-bold text-[11px] ${
                            t.contractType === 'CALL' ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {t.contractType}
                        </span>
                        <span className="text-slate-400 text-[9px] ml-1">
                          @ ${t.entryPrice.toFixed(selectedMarket.decimals)}
                        </span>
                      </div>

                      <div className="text-right">
                        <span className="text-cyan-300 font-bold text-[10px]">
                          {t.remainingTicks} {t.remainingTicks === 1 ? 'tick' : 'ticks'}
                        </span>
                        <span className="text-slate-500 text-[8.5px] block">
                          ${t.stake}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Risk Disclaimer Safeguard Banner */}
            <DisclaimerBanner compact />
          </div>
        </div>
      </div>

      {/* AI SCANNER MODAL (SCAN MARKET & SCAN AND TRADE FOR ME) */}
      <AIScannerModal
        isOpen={isAIScannerModalOpen}
        onClose={() => setIsAIScannerModalOpen(false)}
        initialOption={aiScannerInitialOption}
        onSelectMarket={(m) => {
          setSelectedMarket(m);
          derivWsService.setMarket(m);
        }}
        onPrepareBotConfig={(cfg, m) => {
          setSelectedMarket(m);
          derivWsService.setMarket(m);
          handleStartBot(cfg);
        }}
        currentMarket={selectedMarket}
        tradingMode={tradingMode}
        availableBalance={availableBalance}
      />
    </div>
  );
};
