import React, { useState } from 'react';
import { UserProfile } from '../../types/trading';
import { AuthUser } from '../../services/authClient';
import { storage } from '../../services/storage';
import { useToast } from '../common/ToastNotification';
import {
  X,
  User,
  Mail,
  Phone,
  ShieldCheck,
  RotateCcw,
  Volume2,
  VolumeX,
  Zap,
  CheckCircle2,
  DollarSign,
  LogOut,
  Sliders,
  AlertCircle,
  LogIn,
  Crown,
} from 'lucide-react';

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  profile: UserProfile;
  onProfileUpdate: (updated: UserProfile) => void;
  tradingMode: 'demo' | 'real';
  authUser: AuthUser | null;
  onOpenAuth: (mode: 'login' | 'register' | 'verify') => void;
  onLogout: () => void;
  onOpenAdmin?: () => void;
}

export const ProfileModal: React.FC<ProfileModalProps> = ({
  isOpen,
  onClose,
  profile,
  onProfileUpdate,
  tradingMode,
  authUser,
  onOpenAuth,
  onLogout,
  onOpenAdmin,
}) => {
  const { showToast } = useToast();

  const [name, setName] = useState<string>(authUser?.fullName || profile.name || 'Trader');
  const [email, setEmail] = useState<string>(authUser?.email || profile.email || 'trader@devoptions.io');
  const [soundEnabled, setSoundEnabled] = useState<boolean>(profile.soundEnabled ?? true);
  const [fastExecution, setFastExecution] = useState<boolean>(profile.fastExecution ?? true);
  const [isSaved, setIsSaved] = useState<boolean>(false);

  if (!isOpen) return null;

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const updated: UserProfile = {
      ...profile,
      name,
      email,
      soundEnabled,
      fastExecution,
    };
    storage.saveUserProfile(updated);
    onProfileUpdate(updated);
    setIsSaved(true);
    showToast('success', 'Profile Updated', 'Your account settings were successfully saved.');
    setTimeout(() => setIsSaved(false), 2000);
  };

  const handleResetDemo = () => {
    const updated = storage.resetDemoBalance(10000.0);
    onProfileUpdate(updated);
    showToast('info', 'Demo Balance Reset', 'Virtual balance restored to $10,000.00 USD.');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-[#090D16] border border-slate-800 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden text-slate-200">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/60">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
              <User className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100">User Profile &amp; Account</h2>
              <p className="text-[11px] text-slate-400">
                Manage personal credentials, contact verification, and trading preferences
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-100 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4 text-xs overflow-y-auto max-h-[80vh]">
          {/* Account Status / Auth Bar */}
          {authUser ? (
            <div className="p-3 bg-slate-950/70 rounded-xl border border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[10px] text-slate-500 uppercase font-mono block">
                    {authUser.role === 'admin' ? 'Administrator Account' : 'Registered Trader Account'}
                  </span>
                  <div className="font-bold text-slate-100 text-sm mt-0.5 flex items-center gap-2">
                    <span>{authUser.email}</span>
                    {authUser.role === 'admin' && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[9px] font-mono font-bold">
                        <Crown className="w-3 h-3 fill-current" /> ADMIN
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-slate-500 uppercase font-mono block">
                    Mode
                  </span>
                  <span className="font-mono text-xs uppercase px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800 font-bold">
                    {tradingMode.toUpperCase()}
                  </span>
                </div>
              </div>

              {authUser.role === 'admin' && (
                <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-between">
                  <div>
                    <span className="text-[10px] text-amber-300 font-bold font-mono uppercase block">System Administration Privileges</span>
                    <span className="text-[11px] text-amber-200/80">You have full root access to users, balances, and system logs.</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      if (onOpenAdmin) onOpenAdmin();
                    }}
                    className="px-2.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs uppercase font-mono transition-colors cursor-pointer"
                  >
                    Open Console
                  </button>
                </div>
              )}

              {/* Verification Pills */}
              <div className="grid grid-cols-2 gap-2 pt-1">
                {/* Email Verification */}
                <div className="p-2 rounded-lg bg-slate-900/80 border border-slate-800 flex items-center justify-between">
                  <div>
                    <span className="text-[9px] text-slate-500 block uppercase font-mono">Email Status</span>
                    <span className="text-[11px] font-bold text-slate-200 truncate block">
                      {authUser.emailVerified ? (
                        <span className="text-emerald-400 flex items-center gap-1 font-mono text-[10px]">
                          <CheckCircle2 className="w-3 h-3" /> VERIFIED
                        </span>
                      ) : (
                        <span className="text-amber-400 font-mono text-[10px]">PENDING</span>
                      )}
                    </span>
                  </div>
                  {!authUser.emailVerified && (
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onOpenAuth('verify');
                      }}
                      className="px-2 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 font-mono text-[9px] uppercase font-bold cursor-pointer"
                    >
                      Verify
                    </button>
                  )}
                </div>

                {/* Phone Verification */}
                <div className="p-2 rounded-lg bg-slate-900/80 border border-slate-800 flex items-center justify-between">
                  <div>
                    <span className="text-[9px] text-slate-500 block uppercase font-mono">Phone Status</span>
                    <span className="text-[11px] font-bold text-slate-200 truncate block font-mono">
                      {authUser.phoneVerified ? (
                        <span className="text-emerald-400 flex items-center gap-1 font-mono text-[10px]">
                          <CheckCircle2 className="w-3 h-3" /> VERIFIED
                        </span>
                      ) : (
                        <span className="text-amber-400 font-mono text-[10px]">PENDING</span>
                      )}
                    </span>
                  </div>
                  {!authUser.phoneVerified && (
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onOpenAuth('verify');
                      }}
                      className="px-2 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 font-mono text-[9px] uppercase font-bold cursor-pointer"
                    >
                      Verify
                    </button>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="p-3.5 bg-cyan-950/20 border border-cyan-800/40 rounded-xl space-y-2">
              <div className="flex items-center gap-2 text-cyan-300 font-bold text-xs uppercase font-mono">
                <AlertCircle className="w-4 h-4 text-cyan-400 shrink-0" />
                <span>Demo Guest Session</span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                You are currently exploring in demo mode. Create an independent trader account or sign in to save your custom strategies, positions, and preferences securely.
              </p>
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenAuth('register');
                  }}
                  className="px-3 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs uppercase cursor-pointer"
                >
                  Create Account
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenAuth('login');
                  }}
                  className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 hover:bg-slate-800 text-slate-200 font-bold text-xs uppercase cursor-pointer"
                >
                  Log In
                </button>
              </div>
            </div>
          )}

          {/* Balances Overview */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-slate-900/60 p-3 rounded-xl border border-slate-800 space-y-0.5">
              <span className="text-[10px] text-slate-400 uppercase font-mono">Demo Balance</span>
              <div className="text-sm sm:text-base font-bold font-mono text-cyan-300">
                ${profile.demoBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </div>
            </div>
            <div className="bg-slate-900/60 p-3 rounded-xl border border-slate-800 space-y-0.5">
              <span className="text-[10px] text-slate-400 uppercase font-mono">Real Balance</span>
              <div className="text-sm sm:text-base font-bold font-mono text-emerald-400">
                ${profile.realBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </div>
            </div>
          </div>

          {/* Form Preferences */}
          <form onSubmit={handleSave} className="space-y-3.5">
            <div className="space-y-1">
              <label className="text-slate-300 font-semibold text-[11px]">Display Name</label>
              <div className="relative">
                <User className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-slate-100 font-medium focus:border-cyan-500 focus:outline-none"
                  placeholder="Your Name"
                />
              </div>
            </div>

            {/* Preferences Toggles */}
            <div className="space-y-2 pt-1 border-t border-slate-800">
              <span className="text-[11px] font-semibold text-slate-400 uppercase font-mono block">
                Terminal Preferences
              </span>

              <div className="flex items-center justify-between p-2.5 bg-slate-950/60 rounded-xl border border-slate-800/80">
                <div className="flex items-center gap-2">
                  {soundEnabled ? (
                    <Volume2 className="w-4 h-4 text-cyan-400" />
                  ) : (
                    <VolumeX className="w-4 h-4 text-slate-500" />
                  )}
                  <div>
                    <span className="font-semibold text-slate-200 block">Synthesized Audio Cues</span>
                    <span className="text-[10px] text-slate-500">
                      Audio effects for trade results and alerts
                    </span>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={soundEnabled}
                  onChange={(e) => setSoundEnabled(e.target.checked)}
                  className="w-4 h-4 accent-cyan-500 cursor-pointer"
                />
              </div>

              <div className="flex items-center justify-between p-2.5 bg-slate-950/60 rounded-xl border border-slate-800/80">
                <div className="flex items-center gap-2">
                  <Zap className="w-4 h-4 text-emerald-400" />
                  <div>
                    <span className="font-semibold text-slate-200 block">Fast 1-Click Order Execution</span>
                    <span className="text-[10px] text-slate-500">
                      Immediate order submission on Rise/Fall click
                    </span>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={fastExecution}
                  onChange={(e) => setFastExecution(e.target.checked)}
                  className="w-4 h-4 accent-cyan-500 cursor-pointer"
                />
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-between pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={handleResetDemo}
                className="text-cyan-400 hover:text-cyan-300 font-mono text-[11px] flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset Demo Balance</span>
              </button>

              <div className="flex items-center gap-2">
                {authUser && (
                  <button
                    type="button"
                    onClick={() => {
                      onLogout();
                      onClose();
                    }}
                    className="px-3 py-2 rounded-xl text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors flex items-center gap-1.5 font-medium cursor-pointer"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Log Out</span>
                  </button>
                )}

                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs transition-colors shadow-lg shadow-cyan-500/20 cursor-pointer"
                >
                  Save Settings
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
