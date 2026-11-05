import React, { useState } from 'react';
import { PageId, UserProfile } from '../../types/trading';
import { storage } from '../../services/storage';
import { useToast } from '../common/ToastNotification';
import {
  User,
  Shield,
  RotateCcw,
  PlusCircle,
  KeyRound,
  DollarSign,
  TrendingUp,
  CreditCard,
  ArrowRight,
  ShieldCheck,
} from 'lucide-react';

interface AccountPageProps {
  profile: UserProfile;
  onUpdateProfile: (p: UserProfile) => void;
  onNavigate: (page: PageId) => void;
  onOpenDerivModal: () => void;
  tradingMode: 'demo' | 'real';
}

export const AccountPage: React.FC<AccountPageProps> = ({
  profile,
  onUpdateProfile,
  onNavigate,
  onOpenDerivModal,
  tradingMode,
}) => {
  const { showToast } = useToast();
  const [topUpAmount, setTopUpAmount] = useState<number>(1000);

  const handleResetDemo = () => {
    const updated = storage.resetDemoBalance(10000.0);
    onUpdateProfile(updated);
    showToast('success', 'Demo Balance Reset', 'Virtual balance restored to $10,000.00 USD.');
  };

  const handleAddDemoFunds = () => {
    if (topUpAmount <= 0) return;
    const newBal = Number((profile.demoBalance + topUpAmount).toFixed(2));
    const updated = { ...profile, demoBalance: newBal };
    storage.saveUserProfile(updated);
    onUpdateProfile(updated);
    showToast('success', 'Funds Added', `Added $${topUpAmount} USD to demo account.`);
  };

  const trades = storage.getTradeHistory();
  const wins = trades.filter((t) => t.status === 'won').length;
  const losses = trades.filter((t) => t.status === 'lost').length;
  const netPnl = trades.reduce((sum, t) => sum + (t.profitLoss || 0), 0);
  const winRate = trades.length > 0 ? ((wins / trades.length) * 100).toFixed(1) : '0.0';

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2.5">
            <User className="w-5 h-5 text-cyan-400" />
            <h2 className="text-xl font-bold tracking-tight text-slate-100">
              Account Management & Balance Gateway
            </h2>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Overview of practice demo funds, real account gateway, and lifetime metrics
          </p>
        </div>
      </div>

      {/* Account Balance Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Demo Account Box */}
        <div className="bg-[#090D16] border border-cyan-500/30 rounded-xl p-5 space-y-4 shadow-xl">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-cyan-400">
              Practice Demo Balance
            </span>
            <span className="text-[10px] px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-300 font-mono font-bold">
              ACTIVE DEMO
            </span>
          </div>

          <div>
            <span className="text-xs text-slate-400">Available Practice Balance</span>
            <p className="font-mono text-3xl font-bold text-slate-100 mt-1 tabular-nums">
              ${profile.demoBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
              <span className="text-sm font-normal text-slate-400">{profile.currency}</span>
            </p>
          </div>

          <div className="flex items-center gap-2 pt-2 border-t border-slate-800">
            <button
              onClick={handleResetDemo}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold transition-colors border border-slate-700"
            >
              <RotateCcw className="w-3.5 h-3.5 text-cyan-400" />
              <span>Reset to $10,000</span>
            </button>

            <button
              onClick={handleAddDemoFunds}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 bg-cyan-500 hover:bg-cyan-400 text-slate-950 rounded-lg text-xs font-bold transition-colors shadow-sm"
            >
              <PlusCircle className="w-3.5 h-3.5" />
              <span>Add +$1,000 Funds</span>
            </button>
          </div>
        </div>

        {/* Real Deriv Account Box */}
        <div className="bg-[#090D16] border border-slate-800 rounded-xl p-5 space-y-4 shadow-xl">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Deriv Real Money Gateway
            </span>
            <span
              className={`text-[10px] px-2 py-0.5 rounded font-mono font-bold ${
                profile.isRealAuthorized
                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                  : 'bg-slate-800 text-slate-400'
              }`}
            >
              {profile.isRealAuthorized ? 'CONNECTED' : 'STANDBY'}
            </span>
          </div>

          <div>
            <span className="text-xs text-slate-400">Live Account Balance</span>
            <p className="font-mono text-3xl font-bold text-slate-100 mt-1 tabular-nums">
              ${profile.realBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
              <span className="text-sm font-normal text-slate-400">{profile.currency}</span>
            </p>
          </div>

          <div className="pt-2 border-t border-slate-800">
            <button
              onClick={onOpenDerivModal}
              className="w-full flex items-center justify-center gap-2 py-2 px-3 bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded-lg text-xs font-semibold text-slate-200 transition-colors"
            >
              <KeyRound className="w-3.5 h-3.5 text-cyan-400" />
              <span>
                {profile.isRealAuthorized
                  ? 'Manage Deriv API Token'
                  : 'Connect Deriv Account Token'}
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* Lifetime Trading Metrics */}
      <div className="bg-[#090D16] border border-slate-800 rounded-xl p-5 space-y-4">
        <h3 className="font-semibold text-slate-200 text-xs uppercase tracking-wider pb-2 border-b border-slate-800">
          Lifetime Terminal Activity
        </h3>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs font-mono">
          <div className="p-3 bg-slate-900/60 rounded-lg border border-slate-800">
            <span className="text-slate-400 block font-sans text-[11px]">Total Contracts</span>
            <span className="text-xl font-bold text-slate-100 mt-1 block">{trades.length}</span>
          </div>

          <div className="p-3 bg-slate-900/60 rounded-lg border border-slate-800">
            <span className="text-slate-400 block font-sans text-[11px]">Win Rate</span>
            <span className="text-xl font-bold text-cyan-400 mt-1 block">{winRate}%</span>
          </div>

          <div className="p-3 bg-slate-900/60 rounded-lg border border-slate-800">
            <span className="text-slate-400 block font-sans text-[11px]">Wins / Losses</span>
            <span className="text-lg font-bold text-slate-200 mt-1 block">
              {wins}W / {losses}L
            </span>
          </div>

          <div className="p-3 bg-slate-900/60 rounded-lg border border-slate-800">
            <span className="text-slate-400 block font-sans text-[11px]">Cumulative Net P&L</span>
            <span
              className={`text-xl font-bold mt-1 block ${
                netPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {netPnl >= 0 ? '+' : ''}${netPnl.toFixed(2)}
            </span>
          </div>
        </div>
      </div>

      {/* Security & Verification Notice */}
      <div className="p-4 bg-slate-900/70 border border-slate-800 rounded-xl flex items-start gap-3 text-xs text-slate-300">
        <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <span className="font-semibold text-slate-100">Zero-Risk Development Environment</span>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            Stratum Binary Pro provides a client-side execution sandbox using authentic tick data from Deriv’s official WebSocket API. Real trading is kept behind explicit confirmation guards to protect users from accidental live transactions.
          </p>
        </div>
      </div>
    </div>
  );
};
