import React, { useState } from 'react';
import {
  X,
  Radio,
  Sliders,
  CheckCircle2,
  AlertTriangle,
  Server,
  Zap,
  ShieldCheck,
  RefreshCw,
  Info,
} from 'lucide-react';
import { UserProfile } from '../../types/trading';
import { marketDataProvider } from '../../services/marketDataProvider';
import { storage } from '../../services/storage';
import { useToast } from '../common/ToastNotification';

interface ProviderSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  profile: UserProfile;
  onProfileUpdate: (updated: UserProfile) => void;
  isWsConnected: boolean;
  dataSource: 'live' | 'demo';
  latencyMs: number;
}

export const ProviderSettingsModal: React.FC<ProviderSettingsModalProps> = ({
  isOpen,
  onClose,
  profile,
  onProfileUpdate,
  isWsConnected,
  dataSource,
  latencyMs,
}) => {
  const { showToast } = useToast();

  const currentConfig = marketDataProvider.getProviderConfig();
  const [providerType, setProviderType] = useState<'demo' | 'custom_ws'>(
    currentConfig.providerType || 'demo'
  );
  const [customWsUrl, setCustomWsUrl] = useState<string>(
    currentConfig.customWsUrl || ''
  );
  const [executionMode, setExecutionMode] = useState<'simulated' | 'external_api'>('simulated');
  const [customExecEndpoint, setCustomExecEndpoint] = useState<string>('');
  const [customApiKey, setCustomApiKey] = useState<string>('');

  if (!isOpen) return null;

  const handleSaveConfiguration = () => {
    marketDataProvider.configureProvider({
      providerType,
      customWsUrl: customWsUrl.trim() || undefined,
    });

    const isCustomRealConfigured = executionMode === 'external_api' && customExecEndpoint.trim().length > 5;
    const updated: UserProfile = {
      ...profile,
      marketDataProviderId: providerType,
      marketDataEndpoint: customWsUrl.trim(),
      executionProviderId: executionMode,
      isRealAuthorized: isCustomRealConfigured,
    };

    storage.saveUserProfile(updated);
    onProfileUpdate(updated);

    showToast(
      'success',
      'Provider Settings Updated',
      providerType === 'demo'
        ? 'Active Market Data Source: DevOptions Market Feed'
        : `Connecting to ${customWsUrl}`
    );
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-[#090D16] border border-slate-800 rounded-2xl w-full max-w-xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/60">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
              <Server className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-100">
                Data Feed & Execution Gateway
              </h2>
              <p className="text-[11px] text-slate-400">
                Configure provider-independent market data feeds and trading gateways
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-100 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-5 overflow-y-auto text-xs">
          {/* Active Status Ribbon */}
          <div className="p-3 bg-slate-950/70 rounded-xl border border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <Radio
                className={`w-4 h-4 ${
                  isWsConnected ? 'text-emerald-400' : 'text-amber-400'
                }`}
              />
              <div>
                <span className="font-bold text-slate-200 block text-xs">
                  {dataSource === 'live' ? 'Connected to External Feed' : 'DevOptions Demo Feed Active'}
                </span>
                <span className="text-[10px] text-slate-500 font-mono">
                  Latency: {latencyMs}ms • High-Fidelity Tick Continuity
                </span>
              </div>
            </div>

            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 uppercase">
              {dataSource === 'live' ? 'Live Data' : 'Demo Stream'}
            </span>
          </div>

          {/* Section 1: Market Data Provider */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-mono text-slate-300 font-bold uppercase text-[11px] flex items-center gap-1.5">
                <Radio className="w-3.5 h-3.5 text-cyan-400" />
                <span>1. Market Data Feed Provider</span>
              </span>
              <span className="text-[10px] text-slate-500">Read-Only Telemetry</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {/* Option A: Demo Synthetic Feed (Default) */}
              <div
                onClick={() => setProviderType('demo')}
                className={`p-3 rounded-xl border cursor-pointer transition-all ${
                  providerType === 'demo'
                    ? 'bg-cyan-950/30 border-cyan-400 shadow-sm'
                    : 'bg-slate-900/50 border-slate-800 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between pb-1">
                  <span className="font-bold text-slate-200">Algorithmic Tick Feed</span>
                  <span
                    className={`w-3 h-3 rounded-full border-2 ${
                      providerType === 'demo' ? 'border-cyan-400 bg-cyan-400' : 'border-slate-600'
                    }`}
                  />
                </div>
                <p className="text-[10px] text-slate-400 leading-relaxed">
                  Autonomous high-precision synthetic market data feed with continuous Brownian motion and sub-second tick resolution.
                </p>
              </div>

              {/* Option B: Custom WebSocket Gateway */}
              <div
                onClick={() => setProviderType('custom_ws')}
                className={`p-3 rounded-xl border cursor-pointer transition-all ${
                  providerType === 'custom_ws'
                    ? 'bg-cyan-950/30 border-cyan-400 shadow-sm'
                    : 'bg-slate-900/50 border-slate-800 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between pb-1">
                  <span className="font-bold text-slate-200">Custom WebSocket Stream</span>
                  <span
                    className={`w-3 h-3 rounded-full border-2 ${
                      providerType === 'custom_ws' ? 'border-cyan-400 bg-cyan-400' : 'border-slate-600'
                    }`}
                  />
                </div>
                <p className="text-[10px] text-slate-400 leading-relaxed">
                  Connect to a custom compatible WebSocket price endpoint configured by the platform operator.
                </p>
              </div>
            </div>

            {providerType === 'custom_ws' && (
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-1.5 animate-in fade-in">
                <label className="text-[10px] font-mono text-slate-400 uppercase">
                  WebSocket Endpoint URL (wss://)
                </label>
                <input
                  type="text"
                  value={customWsUrl}
                  onChange={(e) => setCustomWsUrl(e.target.value)}
                  placeholder="wss://market-data.example.com/ticks"
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-slate-100 font-mono text-xs focus:border-cyan-500 focus:outline-none"
                />
              </div>
            )}
          </div>

          {/* Section 2: Trade Execution Gateway */}
          <div className="space-y-3 pt-2 border-t border-slate-800">
            <div className="flex items-center justify-between">
              <span className="font-mono text-slate-300 font-bold uppercase text-[11px] flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5 text-emerald-400" />
                <span>2. Trade Execution Gateway</span>
              </span>
              <span className="text-[10px] text-slate-500">Order Routing & Settlement</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {/* Option A: Practice Execution */}
              <div
                onClick={() => setExecutionMode('simulated')}
                className={`p-3 rounded-xl border cursor-pointer transition-all ${
                  executionMode === 'simulated'
                    ? 'bg-emerald-950/30 border-emerald-400 shadow-sm'
                    : 'bg-slate-900/50 border-slate-800 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between pb-1">
                  <span className="font-bold text-slate-200">Practice Execution Engine</span>
                  <span
                    className={`w-3 h-3 rounded-full border-2 ${
                      executionMode === 'simulated' ? 'border-emerald-400 bg-emerald-400' : 'border-slate-600'
                    }`}
                  />
                </div>
                <p className="text-[10px] text-slate-400 leading-relaxed">
                  Practice trading execution engine with zero financial risk. Standard safe environment for algorithmic testing.
                </p>
              </div>

              {/* Option B: External API Gateway */}
              <div
                onClick={() => setExecutionMode('external_api')}
                className={`p-3 rounded-xl border cursor-pointer transition-all ${
                  executionMode === 'external_api'
                    ? 'bg-emerald-950/30 border-emerald-400 shadow-sm'
                    : 'bg-slate-900/50 border-slate-800 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between pb-1">
                  <span className="font-bold text-slate-200">External Execution Webhook</span>
                  <span
                    className={`w-3 h-3 rounded-full border-2 ${
                      executionMode === 'external_api' ? 'border-emerald-400 bg-emerald-400' : 'border-slate-600'
                    }`}
                  />
                </div>
                <p className="text-[10px] text-slate-400 leading-relaxed">
                  Requires authorized server-side execution gateway credentials configured by the administrator.
                </p>
              </div>
            </div>

            {executionMode === 'external_api' && (
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-2 animate-in fade-in">
                <div className="space-y-1">
                  <label className="text-[10px] font-mono text-slate-400 uppercase">
                    Execution Endpoint URL
                  </label>
                  <input
                    type="text"
                    value={customExecEndpoint}
                    onChange={(e) => setCustomExecEndpoint(e.target.value)}
                    placeholder="https://api.execution-gateway.com/v1/orders"
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-slate-100 font-mono text-xs focus:border-cyan-500 focus:outline-none"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-mono text-slate-400 uppercase">
                    API Authorization Key
                  </label>
                  <input
                    type="password"
                    value={customApiKey}
                    onChange={(e) => setCustomApiKey(e.target.value)}
                    placeholder="••••••••••••••••"
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-slate-100 font-mono text-xs focus:border-cyan-500 focus:outline-none"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Separation Notice */}
          <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 text-[11px] text-slate-400 flex items-start gap-2">
            <Info className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
            <p>
              Market data telemetry is strictly decoupled from financial transaction execution. Viewing live market telemetry does not place financial capital at risk.
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-slate-400 hover:text-slate-200 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSaveConfiguration}
              className="px-5 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs transition-colors shadow-lg shadow-cyan-500/20"
            >
              Save Configuration
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export const DerivConnectionModal = ProviderSettingsModal;
