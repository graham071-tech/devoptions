import React, { useState, useRef } from 'react';
import { PageId, UserProfile } from '../../types/trading';
import { storage } from '../../services/storage';
import { derivWsService } from '../../services/derivWs';
import { audioEffects } from '../../services/audioEffects';
import { useToast } from '../common/ToastNotification';
import {
  Settings,
  User,
  Sliders,
  Radio,
  KeyRound,
  Download,
  Upload,
  RotateCcw,
  Volume2,
  VolumeX,
  ShieldAlert,
  CheckCircle2,
} from 'lucide-react';

interface SettingsPageProps {
  profile: UserProfile;
  onUpdateProfile: (p: UserProfile) => void;
  onNavigate: (page: PageId) => void;
  isWsConnected: boolean;
  dataSource: 'live' | 'simulated';
  latencyMs: number;
}

export const SettingsPage: React.FC<SettingsPageProps> = ({
  profile,
  onUpdateProfile,
  onNavigate,
  isWsConnected,
  dataSource,
  latencyMs,
}) => {
  const { showToast } = useToast();

  const [formProfile, setFormProfile] = useState<UserProfile>({ ...profile });
  const [isSaved, setIsSaved] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSavePreferences = () => {
    storage.saveUserProfile(formProfile);
    onUpdateProfile(formProfile);
    audioEffects.setEnabled(formProfile.soundEnabled);
    audioEffects.playTradePlaced();
    setIsSaved(true);
    showToast('success', 'Preferences Saved', 'Application settings updated.');
    setTimeout(() => setIsSaved(false), 2000);
  };

  const handleExportBackup = () => {
    const backupJson = storage.exportBackup();
    const blob = new Blob([backupJson], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `stratum_backup_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('success', 'Backup Exported', 'Downloaded complete configuration and history.');
  };

  const handleImportBackup = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const ok = storage.importBackup(event.target?.result as string);
      if (ok) {
        const refreshed = storage.getUserProfile();
        setFormProfile(refreshed);
        onUpdateProfile(refreshed);
        showToast('success', 'Backup Restored', 'Restored profiles, strategies, and trade logs.');
      } else {
        showToast('error', 'Restore Failed', 'Invalid backup file structure.');
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleResetBalance = () => {
    const updated = storage.resetDemoBalance(10000.0);
    setFormProfile(updated);
    onUpdateProfile(updated);
    showToast('success', 'Balance Restored', 'Virtual demo funds reset to $10,000.00 USD.');
  };

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2.5">
            <Settings className="w-5 h-5 text-cyan-400" />
            <h2 className="text-xl font-bold tracking-tight text-slate-100">
              Terminal Preferences & Gateway Configuration
            </h2>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Manage your account parameters, audio cues, Deriv API token, and persistent system backups
          </p>
        </div>

        <button
          onClick={handleSavePreferences}
          className="flex items-center gap-1.5 px-4 py-2 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold rounded-lg text-xs transition-colors shadow-sm"
        >
          {isSaved ? <CheckCircle2 className="w-4 h-4" /> : null}
          <span>{isSaved ? 'Saved!' : 'Save Changes'}</span>
        </button>
      </div>

      <div className="space-y-6">
        {/* User Profile Section */}
        <div className="bg-[#090D16] border border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-2 pb-2 border-b border-slate-800">
            <User className="w-4 h-4 text-cyan-400" />
            <h3 className="font-semibold text-slate-200 text-xs uppercase tracking-wider">
              Trader Profile
            </h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="text-slate-400 block font-medium mb-1">Display Name</label>
              <input
                type="text"
                value={formProfile.name}
                onChange={(e) => setFormProfile({ ...formProfile, name: e.target.value })}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 text-xs focus:outline-none focus:border-cyan-500"
              />
            </div>
            <div>
              <label className="text-slate-400 block font-medium mb-1">Base Currency</label>
              <select
                value={formProfile.currency}
                onChange={(e) => setFormProfile({ ...formProfile, currency: e.target.value })}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 text-xs focus:outline-none focus:border-cyan-500 font-mono"
              >
                <option value="USD">USD ($)</option>
                <option value="EUR">EUR (€)</option>
                <option value="GBP">GBP (£)</option>
              </select>
            </div>
          </div>
        </div>

        {/* Audio & Visual Preferences */}
        <div className="bg-[#090D16] border border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-2 pb-2 border-b border-slate-800">
            <Sliders className="w-4 h-4 text-cyan-400" />
            <h3 className="font-semibold text-slate-200 text-xs uppercase tracking-wider">
              Terminal Experience & Audio
            </h3>
          </div>

          <div className="space-y-3 text-xs">
            <div className="flex items-center justify-between p-3 bg-slate-900/60 rounded-lg border border-slate-800">
              <div className="space-y-0.5">
                <span className="font-medium text-slate-200">Synthesized Web Audio Cues</span>
                <p className="text-[11px] text-slate-400">
                  Plays harmonic chimes and ticks for orders, winning settlements, and alerts
                </p>
              </div>
              <button
                onClick={() => {
                  const updated = !formProfile.soundEnabled;
                  setFormProfile({ ...formProfile, soundEnabled: updated });
                  audioEffects.setEnabled(updated);
                  if (updated) audioEffects.playWin();
                }}
                className={`p-2 rounded-lg border transition-colors ${
                  formProfile.soundEnabled
                    ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-300'
                    : 'bg-slate-800 border-slate-700 text-slate-400'
                }`}
              >
                {formProfile.soundEnabled ? (
                  <Volume2 className="w-4 h-4" />
                ) : (
                  <VolumeX className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Deriv Gateway Configuration */}
        <div className="bg-[#090D16] border border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <Radio className="w-4 h-4 text-cyan-400" />
              <h3 className="font-semibold text-slate-200 text-xs uppercase tracking-wider">
                Deriv API Gateway & Real Account
              </h3>
            </div>
            <span
              className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded border ${
                dataSource === 'live' && isWsConnected
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                  : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
              }`}
            >
              {dataSource === 'live' && isWsConnected ? 'WebSocket Active' : 'Offline/Simulated'}
            </span>
          </div>

          <div className="space-y-3 text-xs">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-slate-400 block font-medium mb-1">
                  Deriv Application ID (App ID)
                </label>
                <input
                  type="text"
                  value={formProfile.derivAppId}
                  onChange={(e) =>
                    setFormProfile({ ...formProfile, derivAppId: e.target.value })
                  }
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 font-mono text-xs focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="text-slate-400 block font-medium mb-1">
                  Deriv API Token (Optional)
                </label>
                <input
                  type="password"
                  value={formProfile.derivToken}
                  placeholder="Enter API token for live account sync"
                  onChange={(e) =>
                    setFormProfile({ ...formProfile, derivToken: e.target.value })
                  }
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-slate-100 font-mono text-xs focus:outline-none focus:border-cyan-500"
                />
              </div>
            </div>

            <div className="p-3 bg-slate-900/60 rounded-lg border border-slate-800 flex items-center justify-between text-xs">
              <div>
                <span className="text-slate-400 block">Gateway Latency</span>
                <span className="font-mono text-slate-200 font-bold">{latencyMs} ms roundtrip</span>
              </div>
              <button
                onClick={() => derivWsService.reconnect()}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-md font-medium transition-colors"
              >
                Ping Test
              </button>
            </div>
          </div>
        </div>

        {/* Data Management & Backup */}
        <div className="bg-[#090D16] border border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-2 pb-2 border-b border-slate-800">
            <Download className="w-4 h-4 text-cyan-400" />
            <h3 className="font-semibold text-slate-200 text-xs uppercase tracking-wider">
              Data Management & Local Persistence
            </h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <button
              onClick={handleExportBackup}
              className="flex items-center justify-center gap-2 p-3 bg-slate-900 hover:bg-slate-850 border border-slate-800 rounded-lg font-semibold text-slate-200 transition-colors"
            >
              <Download className="w-4 h-4 text-cyan-400" />
              <span>Export Full Backup</span>
            </button>

            <label className="flex items-center justify-center gap-2 p-3 bg-slate-900 hover:bg-slate-850 border border-slate-800 rounded-lg font-semibold text-slate-200 cursor-pointer transition-colors">
              <Upload className="w-4 h-4 text-indigo-400" />
              <span>Restore Backup</span>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                onChange={handleImportBackup}
                className="hidden"
              />
            </label>

            <button
              onClick={handleResetBalance}
              className="flex items-center justify-center gap-2 p-3 bg-slate-900 hover:bg-slate-850 border border-slate-800 rounded-lg font-semibold text-slate-200 transition-colors"
            >
              <RotateCcw className="w-4 h-4 text-amber-400" />
              <span>Reset Demo Balance</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
