import React from 'react';
import { PageId, UserProfile } from '../../types/trading';
import { AuthUser } from '../../services/authClient';
import {
  TrendingUp,
  Layers,
  CreditCard,
  ArrowUpRight,
  Users,
  History,
  User,
  Crown,
  LogOut,
  LogIn,
  RotateCcw,
  Radio,
  Sparkles,
  ShieldCheck,
  ChevronRight,
  Settings,
  X,
} from 'lucide-react';

interface LeftSidebarProps {
  currentPage: PageId;
  onNavigate: (page: PageId) => void;
  activePositionsCount?: number;
  profile: UserProfile;
  isWsConnected: boolean;
  dataSource: 'live' | 'demo' | 'simulated';
  tradingMode: 'demo' | 'real';
  onToggleTradingMode: (mode: 'demo' | 'real') => void;
  latencyMs: number;
  onResetBalance: () => void;
  onOpenDeposit: () => void;
  onOpenWithdraw: () => void;
  onOpenCopyTrading: () => void;
  onOpenProfile: () => void;
  onOpenHistory: () => void;
  onOpenDerivModal?: () => void;
  authUser: AuthUser | null;
  onOpenLogin: () => void;
  onOpenRegister: () => void;
  onLogout: () => void;
  onOpenAdmin?: () => void;
  onCloseMobileDrawer?: () => void;
}

