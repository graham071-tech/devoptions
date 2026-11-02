import React, { useState, useRef, useEffect } from 'react';
import { PageId, UserProfile } from '../../types/trading';
import { AuthUser } from '../../services/authClient';
import {
  Menu as MenuIcon,
  Radio,
  User,
  ChevronDown,
  RotateCcw,
  Settings,
  KeyRound,
  CreditCard,
  ArrowUpRight,
  Users,
  Home,
  Layers,
  History,
  X,
  Sparkles,
  ShieldCheck,
  LogIn,
  LogOut,
  UserPlus,
  Crown,
} from 'lucide-react';

interface NavbarProps {
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
  onOpenDerivModal: () => void;
  authUser: AuthUser | null;
  onOpenLogin: () => void;
  onOpenRegister: () => void;
  onLogout: () => void;
  onOpenAdmin?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
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
}) => {
  const [isMenuOpen, setIsMenuOpen] = useState<boolean>(false);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState<boolean>(false);

  const menuRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);

  // Close menus on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
      if (profileRef.current && !profileRef.current.contains(event.target as Node)) {
        setIsProfileMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const currentBalance = tradingMode === 'demo' ? profile.demoBalance : profile.realBalance;
  const isHomePage =
    currentPage === 'home' ||
    currentPage === 'trade' ||
    currentPage === 'dashboard' ||
    currentPage === 'trading';
  const isPositionsPage = currentPage === 'positions';

  const handleMenuAction = (action: 'deposit' | 'withdraw' | 'copy' | 'profile' | 'history') => {
    setIsMenuOpen(false);
    if (action === 'deposit') onOpenDeposit();
    else if (action === 'withdraw') onOpenWithdraw();
    else if (action === 'copy') onOpenCopyTrading();
    else if (action === 'profile') onOpenProfile();
    else if (action === 'history') onOpenHistory();
  };

  return (
    <header className="sticky top-0 z-40 bg-[#0B0E17] border-b border-slate-800 px-3 sm:px-4 h-11 flex items-center justify-between gap-2.5 select-none shrink-0">
      {/* ─────────────────────────────────────────────────────────────
          ZONE 1: BRAND LOGO + TWO MAIN PAGES (HOME & POSITIONS)
      ───────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2.5 sm:gap-4 shrink-0">
        {/* Brand Logo: DevOptions */}
        <button
          onClick={() => onNavigate('home')}
          className="text-sm font-bold tracking-tight text-slate-100 hover:text-cyan-400 transition-colors whitespace-nowrap shrink-0 flex items-center gap-2 cursor-pointer"
        >
          <div className="w-5.5 h-5.5 rounded bg-slate-900 border border-cyan-500/40 flex items-center justify-center text-cyan-400 font-black text-xs">
            D
          </div>
          <span className="font-sans font-extrabold tracking-wider text-xs hidden xs:inline">
            DEV<span className="text-cyan-400">OPTIONS</span>
          </span>
        </button>

        {/* The TWO Main Page Links: Home & Positions */}
        <nav className="flex items-center gap-1">
          {/* 1. Home Page */}
          <button
            onClick={() => onNavigate('home')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold transition-colors cursor-pointer ${
              isHomePage
                ? 'bg-slate-800 text-cyan-300 border border-slate-700'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            <Home className="w-3.5 h-3.5" />
            <span>Home</span>
          </button>

          {/* 2. Positions Page */}
          <button
            onClick={() => onNavigate('positions')}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-semibold transition-colors cursor-pointer relative ${
              isPositionsPage
                ? 'bg-slate-800 text-cyan-300 border border-slate-700'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span>Positions</span>
            {activePositionsCount > 0 && (
              <span className="px-1.5 py-0.2 rounded bg-cyan-950 text-cyan-300 border border-cyan-800 font-mono text-[9px] font-bold">
                {activePositionsCount}
              </span>
            )}
          </button>
        </nav>
      </div>

      {/* ─────────────────────────────────────────────────────────────
          ZONE 2: MENU BUTTON, BALANCE, DEMO/REAL SWITCH, PROFILE
      ───────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
        {/* Connection status indicator */}
        <button
          onClick={onOpenDerivModal}
          title={
            dataSource === 'live' && isWsConnected
              ? `Connected to External Data Feed (${latencyMs}ms)`
              : 'DevOptions Demo Feed (Click to configure Data & Execution Provider)'
          }
          className="hidden md:flex items-center gap-1.5 px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-[10px] text-slate-300 hover:border-slate-700 transition-colors cursor-pointer font-mono"
        >
          <Radio
            className={`w-3 h-3 ${
              dataSource === 'live' && isWsConnected ? 'text-emerald-400' : 'text-amber-400'
            }`}
          />
          <span className="text-slate-400 text-[10px]">
            {dataSource === 'live' && isWsConnected ? `${latencyMs}ms` : 'Demo'}
          </span>
        </button>

        {/* Demo vs Real Account Switch */}
        <div className="flex bg-slate-950 p-0.5 rounded border border-slate-800 text-xs font-mono">
          <button
            onClick={() => onToggleTradingMode('demo')}
            className={`px-2 py-0.5 rounded font-bold text-[10px] transition-colors cursor-pointer ${
              tradingMode === 'demo'
                ? 'bg-slate-800 text-cyan-300 border border-slate-700'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            DEMO
          </button>
          <button
            onClick={() => onToggleTradingMode('real')}
            className={`px-2 py-0.5 rounded font-bold text-[10px] transition-colors cursor-pointer ${
              tradingMode === 'real'
                ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            REAL
          </button>
        </div>

        {/* Displayed Account Balance */}
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-900 border border-slate-800 text-xs">
          <div className="text-right">
            <span className="text-[8.5px] text-slate-500 block uppercase font-mono font-medium leading-none">
              {tradingMode === 'demo' ? 'Demo' : 'Real'} Balance
            </span>
            <span className="font-mono font-bold text-slate-100 text-[11px] tabular-nums">
              ${currentBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
        </div>

        {/* User Account / Auth Actions */}
        {authUser ? (
          <div className="hidden sm:flex items-center gap-1.5">
            <button
              onClick={onOpenProfile}
              className="flex items-center gap-1.5 px-2 py-1 rounded bg-slate-900 border border-slate-800 hover:border-slate-700 text-xs text-slate-200 transition-colors cursor-pointer"
              title={`Logged in as ${authUser.email}`}
            >
              <div className={`w-2 h-2 rounded-full ${authUser.emailVerified ? 'bg-emerald-400' : 'bg-amber-400'}`} />
              <span className="font-mono text-[10.5px] max-w-[110px] truncate">{authUser.email.split('@')[0]}</span>
            </button>
            {authUser.role === 'admin' && (
              <button
                onClick={() => onOpenAdmin && onOpenAdmin()}
                className="flex items-center gap-1 px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30 font-mono text-[9.5px] font-bold transition-all shadow-sm shadow-amber-950 cursor-pointer"
                title="Open Admin Portal"
              >
                <Crown className="w-3 h-3 fill-current" />
                <span>ADMIN</span>
              </button>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <button
              onClick={onOpenLogin}
              className="px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800 text-[11px] font-semibold transition-colors cursor-pointer"
            >
              Log In
            </button>
            <button
              onClick={onOpenRegister}
              className="hidden sm:inline-flex px-2 py-0.5 rounded bg-cyan-600 hover:bg-cyan-500 text-white text-[11px] font-bold transition-colors cursor-pointer shadow-sm shadow-cyan-950"
            >
              Register
            </button>
          </div>
        )}

        {/* ─────────────────────────────────────────────────────────────
            THE MENU BUTTON (Required: Deposit, Withdraw, Copy Trading, Profile, History)
        ───────────────────────────────────────────────────────────── */}
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded font-semibold text-xs transition-colors cursor-pointer ${
              isMenuOpen
                ? 'bg-slate-700 text-white border border-slate-600'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
            }`}
            aria-label="Open Action Menu"
          >
            <MenuIcon className="w-3.5 h-3.5" />
            <span className="hidden xs:inline uppercase text-[10px] font-mono tracking-wider">Menu</span>
            <ChevronDown className={`w-3 h-3 transition-transform ${isMenuOpen ? 'rotate-180' : ''}`} />
          </button>

          {/* Menu Dropdown Modal / Overlay */}
          {isMenuOpen && (
            <div className="absolute right-0 mt-2 w-64 bg-[#0D1322] border border-slate-800 rounded-xl shadow-2xl p-2 z-50 space-y-1 text-xs animate-in fade-in slide-in-from-top-2 duration-150">
              <div className="px-3 py-2 border-b border-slate-800/80 mb-1 flex items-center justify-between">
                <span className="text-[10px] font-mono uppercase text-slate-400 font-bold tracking-wider">
                  Menu Options
                </span>
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800 font-mono">
                  DevOptions
                </span>
              </div>

              {/* 1. Deposit */}
              <button
                onClick={() => handleMenuAction('deposit')}
                className="w-full text-left p-2.5 rounded-lg hover:bg-slate-800/80 text-slate-200 flex items-start gap-3 transition-colors group"
              >
                <div className="w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0 group-hover:scale-105 transition-transform">
                  <CreditCard className="w-4 h-4" />
                </div>
                <div>
                  <div className="font-bold text-slate-100 flex items-center gap-1.5">
                    <span>Deposit</span>
                    <span className="text-[9px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 font-mono">
                      Min $5
                    </span>
                  </div>
                  <span className="text-[11px] text-slate-400 block mt-0.5">
                    M-Pesa (KES) & Bank Cards
                  </span>
                </div>
              </button>

              {/* 2. Withdraw */}
              <button
                onClick={() => handleMenuAction('withdraw')}
                className="w-full text-left p-2.5 rounded-lg hover:bg-slate-800/80 text-slate-200 flex items-start gap-3 transition-colors group"
              >
                <div className="w-8 h-8 rounded-lg bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shrink-0 group-hover:scale-105 transition-transform">
                  <ArrowUpRight className="w-4 h-4" />
                </div>
                <div>
                  <div className="font-bold text-slate-100">Withdraw</div>
                  <span className="text-[11px] text-slate-400 block mt-0.5">
                    M-Pesa & Bank Wire Transfer
                  </span>
                </div>
              </button>

              {/* 3. Copy Trading */}
              <button
                onClick={() => handleMenuAction('copy')}
                className="w-full text-left p-2.5 rounded-lg hover:bg-slate-800/80 text-slate-200 flex items-start gap-3 transition-colors group"
              >
                <div className="w-8 h-8 rounded-lg bg-purple-500/15 border border-purple-500/30 flex items-center justify-center text-purple-400 shrink-0 group-hover:scale-105 transition-transform">
                  <Users className="w-4 h-4" />
                </div>
                <div>
                  <div className="font-bold text-slate-100 flex items-center gap-1.5">
                    <span>Copy Trading</span>
                    <span className="text-[9px] px-1.5 py-0.2 rounded bg-purple-500/20 text-purple-300 font-mono">
                      Top Traders
                    </span>
                  </div>
                  <span className="text-[11px] text-slate-400 block mt-0.5">
                    Mirror vetted strategy providers
                  </span>
                </div>
              </button>

              {/* 4. Profile */}
              <button
                onClick={() => handleMenuAction('profile')}
                className="w-full text-left p-2.5 rounded-lg hover:bg-slate-800/80 text-slate-200 flex items-start gap-3 transition-colors group"
              >
                <div className="w-8 h-8 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0 group-hover:scale-105 transition-transform">
                  <User className="w-4 h-4" />
                </div>
                <div>
                  <div className="font-bold text-slate-100">Profile</div>
                  <span className="text-[11px] text-slate-400 block mt-0.5">
                    Account details & preferences
                  </span>
                </div>
              </button>

              {/* 5. History */}
              <button
                onClick={() => handleMenuAction('history')}
                className="w-full text-left p-2.5 rounded-lg hover:bg-slate-800/80 text-slate-200 flex items-start gap-3 transition-colors group"
              >
                <div className="w-8 h-8 rounded-lg bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shrink-0 group-hover:scale-105 transition-transform">
                  <History className="w-4 h-4" />
                </div>
                <div>
                  <div className="font-bold text-slate-100">History</div>
                  <span className="text-[11px] text-slate-400 block mt-0.5">
                    Complete trade logs &amp; statistics
                  </span>
                </div>
              </button>

              {/* 6. Admin Console (Shown if user is Admin) */}
              {authUser?.role === 'admin' && (
                <button
                  onClick={() => {
                    setIsMenuOpen(false);
                    if (onOpenAdmin) onOpenAdmin();
                  }}
                  className="w-full text-left p-2.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-200 border border-amber-500/30 flex items-start gap-3 transition-colors group cursor-pointer"
                >
                  <div className="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 shrink-0 group-hover:scale-105 transition-transform">
                    <Crown className="w-4 h-4 fill-current" />
                  </div>
                  <div>
                    <div className="font-bold text-amber-300 flex items-center gap-1.5">
                      <span>Admin Console</span>
                      <span className="text-[9px] px-1.5 py-0.2 rounded bg-amber-500/30 text-amber-200 font-mono font-bold">
                        ROOT
                      </span>
                    </div>
                    <span className="text-[11px] text-amber-200/70 block mt-0.5">
                      User directory, balances & platform stats
                    </span>
                  </div>
                </button>
              )}

              {/* 7. Auth Action in Menu */}
              <div className="pt-1 mt-1 border-t border-slate-800/80">
                {authUser ? (
                  <button
                    onClick={() => {
                      setIsMenuOpen(false);
                      onLogout();
                    }}
                    className="w-full text-left p-2 rounded-lg hover:bg-rose-950/30 text-rose-300 flex items-center gap-2.5 transition-colors cursor-pointer"
                  >
                    <LogOut className="w-3.5 h-3.5 text-rose-400" />
                    <span className="font-semibold text-xs">Log Out ({authUser.email.split('@')[0]})</span>
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      setIsMenuOpen(false);
                      onOpenLogin();
                    }}
                    className="w-full text-left p-2 rounded-lg hover:bg-cyan-950/30 text-cyan-300 flex items-center gap-2.5 transition-colors cursor-pointer"
                  >
                    <LogIn className="w-3.5 h-3.5 text-cyan-400" />
                    <span className="font-semibold text-xs">Sign In / Register</span>
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
