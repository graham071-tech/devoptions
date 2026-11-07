import React, { useState, useEffect, useRef } from 'react';
import { PageId, Trade, UserProfile, Tick } from './types/trading';
import { storage } from './services/storage';
import { marketDataProvider } from './services/marketDataProvider';
import { audioEffects } from './services/audioEffects';
import { extractLastDigit } from './utils/indicators';
import { SYNTHETIC_MARKETS } from './data/syntheticMarkets';
import { ToastProvider, useToast } from './components/common/ToastNotification';
import { LeftSidebar } from './components/layout/LeftSidebar';
import { TradeWorkspace } from './components/trading/TradeWorkspace';
import { PositionsPage } from './components/positions/PositionsPage';
import { DepositModal } from './components/modals/DepositModal';
import { WithdrawModal } from './components/modals/WithdrawModal';
import { CopyTradingModal } from './components/modals/CopyTradingModal';
import { ProfileModal } from './components/modals/ProfileModal';
import { HistoryModal } from './components/modals/HistoryModal';
import { ProviderSettingsModal } from './components/modals/ProviderSettingsModal';
import { authClient, AuthUser } from './services/authClient';
import { AuthModal, AuthMode } from './components/auth/AuthModal';
import { WelcomeOverlay } from './components/auth/WelcomeOverlay';
import { AdminPortalModal } from './components/modals/AdminPortalModal';
import { Menu, X, Crown, TrendingUp } from 'lucide-react';