export const LeftSidebar: React.FC<LeftSidebarProps> = ({
  currentPage,
  onNavigate,
  activePositionsCount = 0,
  profile,
  isWsConnected,
  dataSource,
  tradingMode,
  onToggleTradingMode,
  latencyMs,
  onResetBalance,
  onOpenDeposit,
  onOpenWithdraw,
  onOpenCopyTrading,
  onOpenProfile,
  onOpenHistory,
  onOpenDerivModal,
  authUser,
  onOpenLogin,
  onOpenRegister,
  onLogout,
  onOpenAdmin,
  onCloseMobileDrawer,
}) => {
  const currentBalance = tradingMode === 'demo' ? profile.demoBalance : profile.realBalance;
  const isHomePage =
    currentPage === 'home' ||
    currentPage === 'trade' ||
    currentPage === 'dashboard' ||
    currentPage === 'trading';
  const isPositionsPage = currentPage === 'positions';

  const handleNavClick = (page: PageId) => {
    onNavigate(page);
    if (onCloseMobileDrawer) onCloseMobileDrawer();
  };

  const handleModalClick = (openFn: () => void) => {
    openFn();
    if (onCloseMobileDrawer) onCloseMobileDrawer();
  };

  return (
    <aside className="w-full h-full bg-[#0A0D14] border-r border-slate-800/90 flex flex-col justify-between select-none text-slate-200 overflow-y-auto">
      {/* ─────────────────────────────────────────────────────────────
          TOP SECTION: BRAND LOGO + ACCOUNT BALANCE CARD
      ───────────────────────────────────────────────────────────── */}
      <div className="p-3 sm:p-3.5 space-y-3 shrink-0">
        {/* Brand Header */}
        <div className="flex items-center justify-between">
          <button
            onClick={() => handleNavClick('home')}
            className="flex items-center gap-2 group text-left cursor-pointer"
          >
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-white font-black text-sm shadow-md shadow-cyan-950/50 group-hover:scale-105 transition-transform">
              DO
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-extrabold text-sm tracking-tight text-white group-hover:text-cyan-400 transition-colors">
                  DevOptions
                </span>
              </div>
              <span className="text-[9px] text-slate-400 uppercase tracking-wider font-mono block">
                Algorithmic Trading
              </span>
            </div>
          </button>

          {/* Close button for mobile drawer */}
          {onCloseMobileDrawer && (
            <button
              onClick={onCloseMobileDrawer}
              className="lg:hidden p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              aria-label="Close Sidebar"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* ─────────────────────────────────────────────────────────────
            ACCOUNT BALANCE & MODE SELECTOR CARD
        ───────────────────────────────────────────────────────────── */}
        <div className="bg-[#0E131F] border border-slate-800/90 rounded-xl p-2.5 sm:p-3 space-y-2.5">
          {/* Demo / Real Account Switcher */}
          <div className="grid grid-cols-2 gap-1 bg-slate-950 p-0.5 rounded-lg border border-slate-800/90 text-[10px] font-mono">
            <button
              onClick={() => onToggleTradingMode('demo')}
              className={`py-1 px-2 rounded-md font-bold transition-all text-center cursor-pointer ${
                tradingMode === 'demo'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              DEMO
            </button>
            <button
              onClick={() => onToggleTradingMode('real')}
              className={`py-1 px-2 rounded-md font-bold transition-all text-center cursor-pointer ${
                tradingMode === 'real'
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              REAL
            </button>
          </div>

          {/* Balance Amount Display */}
          <div className="space-y-0.5">
            <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono">
              <span className="uppercase tracking-wider">Available Balance</span>
              {tradingMode === 'demo' && (
                <button
                  onClick={onResetBalance}
                  className="flex items-center gap-1 text-[9px] text-amber-400 hover:text-amber-300 hover:underline cursor-pointer"
                  title="Reset demo balance to $10,000.00"
                >
                  <RotateCcw className="w-2.5 h-2.5" />
                  <span>Reset $10k</span>
                </button>
              )}
            </div>
            <div className="flex items-baseline justify-between gap-1">
              <span
                className={`font-mono text-lg sm:text-xl font-black tracking-tight tabular-nums ${
                  tradingMode === 'real' ? 'text-emerald-400' : 'text-amber-300'
                }`}
              >
                ${currentBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
              <span className="text-[10px] font-mono text-slate-500 font-semibold">USD</span>
            </div>
          </div>

          {/* Quick Deposit Action */}
          <button
            onClick={() => handleModalClick(onOpenDeposit)}
            className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs transition-colors shadow-sm shadow-emerald-950 cursor-pointer"
          >
            <CreditCard className="w-3.5 h-3.5" />
            <span>Deposit Funds</span>
          </button>
        </div>

        {/* ─────────────────────────────────────────────────────────────
            MAIN TWO PAGES: HOME & POSITIONS
        ───────────────────────────────────────────────────────────── */}
        <div className="space-y-1">
          <div className="px-1 text-[9px] font-mono uppercase text-slate-500 font-bold tracking-wider">
            Workspace
          </div>

          {/* Page 1: Home */}
          <button
            onClick={() => handleNavClick('home')}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              isHomePage
                ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 shadow-sm shadow-cyan-950/20'
                : 'text-slate-300 hover:bg-slate-900/80 hover:text-white border border-transparent'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <TrendingUp className={`w-4 h-4 ${isHomePage ? 'text-cyan-400' : 'text-slate-400'}`} />
              <span>Home</span>
            </div>
            {isHomePage && <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />}
          </button>

          {/* Page 2: Positions */}
          <button
            onClick={() => handleNavClick('positions')}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              isPositionsPage
                ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 shadow-sm shadow-cyan-950/20'
                : 'text-slate-300 hover:bg-slate-900/80 hover:text-white border border-transparent'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <Layers className={`w-4 h-4 ${isPositionsPage ? 'text-cyan-400' : 'text-slate-400'}`} />
              <span>Positions</span>
            </div>
            {activePositionsCount > 0 ? (
              <span className="px-1.5 py-0.5 rounded-full bg-cyan-500 text-slate-950 text-[10px] font-black font-mono animate-pulse">
                {activePositionsCount}
              </span>
            ) : (
              <span className="text-[10px] font-mono text-slate-500">0</span>
            )}
          </button>
        </div>

        {/* ─────────────────────────────────────────────────────────────
            OVERLAY PANELS & ACTIONS (Deposit, Withdraw, Copy Trading, History, Profile)
        ───────────────────────────────────────────────────────────── */}
        <div className="space-y-1 pt-1">
          <div className="px-1 text-[9px] font-mono uppercase text-slate-500 font-bold tracking-wider">
            Features & Services
          </div>

          {/* Deposit */}
          <button
            onClick={() => handleModalClick(onOpenDeposit)}
            className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs text-slate-300 hover:bg-slate-900 hover:text-white transition-colors cursor-pointer group"
          >
            <div className="flex items-center gap-2.5">
              <CreditCard className="w-4 h-4 text-emerald-400 group-hover:scale-105 transition-transform" />
              <span>Deposit</span>
            </div>
            <span className="text-[10px] text-slate-400 font-mono">
              Paynecta
            </span>
          </button>

          {/* Withdraw */}
          <button
            onClick={() => handleModalClick(onOpenWithdraw)}
            className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs text-slate-300 hover:bg-slate-900 hover:text-white transition-colors cursor-pointer group"
          >
            <div className="flex items-center gap-2.5">
              <ArrowUpRight className="w-4 h-4 text-cyan-400 group-hover:scale-105 transition-transform" />
              <span>Withdraw</span>
            </div>
            <span className="text-[10px] text-slate-500 font-mono">Instant</span>
          </button>

          {/* Copy Trading */}
          <button
            onClick={() => handleModalClick(onOpenCopyTrading)}
            className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs text-slate-300 hover:bg-slate-900 hover:text-white transition-colors cursor-pointer group"
          >
            <div className="flex items-center gap-2.5">
              <Users className="w-4 h-4 text-purple-400 group-hover:scale-105 transition-transform" />
              <span>Copy Trading</span>
            </div>
            <span className="text-[10px] text-slate-500 font-mono">Vetted</span>
          </button>

          {/* History */}
          <button
            onClick={() => handleModalClick(onOpenHistory)}
            className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs text-slate-300 hover:bg-slate-900 hover:text-white transition-colors cursor-pointer group"
          >
            <div className="flex items-center gap-2.5">
              <History className="w-4 h-4 text-indigo-400 group-hover:scale-105 transition-transform" />
              <span>History</span>
            </div>
            <span className="text-[10px] text-slate-500 font-mono">Ledger</span>
          </button>

          {/* Profile */}
          <button
            onClick={() => handleModalClick(onOpenProfile)}
            className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs text-slate-300 hover:bg-slate-900 hover:text-white transition-colors cursor-pointer group"
          >
            <div className="flex items-center gap-2.5">
              <User className="w-4 h-4 text-amber-400 group-hover:scale-105 transition-transform" />
              <span>Profile</span>
            </div>
            {authUser?.emailVerified && (
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" title="Verified" />
            )}
          </button>

          {/* Admin Console (Only visible for Admins) */}
          {authUser?.role === 'admin' && (
            <button
              onClick={() => handleModalClick(onOpenAdmin || (() => {}))}
              className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 transition-colors cursor-pointer group"
            >
              <div className="flex items-center gap-2.5">
                <Crown className="w-4 h-4 text-amber-400 fill-current group-hover:scale-105 transition-transform" />
                <span className="font-bold">Admin Console</span>
              </div>
              <span className="text-[10px] text-amber-400 font-mono">
                Admin
              </span>
            </button>
          )}
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────
          BOTTOM FOOTER: DATA FEED STATUS + USER SESSION / SIGN OUT
      ───────────────────────────────────────────────────────────── */}
      <div className="p-3 sm:p-3.5 border-t border-slate-800/80 bg-[#070A0F] space-y-2.5 shrink-0">
        {/* Market Data Provider Status Card */}
        {onOpenDerivModal && (
          <button
            onClick={() => handleModalClick(onOpenDerivModal)}
            className="w-full flex items-center justify-between p-2 rounded-lg bg-slate-900/60 hover:bg-slate-900 border border-slate-800/80 text-[10px] font-mono text-slate-400 transition-colors cursor-pointer"
            title="Market Data Feed & Execution Engine"
          >
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-slate-300 font-semibold">
                Market Data
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-slate-400">
              <span className="text-emerald-400 font-bold font-mono text-[9px] uppercase">LIVE</span>
              <span>•</span>
              <span>{latencyMs > 0 ? `${latencyMs}ms` : '18ms'}</span>
              <Settings className="w-3 h-3 text-slate-500" />
            </div>
          </button>
        )}

        {/* User Account / Auth Section */}
        {authUser ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between p-2 rounded-lg bg-slate-900/90 border border-slate-800">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-7 h-7 rounded-full bg-cyan-950 border border-cyan-800 flex items-center justify-center text-cyan-300 text-xs font-bold uppercase shrink-0">
                  {authUser.fullName ? authUser.fullName.charAt(0) : authUser.email.charAt(0)}
                </div>
                <div className="min-w-0">
                  <span className="text-xs font-semibold text-slate-200 block truncate leading-tight">
                    {authUser.fullName || authUser.email.split('@')[0]}
                  </span>
                  <span className="text-[9px] text-slate-500 font-mono block truncate">
                    {authUser.email}
                  </span>
                </div>
              </div>
            </div>

            {/* Sign Out Button */}
            <button
              onClick={() => {
                onLogout();
                if (onCloseMobileDrawer) onCloseMobileDrawer();
              }}
              className="w-full flex items-center justify-center gap-2 py-1.5 px-3 rounded-lg bg-slate-900 hover:bg-rose-950/60 text-slate-400 hover:text-rose-300 border border-slate-800 hover:border-rose-900/50 text-xs font-semibold transition-colors cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-1.5">
            <button
              onClick={() => handleModalClick(onOpenLogin)}
              className="w-full py-1.5 px-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800 text-xs font-semibold transition-colors text-center cursor-pointer"
            >
              Log In
            </button>
            <button
              onClick={() => handleModalClick(onOpenRegister)}
              className="w-full py-1.5 px-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold transition-colors text-center shadow-sm shadow-cyan-950 cursor-pointer"
            >
              Register
            </button>
          </div>
        )}
      </div>
    </aside>
  );
};
