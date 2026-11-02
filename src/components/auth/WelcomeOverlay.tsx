import React from 'react';
import {
  ShieldCheck,
  TrendingUp,
  Sparkles,
  ArrowRight,
  UserPlus,
  LogIn,
  Eye,
  Lock,
} from 'lucide-react';

interface WelcomeOverlayProps {
  onOpenRegister: () => void;
  onOpenLogin: () => void;
  onExploreDemo: () => void;
}

export const WelcomeOverlay: React.FC<WelcomeOverlayProps> = ({
  onOpenRegister,
  onOpenLogin,
  onExploreDemo,
}) => {
  return (
    <div className="fixed inset-0 z-40 bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-[#090D16] border border-slate-800 rounded-2xl w-full max-w-lg p-6 sm:p-8 shadow-2xl space-y-6 text-center select-none animate-in fade-in zoom-in-95 duration-200">
        {/* Brand Icon & Heading */}
        <div className="space-y-3">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-tr from-cyan-600/30 to-emerald-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-400 font-black text-2xl shadow-xl shadow-cyan-950/40">
            D
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-black tracking-tight text-slate-100 uppercase">
              DEV<span className="text-cyan-400">OPTIONS</span>
            </h1>
            <p className="text-xs text-slate-400 max-w-sm mx-auto mt-1 leading-relaxed">
              Precision binary options execution, real tick analytics, and quantitative automation.
            </p>
          </div>
        </div>

        {/* Feature Highlights Grid */}
        <div className="grid grid-cols-3 gap-2.5 text-left">
          <div className="p-2.5 rounded-xl bg-slate-900/60 border border-slate-800 space-y-1">
            <TrendingUp className="w-4 h-4 text-emerald-400" />
            <div className="text-[11px] font-bold text-slate-200">Real Ticks</div>
            <p className="text-[9.5px] text-slate-500 leading-tight">Live tick streams and digit analysis.</p>
          </div>

          <div className="p-2.5 rounded-xl bg-slate-900/60 border border-slate-800 space-y-1">
            <Sparkles className="w-4 h-4 text-cyan-400" />
            <div className="text-[11px] font-bold text-slate-200">AI Scanner</div>
            <p className="text-[9.5px] text-slate-500 leading-tight">Fast probability calculation &amp; strategy setup.</p>
          </div>

          <div className="p-2.5 rounded-xl bg-slate-900/60 border border-slate-800 space-y-1">
            <ShieldCheck className="w-4 h-4 text-purple-400" />
            <div className="text-[11px] font-bold text-slate-200">Risk Guard</div>
            <p className="text-[9.5px] text-slate-500 leading-tight">Strict stop-loss limits &amp; emergency halt.</p>
          </div>
        </div>

        {/* Primary Action Buttons: Create Account & Log In */}
        <div className="space-y-2.5 pt-1">
          <button
            onClick={onOpenRegister}
            className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-gradient-to-r from-cyan-600 to-emerald-500 hover:from-cyan-500 hover:to-emerald-400 text-slate-950 font-black text-xs uppercase tracking-wider transition-all shadow-lg shadow-cyan-950/40 cursor-pointer"
          >
            <UserPlus className="w-4 h-4" />
            <span>Create Account</span>
          </button>

          <button
            onClick={onOpenLogin}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700 font-bold text-xs uppercase tracking-wider transition-colors cursor-pointer"
          >
            <LogIn className="w-4 h-4 text-cyan-400" />
            <span>Log In</span>
          </button>
        </div>

        {/* Demo Preview link */}
        <div className="pt-2 border-t border-slate-800/80">
          <button
            onClick={onExploreDemo}
            className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-cyan-300 font-mono transition-colors cursor-pointer"
          >
            <Eye className="w-3.5 h-3.5 text-slate-500" />
            <span>Explore Demo Preview (No Real Account)</span>
            <ArrowRight className="w-3 h-3 text-slate-500" />
          </button>
        </div>
      </div>
    </div>
  );
};