function TradingAppContent() {
  const { showToast } = useToast();

  // The application has exactly TWO main pages: 'home' and 'positions'
  const [currentPage, setCurrentPage] = useState<PageId>('home');
  const [profile, setProfile] = useState<UserProfile>(() => storage.getUserProfile());
  const [tradingMode, setTradingMode] = useState<'demo' | 'real'>('demo');

  // Real Authentication state
  const [authUser, setAuthUser] = useState<AuthUser | null>(() => authClient.getCurrentUser());
  const [isAuthModalOpen, setIsAuthModalOpen] = useState<boolean>(false);
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [hasExploredDemo, setHasExploredDemo] = useState<boolean>(() => {
    return sessionStorage.getItem('devoptions_demo_explored') === 'true';
  });

  // Mobile navigation drawer state
  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState<boolean>(false);

  // Modal overlays accessible from Sidebar / Menu
  const [isDepositModalOpen, setIsDepositModalOpen] = useState<boolean>(false);
  const [isWithdrawModalOpen, setIsWithdrawModalOpen] = useState<boolean>(false);
  const [isCopyTradingModalOpen, setIsCopyTradingModalOpen] = useState<boolean>(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState<boolean>(false);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState<boolean>(false);
  const [isProviderModalOpen, setIsProviderModalOpen] = useState<boolean>(false);
  const [isAdminModalOpen, setIsAdminModalOpen] = useState<boolean>(false);

  // Market Provider Connection & Live Price Feed
  const [isWsConnected, setIsWsConnected] = useState<boolean>(true);
  const [dataSource, setDataSource] = useState<'live' | 'demo'>('demo');
  const [latencyMs, setLatencyMs] = useState<number>(18);
  const [liveQuote, setLiveQuote] = useState<number>(marketDataProvider.getCurrentQuote());

  // Shared Trades State between Home and Positions
  const [activeTrades, setActiveTrades] = useState<Trade[]>([]);
  const [completedTrades, setCompletedTrades] = useState<Trade[]>(() =>
    storage.getTradeHistory().slice(0, 50)
  );

  const activeTradesRef = useRef<Trade[]>(activeTrades);
  activeTradesRef.current = activeTrades;

  const profileRef = useRef<UserProfile>(profile);
  profileRef.current = profile;

  // Session verification and sync
  useEffect(() => {
    authClient.fetchMe().then((u) => {
      if (u) {
        setAuthUser(u);
      }
    });

    const unsubAuth = authClient.subscribe((u) => {
      setAuthUser(u);
      if (u) {
        setProfile((prev) => ({
          ...prev,
          name: u.fullName || u.email.split('@')[0],
          email: u.email,
          demoBalance: u.demoBalance ?? prev.demoBalance,
          realBalance: u.realBalance ?? prev.realBalance,
        }));
        authClient.getTrades().then((serverTrades) => {
          const trades = serverTrades as Trade[];
          const openTrades = trades.filter((trade) => trade.status === 'active');
          const settledTrades = trades.filter((trade) => trade.status !== 'active');
          setActiveTrades(openTrades);
          if (settledTrades.length) {
            storage.replaceTradeHistory(settledTrades);
            setCompletedTrades(settledTrades);
          }
        }).catch((error) => console.warn('Could not sync server trade history:', error));
      }
    });

    return () => unsubAuth();
  }, []);

  // Detect Paynecta redirect query parameters (?deposit_ref=...) and open deposit modal
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const depositRef = urlParams.get('deposit_ref');
    if (depositRef) {
      setIsDepositModalOpen(true);
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  useEffect(() => {
    // Initialize audio synthesizer setting
    audioEffects.setEnabled(profile.soundEnabled);

    // Initialize provider-independent market data stream
    const unsubConn = marketDataProvider.subscribeToConnection((connected, source, lat) => {
      setIsWsConnected(connected);
      setDataSource(source);
      setLatencyMs(lat);
    });

    // Central tick listener for active contract countdowns & resolutions
    const unsubTicks = marketDataProvider.subscribeToTicks((tick: Tick) => {
      setLiveQuote(tick.quote);

      if (activeTradesRef.current.length > 0) {
        processTickForActiveTrades(tick);
      }
    });

    return () => {
      unsubConn();
      unsubTicks();
      marketDataProvider.disconnect();
    };
  }, []);

  // Tick progression and trade resolution handler
  const processTickForActiveTrades = (tick: Tick) => {
    const remainingActive: Trade[] = [];
    const newlyCompleted: Trade[] = [];

    activeTradesRef.current.forEach((trade) => {
      if (trade.symbol !== tick.symbol) {
        remainingActive.push(trade);
        return;
      }

      const newRemaining = trade.remainingTicks - 1;
      const ticksRecorded = [...trade.ticksRecorded, tick.quote];

      // Check if touch condition met early
      if (trade.contractType === 'TOUCH' && trade.barrier && tick.quote >= trade.barrier) {
        const resolved = resolveTrade(trade, tick.quote, true);
        newlyCompleted.push(resolved);
        return;
      }

      if (newRemaining <= 0) {
        const resolved = resolveTrade(trade, tick.quote);
        newlyCompleted.push(resolved);
      } else {
        remainingActive.push({
          ...trade,
          remainingTicks: newRemaining,
          ticksRecorded,
        });
      }
    });

    if (newlyCompleted.length > 0) {
      setActiveTrades(remainingActive);
      setCompletedTrades((prev) => [...newlyCompleted, ...prev].slice(0, 100));

      // Settle authenticated trades atomically in Supabase. Guest demo trades remain local.
      newlyCompleted.forEach((trade) => {
        if (authClient.isAuthenticated()) {
          authClient.settleTrade(trade).then((balances) => {
            setProfile((prev) => {
              const updated = { ...prev, ...balances };
              storage.saveUserProfile(updated);
              return updated;
            });
          }).catch((error) => {
            console.error('Could not settle simulated trade on server:', error);
            showToast('error', 'Settlement Needs Attention', 'The server could not confirm this trade settlement. Please refresh and check your account balance.');
          });
        } else if (trade.mode === 'demo' && trade.status === 'won') {
          setProfile((prev) => {
            const updated = { ...prev, demoBalance: Number((prev.demoBalance + trade.potentialPayout).toFixed(2)) };
            storage.saveUserProfile(updated);
            return updated;
          });
        }
        storage.addTrade(trade);
      });

      // Audio and toast feedback
      const hasWin = newlyCompleted.some((t) => t.status === 'won');
      const hasLoss = newlyCompleted.some((t) => t.status === 'lost');

      if (hasWin && !hasLoss) {
        audioEffects.playWin();
        showToast(
          'success',
          'Contract Won',
          `Trade settled in profit (+$${newlyCompleted[0].profitLoss.toFixed(2)} USD)`
        );
      } else if (hasLoss && !hasWin) {
        audioEffects.playLoss();
        showToast(
          'error',
          'Contract Lost',
          `Trade settled at loss (-$${Math.abs(newlyCompleted[0].profitLoss).toFixed(2)} USD)`
        );
      } else {
        audioEffects.playAlert();
      }
    } else if (remainingActive.length !== activeTradesRef.current.length) {
      setActiveTrades(remainingActive);
    }
  };

  // Resolve contract outcome based on type and final tick
  const resolveTrade = (trade: Trade, exitPrice: number, earlyWin = false): Trade => {
    let isWon = false;
    const market = SYNTHETIC_MARKETS.find((m) => m.symbol === trade.symbol) || SYNTHETIC_MARKETS[0];
    const lastDigit = extractLastDigit(exitPrice, market.decimals);

    if (earlyWin) {
      isWon = true;
    } else {
      switch (trade.contractType) {
        case 'CALL':
          isWon = exitPrice > trade.entryPrice;
          break;
        case 'PUT':
          isWon = exitPrice < trade.entryPrice;
          break;
        case 'MATCHES':
          isWon = lastDigit === trade.targetDigit;
          break;
        case 'DIFFERS':
          isWon = lastDigit !== trade.targetDigit;
          break;
        case 'EVEN':
          isWon = lastDigit % 2 === 0;
          break;
        case 'ODD':
          isWon = lastDigit % 2 !== 0;
          break;
        case 'OVER':
          isWon = trade.targetDigit !== undefined && lastDigit > trade.targetDigit;
          break;
        case 'UNDER':
          isWon = trade.targetDigit !== undefined && lastDigit < trade.targetDigit;
          break;
        default:
          isWon = exitPrice > trade.entryPrice;
      }
    }

    const profitLoss = isWon
      ? Number((trade.potentialPayout - trade.stake).toFixed(2))
      : -trade.stake;

    return {
      ...trade,
      exitPrice,
      exitTime: Date.now(),
      status: isWon ? 'won' : 'lost',
      profitLoss,
      remainingTicks: 0,
      ticksRecorded: [...trade.ticksRecorded, exitPrice],
    };
  };

  const handleToggleMode = (mode: 'demo' | 'real') => {
    setTradingMode(mode);
    audioEffects.playClick();
    showToast(
      'info',
      `${mode.toUpperCase()} Account Active`,
      mode === 'demo'
        ? 'Risk-free practice environment.'
        : 'Real-balance simulation is paused until market results can be verified by the server. No broker orders are placed.'
    );
  };

  const handleResetBalance = () => {
    if (tradingMode === 'demo') {
      const updated = { ...profile, demoBalance: 10000.0 };
      setProfile(updated);
      storage.saveUserProfile(updated);
      audioEffects.playClick();
      showToast('success', 'Demo Balance Reset', 'Your demo balance is refreshed to $10,000.00 USD.');
    }
  };

  const handleClearTradeHistory = () => {
    storage.clearTradeHistory();
    setCompletedTrades([]);
    audioEffects.playClick();
    showToast('info', 'History Cleared', 'Trade records have been cleared from local storage.');
  };

  const handleNavigate = (page: PageId) => {
    setCurrentPage(page);
    setIsMobileDrawerOpen(false);
  };

  const handleOpenDeposit = () => {
    setIsDepositModalOpen(true);
    setIsMobileDrawerOpen(false);
  };

  const handleOpenWithdraw = () => {
    setIsWithdrawModalOpen(true);
    setIsMobileDrawerOpen(false);
  };

  const handleOpenCopyTrading = () => {
    setIsCopyTradingModalOpen(true);
    setIsMobileDrawerOpen(false);
  };

  const handleExploreDemo = () => {
    setHasExploredDemo(true);
    sessionStorage.setItem('devoptions_demo_explored', 'true');
    showToast('info', 'Demo Mode Active', 'Explore all features with $10,000.00 demo balance.');
  };

  const handleLogout = async () => {
    await authClient.logout();
    setAuthUser(null);
    setHasExploredDemo(false);
    sessionStorage.removeItem('devoptions_demo_explored');
    audioEffects.playClick();
    showToast('info', 'Logged Out', 'You have been signed out of your account.');
  };

  const isHomePage =
    currentPage === 'home' ||
    currentPage === 'trade' ||
    currentPage === 'dashboard' ||
    currentPage === 'trading';

  const currentBalance = tradingMode === 'demo' ? profile.demoBalance : profile.realBalance;

  return (
    <div className="h-screen max-h-screen bg-[#070A0F] text-slate-100 flex flex-col font-sans selection:bg-cyan-500/30 selection:text-cyan-200 overflow-hidden">
      {/* ─────────────────────────────────────────────────────────────
          MOBILE TOP BAR (Visible only on screens < lg)
          Contains Logo, Balance Pill, and Hamburger button
      ───────────────────────────────────────────────────────────── */}
      <div className="lg:hidden h-11 bg-[#0A0D14] border-b border-slate-800 px-3 flex items-center justify-between shrink-0 select-none">
        {/* Mobile Brand */}
        <button
          onClick={() => handleNavigate('home')}
          className="flex items-center gap-2 text-left cursor-pointer"
        >
          <div className="w-6 h-6 rounded bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-white font-black text-xs">
            DO
          </div>
          <span className="font-extrabold text-sm tracking-tight text-white">DevOptions</span>
        </button>

        {/* Mobile Balance & Menu Button */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-slate-900 border border-slate-800 text-xs font-mono">
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                tradingMode === 'real' ? 'bg-emerald-400' : 'bg-amber-400'
              }`}
            />
            <span className="font-bold text-slate-100">
              ${currentBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>

          <button
            onClick={() => setIsMobileDrawerOpen(true)}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700"
            aria-label="Open Navigation Menu"
          >
            <Menu className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────
          MOBILE SLIDING DRAWER (LeftSidebar overlay on mobile)
      ───────────────────────────────────────────────────────────── */}
      {isMobileDrawerOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div
            className="fixed inset-0 bg-black/70 backdrop-blur-sm transition-opacity"
            onClick={() => setIsMobileDrawerOpen(false)}
          />
          <div className="relative w-72 max-w-[85vw] h-full z-10 animate-in slide-in-from-left duration-200">
            <LeftSidebar
              currentPage={currentPage}
              onNavigate={handleNavigate}
              activePositionsCount={activeTrades.length}
              profile={profile}
              isWsConnected={isWsConnected}
              dataSource={dataSource}
              tradingMode={tradingMode}
              onToggleTradingMode={handleToggleMode}
              latencyMs={latencyMs}
              onResetBalance={handleResetBalance}
              onOpenDeposit={handleOpenDeposit}
              onOpenWithdraw={handleOpenWithdraw}
              onOpenCopyTrading={handleOpenCopyTrading}
              onOpenProfile={() => setIsProfileModalOpen(true)}
              onOpenHistory={() => setIsHistoryModalOpen(true)}
              onOpenDerivModal={() => setIsProviderModalOpen(true)}
              authUser={authUser}
              onOpenLogin={() => {
                setAuthMode('login');
                setIsAuthModalOpen(true);
                setIsMobileDrawerOpen(false);
              }}
              onOpenRegister={() => {
                setAuthMode('register');
                setIsAuthModalOpen(true);
                setIsMobileDrawerOpen(false);
              }}
              onLogout={handleLogout}
              onOpenAdmin={() => {
                setIsAdminModalOpen(true);
                setIsMobileDrawerOpen(false);
              }}
              onCloseMobileDrawer={() => setIsMobileDrawerOpen(false)}
            />
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          DESKTOP THREE-COLUMN WORKSPACE:
          - Column 1: Left Sidebar (~18% of available width)
          - Column 2: Center Chart Area (~55% of available width)
          - Column 3: Right Trading Panel (~27% of available width)
      ───────────────────────────────────────────────────────────── */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* COLUMN 1: LEFT SIDEBAR (~18% desktop width, fixed & compact) */}
        <div className="hidden lg:flex lg:w-[18%] lg:min-w-[210px] lg:max-w-[250px] shrink-0 h-full">
          <LeftSidebar
            currentPage={currentPage}
            onNavigate={handleNavigate}
            activePositionsCount={activeTrades.length}
            profile={profile}
            isWsConnected={isWsConnected}
            dataSource={dataSource}
            tradingMode={tradingMode}
            onToggleTradingMode={handleToggleMode}
            latencyMs={latencyMs}
            onResetBalance={handleResetBalance}
            onOpenDeposit={handleOpenDeposit}
            onOpenWithdraw={handleOpenWithdraw}
            onOpenCopyTrading={handleOpenCopyTrading}
            onOpenProfile={() => setIsProfileModalOpen(true)}
            onOpenHistory={() => setIsHistoryModalOpen(true)}
            onOpenDerivModal={() => setIsProviderModalOpen(true)}
            authUser={authUser}
            onOpenLogin={() => {
              setAuthMode('login');
              setIsAuthModalOpen(true);
            }}
            onOpenRegister={() => {
              setAuthMode('register');
              setIsAuthModalOpen(true);
            }}
            onLogout={handleLogout}
            onOpenAdmin={() => setIsAdminModalOpen(true)}
          />
        </div>

        {/* COLUMNS 2 & 3: MAIN VIEWPORT (CENTER CHART ~55% + RIGHT TRADING PANEL ~27%) */}
        <main className={`flex-1 min-w-0 h-full ${isHomePage ? 'overflow-hidden' : 'overflow-y-auto'} bg-[#070A0F]`}>
          {/* PAGE 1: HOME (Side-by-side: Center Chart ~55% + Right Trading Panel ~27%) */}
          {isHomePage && (
            <TradeWorkspace
              profile={profile}
              onUpdateProfile={setProfile}
              tradingMode={tradingMode}
              onNavigate={handleNavigate}
              isWsConnected={isWsConnected}
              dataSource={dataSource}
              activeTrades={activeTrades}
              onSetActiveTrades={setActiveTrades}
              completedTrades={completedTrades}
              onSetCompletedTrades={setCompletedTrades}
            />
          )}

          {/* PAGE 2: POSITIONS (Audit trail of active and settled contracts) */}
          {currentPage === 'positions' && (
            <PositionsPage
              activeTrades={activeTrades}
              completedTrades={completedTrades}
              onClearHistory={handleClearTradeHistory}
              onNavigate={handleNavigate}
              currentQuote={liveQuote}
              profile={profile}
              tradingMode={tradingMode}
            />
          )}
        </main>
      </div>

      {/* ─────────────────────────────────────────────────────────────
          UNAUTHENTICATED WELCOME OVERLAY
      ───────────────────────────────────────────────────────────── */}
      {!authUser && !hasExploredDemo && (
        <WelcomeOverlay
          onOpenRegister={() => {
            setAuthMode('register');
            setIsAuthModalOpen(true);
          }}
          onOpenLogin={() => {
            setAuthMode('login');
            setIsAuthModalOpen(true);
          }}
          onExploreDemo={handleExploreDemo}
        />
      )}

      {/* AUTHENTICATION MODAL */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        initialMode={authMode}
        onAuthSuccess={(user) => {
          setAuthUser(user);
          setHasExploredDemo(true);
          sessionStorage.setItem('devoptions_demo_explored', 'true');
        }}
      />

      {/* MODAL OVERLAYS */}
      {/* 1. Deposit Modal ($5 minimum, M-Pesa & Card) */}
      <DepositModal
        isOpen={isDepositModalOpen}
        onClose={() => setIsDepositModalOpen(false)}
        profile={profile}
        onProfileUpdate={setProfile}
        authUser={authUser}
        onOpenAuth={(mode) => {
          setAuthMode(mode);
          setIsAuthModalOpen(true);
        }}
      />

      {/* 2. Withdraw Modal (M-Pesa & Bank Wire) */}
      <WithdrawModal
        isOpen={isWithdrawModalOpen}
        onClose={() => setIsWithdrawModalOpen(false)}
        profile={profile}
        onProfileUpdate={setProfile}
      />

      {/* 3. Copy Trading Modal */}
      <CopyTradingModal
        isOpen={isCopyTradingModalOpen}
        onClose={() => setIsCopyTradingModalOpen(false)}
        profile={profile}
        onProfileUpdate={setProfile}
      />

      {/* 4. Profile Modal */}
      <ProfileModal
        isOpen={isProfileModalOpen}
        onClose={() => setIsProfileModalOpen(false)}
        profile={profile}
        onProfileUpdate={setProfile}
        tradingMode={tradingMode}
        authUser={authUser}
        onOpenAuth={(mode) => {
          setAuthMode(mode);
          setIsAuthModalOpen(true);
        }}
        onLogout={handleLogout}
        onOpenAdmin={() => setIsAdminModalOpen(true)}
      />

      {/* 5. History Modal */}
      <HistoryModal
        isOpen={isHistoryModalOpen}
        onClose={() => setIsHistoryModalOpen(false)}
        trades={completedTrades}
        onClearHistory={handleClearTradeHistory}
      />

      {/* Administrator Portal Modal */}
      <AdminPortalModal
        isOpen={isAdminModalOpen}
        onClose={() => setIsAdminModalOpen(false)}
        currentUser={authUser}
        onOpenAuthModal={() => {
          setIsAdminModalOpen(false);
          setAuthMode('login');
          setIsAuthModalOpen(true);
        }}
      />

      {/* Provider & Gateway Settings Modal */}
      <ProviderSettingsModal
        isOpen={isProviderModalOpen}
        onClose={() => setIsProviderModalOpen(false)}
        profile={profile}
        onProfileUpdate={setProfile}
        isWsConnected={isWsConnected}
        dataSource={dataSource}
        latencyMs={latencyMs}
      />
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <TradingAppContent />
    </ToastProvider>
  );
}
