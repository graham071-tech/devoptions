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
import { authClient, AdminRiskState } from '../../services/authClient';
import { audioEffects } from '../../services/audioEffects';
import { analyzeLastDigits } from '../../utils/indicators';
import { analyzeFastMarketSignal } from '../../utils/fastSignalEngine';
import { useToast } from '../common/ToastNotification';
import { TradingLineChart, PricePoint } from '../analysis/TradingLineChart';
import { LiveDigitBar } from './LiveDigitBar';
import { SimpleBotPanel, BotConfig, BotStatus } from './SimpleBotPanel';
import { AIScannerModal } from '../modals/AIScannerModal';
import {
  ChevronDown,
  ArrowUpRight,
  ArrowDownRight,
  Activity,
} from 'lucide-react';

interface TradeWorkspaceProps {
  profile: UserProfile;
  onUpdateProfile: (p: UserProfile) => void;
  tradingMode: 'demo' | 'real';
  onToggleTradingMode?: (mode: 'demo' | 'real') => void;
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
  onToggleTradingMode,
  onNavigate,
  isWsConnected,
  dataSource,
  activeTrades: propsActiveTrades,
  onSetActiveTrades: propsSetActiveTrades,
  completedTrades: propsCompletedTrades,
  onSetCompletedTrades: propsSetCompletedTrades,
}) => {
  const { showToast } = useToast();

  const [selectedMarket, setSelectedMarket] = useState<Market>(
    () =>
      SYNTHETIC_MARKETS.find((m) => m.symbol === storage.getSelectedMarketSymbol()) ||
      SYNTHETIC_MARKETS[0]
  );

  const restoredBotSession = useMemo(() => storage.getBotSessionState(), []);

  // Seed initial chart history directly from cached/server market feed
  const initialPoints = useMemo(() => {
    derivWsService.setMarket(selectedMarket);
    const seeded = derivWsService.getPriceHistory(120);
    if (seeded.length > 0) return seeded;
    const q = derivWsService.getCurrentQuote();
    return q > 0 ? [{ time: Date.now(), price: q }] : [];
  }, []);

  const [currentQuote, setCurrentQuote] = useState<number>(
    initialPoints[initialPoints.length - 1]?.price || derivWsService.getCurrentQuote()
  );
  const [tickDirection, setTickDirection] = useState<'up' | 'down' | 'flat'>('flat');
  const [priceHistory, setPriceHistory] = useState<PricePoint[]>(initialPoints);
  const [recentQuotes, setRecentQuotes] = useState<number[]>(
    initialPoints.map((pt) => pt.price)
  );

  // Separate buffers: priceBufferRef tracks display stream (1000ms); botPriceBufferRef feeds fast bot-only analysis
  const priceBufferRef = useRef<number[]>(initialPoints.map((pt) => pt.price));
  const botPriceBufferRef = useRef<number[]>(initialPoints.map((pt) => pt.price));
  const latestTickEpochRef = useRef<number>(
    initialPoints[initialPoints.length - 1]?.time || 0
  );
  const selectedMarketRef = useRef<Market>(selectedMarket);
  selectedMarketRef.current = selectedMarket;
  const profileRef = useRef<UserProfile>(profile);
  profileRef.current = profile;
  const tradingModeRef = useRef<'demo' | 'real'>(tradingMode);
  tradingModeRef.current = tradingMode;
  const isWsConnectedRef = useRef<boolean>(isWsConnected);
  isWsConnectedRef.current = isWsConnected;

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

  // AI Market Scanner state
  const [isAIScannerModalOpen, setIsAIScannerModalOpen] = useState<boolean>(false);
  const [aiScannerInitialOption, setAiScannerInitialOption] = useState<'scan' | 'trade_for_me'>('scan');
  const [isMarketSelectorOpen, setIsMarketSelectorOpen] = useState<boolean>(false);

  const handleOpenAIScanner = (option: 'scan' | 'trade_for_me' = 'scan') => {
    setAiScannerInitialOption(option);
    setIsAIScannerModalOpen(true);
  };

  // High-speed Automated Trading Bot State (persisted across page refreshes)
  const [botStatus, setBotStatus] = useState<BotStatus>(
    restoredBotSession?.botStatus || 'idle'
  );
  const [botPhase, setBotPhase] = useState<string>(restoredBotSession?.botPhase || 'IDLE');
  const [liveSignalLabel, setLiveSignalLabel] = useState<string>('');
  const [botConfig, setBotConfig] = useState<BotConfig | null>(
    restoredBotSession?.botConfig
      ? { ...restoredBotSession.botConfig }
      : null
  );
  const [stopReason, setStopReason] = useState<string>(restoredBotSession?.stopReason || '');
  const [sessionStats, setSessionStats] = useState(
    restoredBotSession?.sessionStats || {
      realizedPnl: 0,
      tradesCount: 0,
      wins: 0,
      losses: 0,
    }
  );

  const botStatusRef = useRef<BotStatus>(botStatus);
  botStatusRef.current = botStatus;
  const botConfigRef = useRef<BotConfig | null>(botConfig);
  botConfigRef.current = botConfig;
  const sessionStatsRef = useRef(sessionStats);
  sessionStatsRef.current = sessionStats;
  const botSessionIdRef = useRef<string>(restoredBotSession?.botSessionId || '');
  const processedBotTradeIdsRef = useRef<Set<string>>(
    new Set(restoredBotSession?.processedTradeIds || [])
  );
  const placementInProgressRef = useRef<boolean>(false);
  const botCooldownUntilRef = useRef<number>(0);
  const adminRiskRef = useRef<AdminRiskState | null>(authClient.getLastRiskState());
  const prevRiskHaltedRef = useRef<boolean>(Boolean(adminRiskRef.current?.halted));

  useEffect(() => {
    return authClient.subscribeRiskState((rs) => {
      adminRiskRef.current = rs;
      const isHalted = Boolean(rs && rs.enabled && rs.halted);
      if (isHalted) {
        const reason =
          rs?.haltReason ||
          'Administrator risk protection halted automated trading. Manually restart to continue.';
        const wasRunning = botStatusRef.current === 'running';
        botStatusRef.current = 'stopped';
        setBotStatus('stopped');
        setBotPhase('HALTED');
        setStopReason(reason);
        if (wasRunning && !prevRiskHaltedRef.current) {
          audioEffects.playAlert();
          showToast('error', 'Risk Protection Halted Bot', reason);
        }
      }
      prevRiskHaltedRef.current = isHalted;
    });
  }, []);

  useEffect(() => {
    storage.saveBotSessionState({
      botStatus,
      botPhase,
      stopReason,
      botSessionId: botSessionIdRef.current,
      processedTradeIds: Array.from(processedBotTradeIdsRef.current).slice(-200),
      botConfig,
      sessionStats,
    });
  }, [botStatus, botPhase, stopReason, botConfig, sessionStats]);

  // Submit simulated trade cleanly (respects validation & server atomic persistence when signed in)
  const submitSimulatedTrade = async (trade: Trade): Promise<boolean> => {
    if (placementInProgressRef.current) return false;
    placementInProgressRef.current = true;
    try {
      const currentProfile = profileRef.current;
      if (authClient.isAuthenticated()) {
        const balances = await authClient.placeTrade(trade, trade.mode);
        const updatedProfile = { ...currentProfile, ...balances };
        onUpdateProfile(updatedProfile);
        storage.saveUserProfile(updatedProfile);
      } else {
        if (trade.mode === 'real') {
          throw new Error('Please sign in before using your deposited balance.');
        }
        if (currentProfile.demoBalance < trade.stake) {
          throw new Error('Insufficient demo balance.');
        }
        const updatedProfile = {
          ...currentProfile,
          demoBalance: Number((currentProfile.demoBalance - trade.stake).toFixed(2)),
        };
        onUpdateProfile(updatedProfile);
        storage.saveUserProfile(updatedProfile);
      }
      const nextActive = [trade, ...activeTradesRef.current];
      activeTradesRef.current = nextActive;
      setActiveTrades(nextActive);
      audioEffects.playTradePlaced();
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not place simulated trade.';
      if (botStatusRef.current === 'running') {
        botStatusRef.current = 'stopped';
        setBotStatus('stopped');
        setBotPhase('PAUSED');
        setStopReason(message);
      }
      showToast('error', 'Trade Not Placed', message);
      return false;
    } finally {
      placementInProgressRef.current = false;
    }
  };

  // Realistic signal evaluation + execution pacing on live market ticks
  const evaluateAndExecuteBot = (cfg: BotConfig, prices: number[]) => {
    if (botStatusRef.current !== 'running') return;
    if (placementInProgressRef.current || activeTradesRef.current.length > 0) return;
    if (Date.now() < botCooldownUntilRef.current) {
      setBotPhase('ANALYZING');
      return;
    }

    const market = selectedMarketRef.current;
    const mode = tradingModeRef.current;
    const currentProfile = profileRef.current;
    const availBal = mode === 'demo' ? currentProfile.demoBalance : currentProfile.realBalance;

    // 1. Validate market feed health before trading (never fabricate trades on broken feed)
    if (!isWsConnectedRef.current || !derivWsService.isFeedHealthy()) {
      botStatusRef.current = 'error';
      setBotStatus('error');
      setBotPhase('FEED PAUSED');
      setStopReason('Market data feed disconnected. Bot paused safely.');
      showToast('error', 'Feed Disconnected', 'Automated trading paused safely until live quotes resume.');
      return;
    }

    // 2. Enforce mode & balance validation
    if (mode === 'real') {
      botStatusRef.current = 'stopped';
      setBotStatus('stopped');
      setBotPhase('STOPPED');
      setStopReason('Switch to Demo account to run the automated bot.');
      return;
    }

    if (cfg.stake < (market.minStake || 1) || availBal < cfg.stake) {
      botStatusRef.current = 'stopped';
      setBotStatus('stopped');
      setBotPhase('STOPPED');
      setStopReason(`Insufficient funds: Available balance ($${availBal.toFixed(2)}) cannot cover $${cfg.stake}.`);
      return;
    }

    // 2.5 Protected Administrator Risk-Limit Enforcement
    const rs = adminRiskRef.current;
    if (rs && rs.enabled) {
      if (rs.halted || rs.consecutiveLosses >= rs.maxConsecutiveLosses) {
        const msg =
          rs.haltReason ||
          'Maximum 3 consecutive losing trades reached. Automated trading halted until manual restart.';
        botStatusRef.current = 'stopped';
        setBotStatus('stopped');
        setBotPhase('HALTED');
        setStopReason(msg);
        return;
      }
      if (cfg.stake > rs.remainingLossAllowance) {
        const msg = `Max loss protection: stake ($${cfg.stake.toFixed(2)}) exceeds remaining loss allowance ($${rs.remainingLossAllowance.toFixed(2)}).`;
        botStatusRef.current = 'stopped';
        setBotStatus('stopped');
        setBotPhase('HALTED');
        setStopReason(msg);
        showToast('error', 'Max Loss Protection Triggered', msg);
        return;
      }
    }

    // 3. Technical analysis on live buffer
    const analysis = analyzeFastMarketSignal(prices, market.decimals, cfg.contractType);
    setLiveSignalLabel(analysis.signalLabel);

    if (!analysis.feedValid || !analysis.shouldExecute) {
      setBotPhase('ANALYZING');
      return;
    }

    // 4. Signal confirmed -> execute simulated trade anchored to continuous quote
    const latestPrice = prices[prices.length - 1];
    const payoutRate = market.payoutRate || 0.95;
    const potentialProfit = Number((cfg.stake * payoutRate).toFixed(2));
    const potentialPayout = Number((cfg.stake + potentialProfit).toFixed(2));
    const entryTime = Math.max(Date.now(), latestTickEpochRef.current || 0);

    const newTrade: Trade = {
      id: `bot_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      symbol: market.symbol,
      contractType: cfg.contractType,
      stake: cfg.stake,
      payoutRate,
      potentialPayout,
      entryTime,
      entryPrice: latestPrice,
      targetDigit: analysis.targetDigit,
      status: 'active',
      profitLoss: 0,
      mode,
      durationTicks: cfg.durationTicks,
      remainingTicks: cfg.durationTicks,
      ticksRecorded: [latestPrice],
      strategyName: 'DevOptions Automated Bot',
      botId: botSessionIdRef.current,
    };

    setBotPhase('IN POSITION');
    void submitSimulatedTrade(newTrade);
  };

  // Synchronously apply a market selection so refs & chart seed update immediately (avoids race on Auto Setup -> Start Bot)
  const applyMarketSelection = (market: Market) => {
    selectedMarketRef.current = market;
    storage.saveSelectedMarketSymbol(market.symbol);
    derivWsService.setMarket(market);
    const seeded = derivWsService.getPriceHistory(120);
    if (seeded.length > 0) {
      const prices = seeded.map((pt) => pt.price);
      priceBufferRef.current = prices;
      botPriceBufferRef.current = prices;
      latestTickEpochRef.current = seeded[seeded.length - 1].time;
      setPriceHistory(seeded);
      setRecentQuotes(prices);
      setCurrentQuote(prices[prices.length - 1]);
      setTickDirection('flat');
    }
    setSelectedMarket(market);
  };

  // Switch active market feed & subscribe to authoritative 1000ms ticks + history snapshots
  useEffect(() => {
    storage.saveSelectedMarketSymbol(selectedMarket.symbol);
    derivWsService.setMarket(selectedMarket);

    const hydrateFromTicks = (points: PricePoint[], lastDirection?: 'up' | 'down' | 'flat') => {
      if (points.length === 0) return;
      const prices = points.map((pt) => pt.price);
      priceBufferRef.current = prices;
      botPriceBufferRef.current = prices;
      latestTickEpochRef.current = points[points.length - 1].time;
      setPriceHistory(points);
      setRecentQuotes(prices);
      setCurrentQuote(prices[prices.length - 1]);
      if (lastDirection) setTickDirection(lastDirection);
      else setTickDirection('flat');
    };

    const seeded = derivWsService.getPriceHistory(120);
    if (seeded.length > 0) {
      hydrateFromTicks(seeded);
    }

    const unsubHistory = derivWsService.subscribeToHistory((sym, ticks) => {
      if (sym !== selectedMarket.symbol || ticks.length === 0) return;
      const points = ticks.slice(-160).map((t) => ({ time: t.epoch, price: t.quote }));
      const last = ticks[ticks.length - 1];
      hydrateFromTicks(points, last.direction);
    });

    const unsubTick = derivWsService.subscribeToTicks((tick: Tick) => {
      if (tick.symbol !== selectedMarket.symbol) return;

      latestTickEpochRef.current = tick.epoch || Date.now();
      setCurrentQuote(tick.quote);
      setTickDirection(tick.direction);

      const nextBuffer = [...priceBufferRef.current, tick.quote].slice(-200);
      priceBufferRef.current = nextBuffer;

      setPriceHistory((prev) => [...prev, { time: tick.epoch || Date.now(), price: tick.quote }].slice(-200));
      setRecentQuotes((prev) => [...prev, tick.quote].slice(-150));
    });

    return () => {
      unsubHistory();
      unsubTick();
    };
  }, [selectedMarket]);

  // Independent fast market stream active ONLY when automated bot is running (never affects digit circles or manual speed)
  useEffect(() => {
    if (botStatus !== 'running') return;

    botPriceBufferRef.current = [...priceBufferRef.current];

    const unsubBotTick = derivWsService.subscribeToBotTicks((tick: Tick) => {
      if (tick.symbol !== selectedMarketRef.current.symbol) return;
      const nextBotBuffer = [...botPriceBufferRef.current, tick.quote].slice(-200);
      botPriceBufferRef.current = nextBotBuffer;

      if (botStatusRef.current === 'running' && botConfigRef.current) {
        evaluateAndExecuteBot(botConfigRef.current, nextBotBuffer);
      }
    });

    return () => unsubBotTick();
  }, [botStatus, selectedMarket]);

  // Monitor settled bot trades -> immediately record P&L, enforce TP/SL, and reassess for next trade
  useEffect(() => {
    const sessionId = botSessionIdRef.current;
    if (!sessionId) return;

    const newBotTrades = completedTrades.filter(
      (t) =>
        t.botId === sessionId &&
        (t.status === 'won' || t.status === 'lost') &&
        !processedBotTradeIdsRef.current.has(t.id)
    );

    if (newBotTrades.length === 0) return;

    let pnlDelta = 0;
    let winsDelta = 0;
    let lossesDelta = 0;

    for (const t of newBotTrades) {
      processedBotTradeIdsRef.current.add(t.id);
      pnlDelta += Number(t.profitLoss || 0);
      if (t.status === 'won') winsDelta++;
      else lossesDelta++;
    }

    const nextStats = {
      realizedPnl: Number((sessionStatsRef.current.realizedPnl + pnlDelta).toFixed(2)),
      tradesCount: sessionStatsRef.current.tradesCount + newBotTrades.length,
      wins: sessionStatsRef.current.wins + winsDelta,
      losses: sessionStatsRef.current.losses + lossesDelta,
    };

    sessionStatsRef.current = nextStats;
    setSessionStats(nextStats);

    const cfg = botConfigRef.current;
    if (botStatusRef.current !== 'running' || !cfg) return;

    if (nextStats.realizedPnl >= cfg.targetProfit) {
      botStatusRef.current = 'stopped';
      setBotStatus('stopped');
      setBotPhase('TARGET REACHED');
      setStopReason(
        `Target profit reached (+$${nextStats.realizedPnl.toFixed(2)} USD). Session completed.`
      );
      audioEffects.playWin();
      showToast(
        'success',
        'Target Profit Reached',
        `Bot achieved +$${nextStats.realizedPnl.toFixed(2)} USD across ${nextStats.tradesCount} trades.`
      );
      return;
    }

    if (nextStats.realizedPnl <= -cfg.maxLoss) {
      botStatusRef.current = 'stopped';
      setBotStatus('stopped');
      setBotPhase('MAX LOSS HIT');
      setStopReason(
        `Max loss limit reached (-$${Math.abs(nextStats.realizedPnl).toFixed(2)} USD). Session halted safely.`
      );
      audioEffects.playLoss();
      showToast(
        'error',
        'Max Loss Limit Hit',
        `Bot stopped to protect capital (-$${Math.abs(nextStats.realizedPnl).toFixed(2)}).`
      );
      return;
    }

    // Brief realistic reassessment pause (~1.5s) before next market tick scan
    botCooldownUntilRef.current = Date.now() + 1500;
    setBotPhase('ANALYZING');
  }, [completedTrades]);

  // Bot Controls
  const handleStartBot = async (cfg: BotConfig) => {
    try {
      if (authClient.isAuthenticated()) {
        await authClient.startBotRiskSession(cfg.maxLoss, tradingModeRef.current);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Could not start protected bot session.';
      showToast('error', 'Bot Not Started', msg);
      return;
    }

    const newSessionId = `bot_sess_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    botSessionIdRef.current = newSessionId;
    processedBotTradeIdsRef.current.clear();
    botCooldownUntilRef.current = Date.now() + 800;
    prevRiskHaltedRef.current = false;

    const resetStats = { realizedPnl: 0, tradesCount: 0, wins: 0, losses: 0 };
    sessionStatsRef.current = resetStats;
    setSessionStats(resetStats);

    botPriceBufferRef.current = [...priceBufferRef.current];
    botConfigRef.current = cfg;
    setBotConfig(cfg);
    botStatusRef.current = 'running';
    setBotStatus('running');
    setBotPhase('ANALYZING');
    setStopReason('');
    audioEffects.playClick();

    const activeMarketName = selectedMarketRef.current.displayName;
    showToast(
      'success',
      'Bot Active',
      `Scanning ${activeMarketName} (${cfg.contractType}, TP: +$${cfg.targetProfit}, SL: -$${cfg.maxLoss}).`
    );
  };

  const handleStopBot = () => {
    botStatusRef.current = 'stopped';
    setBotStatus('stopped');
    setBotPhase('STOPPED');
    setStopReason('Stopped by trader.');
    if (authClient.isAuthenticated()) {
      void authClient.stopBotRiskSession();
    }
    audioEffects.playClick();
    showToast('info', 'Bot Stopped', 'Automated order generation stopped.');
  };

  const handleEmergencyStop = () => {
    botStatusRef.current = 'stopped';
    setBotStatus('stopped');
    setBotPhase('HALTED');
    setStopReason('Emergency halt activated: automated trading terminated immediately.');
    if (authClient.isAuthenticated()) {
      void authClient.stopBotRiskSession();
    }
    audioEffects.playAlert();
    showToast('error', 'Emergency Halt Activated', 'Bot halted immediately.');
  };

  // Manual trade placement using exact ticket stake & duration
  const handleManualTrade = (type: ContractType, stakeOverride?: number, durationOverride?: number) => {
    const stake = stakeOverride ?? 5;
    const durationTicks = durationOverride ?? 5;
    const availableBalance =
      tradingMode === 'demo' ? profile.demoBalance : profile.realBalance;

    if (availableBalance < stake) {
      showToast(
        'error',
        'Insufficient Balance',
        `Your balance ($${availableBalance.toFixed(2)}) cannot cover $${stake}.`
      );
      return;
    }

    let targetDigit: number | undefined;
    if (type === 'DIFFERS' || type === 'MATCHES') {
      const stats = analyzeLastDigits(recentQuotes, selectedMarket.decimals, 30);
      targetDigit = type === 'DIFFERS' ? stats.coldestDigit : stats.hottestDigit;
    }

    const payoutRate = selectedMarket.payoutRate || 0.95;
    const potentialProfit = Number((stake * payoutRate).toFixed(2));
    const potentialPayout = Number((stake + potentialProfit).toFixed(2));

    const entryPrice = currentQuote > 0 ? currentQuote : derivWsService.getCurrentQuote();
    const entryTime = Math.max(Date.now(), latestTickEpochRef.current || 0);

    const newTrade: Trade = {
      id: `man_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      symbol: selectedMarket.symbol,
      contractType: type,
      stake,
      payoutRate,
      potentialPayout,
      entryTime,
      entryPrice,
      targetDigit,
      status: 'active',
      profitLoss: 0,
      mode: tradingMode,
      durationTicks,
      remainingTicks: durationTicks,
      ticksRecorded: [entryPrice],
      strategyName: 'Manual Execution',
    };

    void submitSimulatedTrade(newTrade);
  };

  const availableBalance =
    tradingMode === 'demo' ? profile.demoBalance : profile.realBalance;

  return (
    <div className="h-full flex flex-col min-h-0 p-1 sm:p-1.5 overflow-y-auto sm:overflow-hidden select-none relative bg-[#070A0F]">
      {/* Unified Single-Page Trading Terminal: Chart + Digit Circles (Left) & Trade Panel (Right) */}
      <div className="flex-1 flex flex-col sm:flex-row min-h-0 sm:overflow-hidden bg-[#090D16] border border-slate-800/90 rounded-lg divide-y sm:divide-y-0 sm:divide-x divide-slate-800/90">
        {/* LEFT SECTION: Clean Instrument Header + Live Line Chart + Existing Digit Circles */}
        <div className="flex-1 flex flex-col min-h-[460px] sm:min-h-0 sm:h-full bg-[#090D16] overflow-y-auto lg:overflow-hidden min-w-0">
          {/* 1. Simple Top Header: Instrument Selector + Spot + Direct Real/Demo Switch + Scanner */}
          <div className="px-3 py-1.5 border-b border-slate-800/90 bg-[#0B0F19] flex flex-wrap items-center justify-between gap-2 shrink-0">
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              {/* Instrument Picker */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setIsMarketSelectorOpen(!isMarketSelectorOpen)}
                  className="flex items-center gap-2 px-2.5 py-1 rounded-md bg-slate-950 border border-slate-800 hover:border-slate-700 text-slate-100 transition-colors cursor-pointer"
                  title="Select Trading Pair"
                >
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      isWsConnected ? 'bg-emerald-400' : 'bg-rose-500'
                    }`}
                  />
                  <div className="text-left">
                    <span className="font-semibold text-xs font-sans tracking-tight block leading-tight">
                      {selectedMarket.displayName}
                    </span>
                    <span className="text-[9px] text-slate-400 font-mono block leading-none">
                      Payout +{Math.round((selectedMarket.payoutRate || 0.95) * 100)}%
                    </span>
                  </div>
                  <ChevronDown className="w-3 h-3 text-slate-400 shrink-0" />
                </button>

                {isMarketSelectorOpen && (
                  <div className="absolute left-0 top-full mt-1 w-64 bg-[#0D1322] border border-slate-700 rounded-md shadow-2xl p-1 z-50 space-y-0.5 max-h-72 overflow-y-auto">
                    {SYNTHETIC_MARKETS.map((m) => (
                      <button
                        key={m.symbol}
                        type="button"
                        onClick={() => {
                          applyMarketSelection(m);
                          setIsMarketSelectorOpen(false);
                        }}
                        className={`w-full text-left p-1.5 rounded-sm flex items-center justify-between text-xs transition-colors cursor-pointer ${
                          selectedMarket.symbol === m.symbol
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

              {/* Live Spot Quote */}
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-950 border border-slate-800">
                <span className="text-[9px] text-slate-500 font-mono uppercase">Spot</span>
                <span
                  className={`font-mono text-xs sm:text-sm font-semibold tabular-nums flex items-center gap-0.5 ${
                    tickDirection === 'up'
                      ? 'text-emerald-400'
                      : tickDirection === 'down'
                      ? 'text-rose-400'
                      : 'text-slate-100'
                  }`}
                >
                  {currentQuote > 0 ? currentQuote.toFixed(selectedMarket.decimals) : '—'}
                  {tickDirection === 'up' && <ArrowUpRight className="w-3.5 h-3.5 text-emerald-400" />}
                  {tickDirection === 'down' && <ArrowDownRight className="w-3.5 h-3.5 text-rose-400" />}
                </span>
              </div>
            </div>

            {/* Direct Homepage Demo / Real Switch & Scanner */}
            <div className="flex items-center gap-2">
              {onToggleTradingMode && (
                <div className="flex items-center bg-slate-950 p-0.5 rounded-md border border-slate-800 text-[10px] font-mono">
                  <button
                    type="button"
                    onClick={() => onToggleTradingMode('demo')}
                    className={`px-2.5 py-1 rounded-sm font-semibold transition-colors cursor-pointer ${
                      tradingMode === 'demo'
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Demo
                  </button>
                  <button
                    type="button"
                    onClick={() => onToggleTradingMode('real')}
                    className={`px-2.5 py-1 rounded-sm font-semibold transition-colors cursor-pointer ${
                      tradingMode === 'real'
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Real
                  </button>
                </div>
              )}

              <button
                type="button"
                onClick={() => handleOpenAIScanner('scan')}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-900 hover:bg-slate-800 text-cyan-300 border border-slate-700/80 font-mono text-[10px] font-semibold transition-colors cursor-pointer"
              >
                <Activity className="w-3 h-3 text-cyan-400" />
                <span>Scanner</span>
              </button>
            </div>
          </div>

          {/* 2. Main Live Line Chart */}
          <div className="flex-1 min-h-[240px] flex flex-col relative overflow-hidden">
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

          {/* 3. Existing Digit Circles cleanly anchored below the chart */}
          <div className="border-t border-slate-800/80 bg-[#090D16] p-1.5 shrink-0">
            <LiveDigitBar
              quotes={recentQuotes}
              currentQuote={currentQuote}
              decimals={selectedMarket.decimals}
              symbolName={selectedMarket.displayName}
              isLive={isWsConnected}
            />
          </div>
        </div>

        {/* RIGHT SECTION: Order Execution Panel */}
        <div className="w-full sm:w-[300px] md:w-[325px] lg:w-[345px] xl:w-[370px] flex flex-col sm:h-full min-h-0 bg-[#0B0F19] shrink-0 overflow-hidden">
          <div className="flex-1 overflow-y-auto min-h-0 p-2 space-y-2">
            <SimpleBotPanel
              market={selectedMarket}
              onSelectMarket={applyMarketSelection}
              availableMarkets={SYNTHETIC_MARKETS}
              currentQuote={currentQuote}
              tradingMode={tradingMode}
              availableBalance={availableBalance}
              botStatus={botStatus}
              botPhase={botPhase}
              liveSignalLabel={liveSignalLabel}
              stopReason={stopReason}
              onStartBot={handleStartBot}
              onStopBot={handleStopBot}
              onEmergencyStop={handleEmergencyStop}
              sessionStats={sessionStats}
              onOpenAIScanner={() => handleOpenAIScanner('scan')}
              onScanMarket={() => handleOpenAIScanner('scan')}
              onScanAndTradeForMe={() => handleOpenAIScanner('trade_for_me')}
              isScanning={false}
              activeTradesCount={activeTrades.length}
              onManualTrade={handleManualTrade}
            />

            {activeTrades.length > 0 && (
              <div className="bg-slate-950/90 border border-slate-800 rounded-md p-2.5 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono font-semibold text-cyan-300 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                    <span>Active Contracts ({activeTrades.length})</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => onNavigate('positions')}
                    className="text-[9px] text-cyan-400 hover:underline font-mono cursor-pointer"
                  >
                    Positions &rarr;
                  </button>
                </div>

                <div className="space-y-1 max-h-28 overflow-y-auto pr-0.5">
                  {activeTrades.map((t) => (
                    <div
                      key={t.id}
                      className="px-2 py-1.5 rounded bg-[#090D16] border border-slate-800/80 flex items-center justify-between text-xs font-mono"
                    >
                      <div>
                        <span
                          className={`font-semibold text-[11px] ${
                            t.contractType === 'CALL' || t.contractType === 'EVEN'
                              ? 'text-emerald-400'
                              : 'text-rose-400'
                          }`}
                        >
                          {t.contractType}
                        </span>
                        <span className="text-slate-400 text-[10px] ml-1.5 tabular-nums">
                          @ {t.entryPrice.toFixed(selectedMarket.decimals)}
                        </span>
                      </div>

                      <div className="text-right tabular-nums">
                        <span className="text-cyan-300 font-semibold text-[10px]">
                          {t.remainingTicks}t
                        </span>
                        <span className="text-slate-500 text-[9px] ml-1.5">
                          ${t.stake}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* AI Scanner Modal */}
      <AIScannerModal
        isOpen={isAIScannerModalOpen}
        onClose={() => setIsAIScannerModalOpen(false)}
        initialOption={aiScannerInitialOption}
        onSelectMarket={applyMarketSelection}
        onPrepareBotConfig={(cfg, m) => {
          applyMarketSelection(m);
          handleStartBot(cfg);
        }}
        currentMarket={selectedMarket}
        tradingMode={tradingMode}
        availableBalance={availableBalance}
      />
    </div>
  );
};
