import React, { useState, useEffect, useRef } from 'react';
import { UserProfile } from '../../types/trading';
import { storage } from '../../services/storage';
import { audioEffects } from '../../services/audioEffects';
import { useToast } from '../common/ToastNotification';
import {
  paynectaClient,
  PaynectaConfigResponse,
  PaynectaDeposit,
} from '../../services/paynectaClient';
import { AuthUser, authClient } from '../../services/authClient';
import {
  X,
  CreditCard,
  Smartphone,
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
  RefreshCw,
  ArrowRight,
  ExternalLink,
  Clock,
  AlertTriangle,
  History,
  Copy,
  Check,
  HelpCircle,
  Lock,
} from 'lucide-react';

interface DepositModalProps {
  isOpen: boolean;
  onClose: () => void;
  profile: UserProfile;
  onProfileUpdate: (updated: UserProfile) => void;
  authUser?: AuthUser | null;
  onOpenAuth?: (mode: 'login' | 'register') => void;
}

export type DepositDisplayStatus =
  | 'ready_to_pay'
  | 'awaiting_payment'
  | 'verifying_payment'
  | 'succeeded'
  | 'cancelled'
  | 'failed'
  | 'verification_delayed';

export const DepositModal: React.FC<DepositModalProps> = ({
  isOpen,
  onClose,
  profile,
  onProfileUpdate,
  authUser,
  onOpenAuth,
}) => {
  const { showToast } = useToast();

  const [activeTab, setActiveTab] = useState<'deposit' | 'history'>('deposit');
  const [gatewayConfig, setGatewayConfig] = useState<PaynectaConfigResponse | null>(null);
  const [loadingConfig, setLoadingConfig] = useState<boolean>(true);

  // Form input in Kenyan Shillings (whole number) or USD equivalent
  const [selectedCurrency, setSelectedCurrency] = useState<'KES' | 'USD'>('KES');
  const [amountKesInput, setAmountKesInput] = useState<string>('650');
  const [amountUsdInput, setAmountUsdInput] = useState<string>('5');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [isVerifying, setIsVerifying] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [authErrorCode, setAuthErrorCode] = useState<string | null>(null);

  // Active / selected transaction state
  const [activeDeposit, setActiveDeposit] = useState<PaynectaDeposit | null>(null);
  const [displayStatus, setDisplayStatus] = useState<DepositDisplayStatus>('ready_to_pay');
  const [statusMessage, setStatusMessage] = useState<string>('');

  // User's past deposits
  const [pastDeposits, setPastDeposits] = useState<PaynectaDeposit[]>([]);
  const [copiedRef, setCopiedRef] = useState<string | null>(null);

  const pollTimerRef = useRef<any>(null);

  // Load gateway configuration and history when opened
  useEffect(() => {
    if (isOpen) {
      loadGatewayConfig();
      loadHistory();
    } else {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    }
  }, [isOpen]);

  const loadGatewayConfig = async () => {
    setLoadingConfig(true);
    try {
      const cfg = await paynectaClient.getConfig();
      setGatewayConfig(cfg);
      if (cfg.minDepositKes) {
        setAmountKesInput(String(cfg.minDepositKes));
      }
    } catch {
      // Fallback
      setGatewayConfig({
        configured: false,
        missingKeys: ['PAYNECTA_SECRET_KEY', 'PAYNECTA_TAPFLOW_ID'],
        currency: 'KES',
        kesPerUsd: 130.0,
        minDepositUsd: 5.0,
        minDepositKes: 650,
        tapFlowConfigured: false,
        liveNotice: 'Paynecta operates with live M-Pesa collections in whole Kenyan Shillings (KES).',
      });
    } finally {
      setLoadingConfig(false);
    }
  };

  const loadHistory = async () => {
    try {
      const history = await paynectaClient.getDepositHistory();
      setPastDeposits(history);

      // Check if there is an active pending deposit
      const pending = history.find((d) => d.status === 'pending');
      if (pending && !activeDeposit) {
        setActiveDeposit(pending);
        setDisplayStatus('awaiting_payment');
        setStatusMessage('Existing deposit awaiting confirmation.');
      }
    } catch (err) {
      console.warn('Could not load deposit history:', err);
    }
  };

  // Automated polling when in awaiting or verifying state
  useEffect(() => {
    if (
      activeDeposit &&
      (displayStatus === 'awaiting_payment' || displayStatus === 'verifying_payment')
    ) {
      pollTimerRef.current = setInterval(() => {
        handleCheckStatus(true);
      }, 6000);
    } else {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    }

    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [activeDeposit, displayStatus]);

  if (!isOpen) return null;

  const kesPerUsd = gatewayConfig?.kesPerUsd || 130.0;
  const minDepositKes = gatewayConfig?.minDepositKes || 650;
  const minDepositUsd = gatewayConfig?.minDepositUsd || 5.0;

  // Validation logic
  const parsedKes = Number(amountKesInput);
  const isFractional = !Number.isInteger(parsedKes) && !isNaN(parsedKes);
  const isBelowMin = parsedKes < minDepositKes;
  const isValidAmount = Number.isInteger(parsedKes) && parsedKes >= minDepositKes;
  const calculatedUsd = isValidAmount ? Number((parsedKes / kesPerUsd).toFixed(2)) : 0;

  // ─────────────────────────────────────────────────────────────
  // 1. CREATE CHECKOUT SESSION
  // ─────────────────────────────────────────────────────────────
  const handleCreateSession = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    setAuthErrorCode(null);

    // Pre-check authentication: verify user session exists before initiating request
    const isAuthed = Boolean(authUser || authClient.isAuthenticated());
    if (!isAuthed) {
      setErrorMessage('Please log in to continue.');
      setAuthErrorCode('AUTH_REQUIRED');
      showToast('error', 'Authentication Required', 'Please log in to your account to deposit funds.');
      return;
    }

    if (!amountKesInput || isNaN(parsedKes)) {
      setErrorMessage('Please enter a valid deposit amount in Kenyan Shillings (KES).');
      return;
    }

    if (isFractional) {
      setErrorMessage(
        'Paynecta requires whole Kenyan Shillings (KES). Fractional cents or decimals are not accepted. Please enter a whole integer.'
      );
      return;
    }

    if (isBelowMin) {
      setErrorMessage(
        `Minimum deposit is KES ${minDepositKes.toLocaleString()} (approx. $${minDepositUsd.toFixed(2)} USD).`
      );
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await paynectaClient.createDeposit(parsedKes);
      if (!res || !res.deposit || !res.deposit.id) {
        throw new Error(
          (res && (res as any).message) ||
          'Paynecta payment response was missing required deposit details.'
        );
      }
      const dep: PaynectaDeposit = {
        id: res.deposit.id,
        userId: profile.email,
        merchantReference: res.deposit.merchantReference || `DO-DEP-${Date.now()}`,
        amountKes: res.deposit.amountKes || parsedKes,
        amountSubunits: (res.deposit.amountKes || parsedKes) * 100,
        amountUsd: res.deposit.amountUsd || calculatedUsd,
        currency: 'KES',
        checkoutUrl: res.deposit.checkoutUrl,
        status: (res.deposit.status as any) || 'pending',
        createdAt: res.deposit.createdAt || Date.now(),
        updatedAt: res.deposit.createdAt || Date.now(),
      };

      setActiveDeposit(dep);
      setDisplayStatus('awaiting_payment');
      setStatusMessage('Paynecta checkout session initialized.');
      audioEffects.playClick();

      // Open Paynecta hosted checkout in a new window/tab safely
      if (res.deposit.checkoutUrl) {
        window.open(res.deposit.checkoutUrl, '_blank', 'noopener,noreferrer');
      }

      loadHistory();
    } catch (err: any) {
      const code = err.code || (err.status === 401 ? 'AUTH_REQUIRED' : null);
      setAuthErrorCode(code);
      setErrorMessage(err.message || 'Failed to create Paynecta payment session.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // ─────────────────────────────────────────────────────────────
  // 2. INDEPENDENT TRANSACTION VERIFICATION
  // ─────────────────────────────────────────────────────────────
  const handleCheckStatus = async (isBackgroundPoll = false) => {
    if (!activeDeposit) return;

    if (!isBackgroundPoll) {
      setIsVerifying(true);
      setDisplayStatus('verifying_payment');
    }

    try {
      const res = await paynectaClient.verifyDeposit(activeDeposit.id);
      setActiveDeposit(res.deposit);

      if (res.status === 'succeeded') {
        setDisplayStatus('succeeded');
        setStatusMessage(res.message);

        // Update real balance if provided
        if (typeof res.realBalance === 'number') {
          const updated = {
            ...profile,
            realBalance: res.realBalance,
          };
          storage.saveUserProfile(updated);
          onProfileUpdate(updated);
        } else {
          const updated = {
            ...profile,
            realBalance: Number((profile.realBalance + activeDeposit.amountUsd).toFixed(2)),
          };
          storage.saveUserProfile(updated);
          onProfileUpdate(updated);
        }

        audioEffects.playWin();
        showToast(
          'success',
          'Deposit Verified',
          `+$${activeDeposit.amountUsd.toFixed(2)} USD credited via Paynecta M-Pesa (${res.deposit.providerReference || res.deposit.merchantReference})`
        );
        loadHistory();
      } else if (res.status === 'failed') {
        setDisplayStatus('failed');
        setStatusMessage(res.deposit.failureReason || 'Payment failed or refused by network.');
        audioEffects.playLoss();
      } else if (res.status === 'cancelled') {
        setDisplayStatus('cancelled');
        setStatusMessage('Payment cancelled by user.');
      } else if (res.status === 'verification_delayed') {
        setDisplayStatus('verification_delayed');
        setStatusMessage('Verification delayed. Network settlement is still reconciling.');
      } else {
        setDisplayStatus('awaiting_payment');
        setStatusMessage('Awaiting customer PIN entry on mobile phone.');
      }
    } catch (err: any) {
      if (!isBackgroundPoll) {
        showToast('error', 'Status Verification', err.message || 'Could not verify status');
      }
    } finally {
      setIsVerifying(false);
    }
  };

  // ─────────────────────────────────────────────────────────────
  // 3. CANCEL TRANSACTION
  // ─────────────────────────────────────────────────────────────
  const handleCancel = async () => {
    if (!activeDeposit) return;
    try {
      await paynectaClient.cancelDeposit(activeDeposit.id);
      setDisplayStatus('cancelled');
      setStatusMessage('Payment cancelled.');
      showToast('info', 'Deposit Cancelled', 'Session has been closed.');
      loadHistory();
    } catch (err: any) {
      showToast('error', 'Error', err.message);
    }
  };

  const handleResetForm = () => {
    setActiveDeposit(null);
    setDisplayStatus('ready_to_pay');
    setStatusMessage('');
    setErrorMessage('');
    setAuthErrorCode(null);
    setAmountKesInput(String(minDepositKes));
  };

  const copyToClipboard = (text: string, ref: string) => {
    navigator.clipboard.writeText(text);
    setCopiedRef(ref);
    showToast('info', 'Copied', text);
    setTimeout(() => setCopiedRef(null), 2000);
  };

  const isAuthed = Boolean(authUser || authClient.isAuthenticated());

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm select-none animate-in fade-in duration-150">
      <div className="w-full max-w-lg bg-[#0B0E17] border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* ─────────────────────────────────────────────────────────────
            HEADER: Brand, Balance & Tab Switcher
        ───────────────────────────────────────────────────────────── */}
        <div className="p-3.5 sm:p-4 border-b border-slate-800/90 flex items-center justify-between shrink-0 bg-[#0E131F]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <CreditCard className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-slate-100 font-sans">
                  Paynecta Deposit
                </h2>
                <span className="text-[9px] px-1.5 py-0.2 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 font-mono font-bold">
                  M-PESA KES
                </span>
              </div>
              <p className="text-[10px] text-slate-400 font-mono">
                Real Balance:{' '}
                <span className="text-emerald-400 font-bold">
                  ${profile.realBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD
                </span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            {/* Tab switch */}
            <div className="flex items-center bg-slate-950 p-0.5 rounded-lg border border-slate-800 text-[10px] font-mono mr-1">
              <button
                type="button"
                onClick={() => setActiveTab('deposit')}
                className={`px-2 py-1 rounded font-semibold transition-colors cursor-pointer ${
                  activeTab === 'deposit'
                    ? 'bg-slate-800 text-cyan-300 font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Deposit
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveTab('history');
                  loadHistory();
                }}
                className={`px-2 py-1 rounded font-semibold transition-colors cursor-pointer flex items-center gap-1 ${
                  activeTab === 'history'
                    ? 'bg-slate-800 text-cyan-300 font-bold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <History className="w-3 h-3" />
                <span>History</span>
              </button>
            </div>

            <button
              onClick={onClose}
              className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer"
              aria-label="Close modal"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ─────────────────────────────────────────────────────────────
            TAB 1: DEPOSIT WORKFLOW
        ───────────────────────────────────────────────────────────── */}
        {activeTab === 'deposit' && (
          <div className="p-4 sm:p-5 overflow-y-auto space-y-4 text-xs">
            {/* Unauthenticated Alert Prompt */}
            {!isAuthed && (
              <div className="p-3 rounded-xl bg-cyan-950/40 border border-cyan-500/40 text-cyan-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="flex items-start gap-2">
                  <Lock className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-xs text-white">Log in to deposit funds</p>
                    <p className="text-[11px] text-cyan-300/80">
                      An authenticated DevOptions session is required to credit Paynecta deposits.
                    </p>
                  </div>
                </div>
                {onOpenAuth && (
                  <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto">
                    <button
                      type="button"
                      onClick={() => onOpenAuth('login')}
                      className="flex-1 sm:flex-none px-3 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs transition-colors cursor-pointer"
                    >
                      Log In
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpenAuth('register')}
                      className="flex-1 sm:flex-none px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-medium text-xs transition-colors cursor-pointer"
                    >
                      Register
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Paynecta Environment Configuration Warning (If server lacks keys) */}
            {gatewayConfig && !gatewayConfig.configured && (
              <div className="p-3 rounded-xl bg-amber-950/30 border border-amber-500/40 text-amber-200 space-y-2">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-bold text-[11px] uppercase font-mono tracking-wider text-amber-300">
                      Paynecta Setup Required on Server
                    </h4>
                    <p className="text-[11px] text-slate-300 leading-relaxed mt-0.5">
                      To accept live customer payments via M-Pesa, add your Paynecta merchant API credentials to your server environment:
                    </p>
                    <div className="mt-1.5 space-y-1 font-mono text-[10px] bg-slate-950/80 p-2 rounded border border-amber-500/30 text-amber-300">
                      {gatewayConfig.missingKeys.map((k) => (
                        <div key={k} className="flex items-center gap-1">
                          <span className="text-rose-400">•</span>
                          <span>{k}</span>
                        </div>
                      ))}
                    </div>
                    <p className="text-[10px] text-slate-400 mt-1.5">
                      <em>Note: Paynecta collects live payments in whole Kenyan Shillings. No sandbox is provided by Paynecta, so live test deposits move real funds.</em>
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* VIEW A: READY TO PAY (INPUT AMOUNT) */}
            {displayStatus === 'ready_to_pay' && (
              <form onSubmit={handleCreateSession} className="space-y-4">
                {/* Available Balance Overview */}
                <div className="grid grid-cols-2 gap-2 p-2.5 rounded-xl bg-slate-950/80 border border-slate-800">
                  <div className="space-y-0.5">
                    <span className="text-[10px] uppercase font-mono text-slate-400">Live Available Balance</span>
                    <div className="flex items-baseline gap-1">
                      <span className="font-mono text-base font-bold text-emerald-400 tabular-nums">
                        ${(authUser?.realBalance ?? profile.realBalance ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                      <span className="text-[10px] font-mono text-slate-500">USD</span>
                    </div>
                  </div>
                  <div className="space-y-0.5 border-l border-slate-800/80 pl-2.5">
                    <span className="text-[10px] uppercase font-mono text-slate-400">Practice Demo Balance</span>
                    <div className="flex items-baseline gap-1">
                      <span className="font-mono text-base font-bold text-amber-300 tabular-nums">
                        ${(authUser?.demoBalance ?? profile.demoBalance ?? 10000).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                      <span className="text-[10px] font-mono text-slate-500">USD</span>
                    </div>
                  </div>
                </div>

                {/* Method Pill */}
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold font-mono text-xs">
                      MP
                    </div>
                    <div>
                      <span className="font-bold text-slate-100 block text-xs">
                        M-Pesa Express (Paynecta)
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono">
                        Instant STK prompt to mobile phone
                      </span>
                    </div>
                  </div>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800 font-mono font-bold">
                    0% Fee
                  </span>
                </div>

                {/* Currency Selection & Amount Input */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] font-semibold text-slate-400 uppercase font-mono">
                      <span>Deposit Amount</span>
                    </label>

                    {/* Currency Selector */}
                    <div className="flex items-center bg-slate-950 p-0.5 rounded-lg border border-slate-800 text-[10px] font-mono">
                      <button
                        type="button"
                        onClick={() => setSelectedCurrency('KES')}
                        className={`px-2 py-0.5 rounded font-bold cursor-pointer transition-colors ${
                          selectedCurrency === 'KES'
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        KES (Shillings)
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedCurrency('USD')}
                        className={`px-2 py-0.5 rounded font-bold cursor-pointer transition-colors ${
                          selectedCurrency === 'USD'
                            ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        USD ($)
                      </button>
                    </div>
                  </div>

                  {selectedCurrency === 'KES' ? (
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-mono font-bold text-xs">
                        KES
                      </span>
                      <input
                        type="number"
                        step={1}
                        min={minDepositKes}
                        required
                        value={amountKesInput}
                        onChange={(e) => {
                          const val = e.target.value;
                          setAmountKesInput(val);
                          const num = Number(val);
                          if (!isNaN(num) && num > 0) {
                            setAmountUsdInput((num / kesPerUsd).toFixed(2));
                          }
                          setErrorMessage('');
                        }}
                        placeholder={String(minDepositKes)}
                        className={`w-full bg-slate-950 border rounded-xl pl-12 pr-4 py-2.5 text-slate-100 font-mono text-sm font-bold focus:outline-none transition-colors ${
                          isFractional || (amountKesInput && isBelowMin)
                            ? 'border-rose-500 focus:border-rose-400'
                            : 'border-slate-800 focus:border-cyan-500'
                        }`}
                      />
                    </div>
                  ) : (
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-mono font-bold text-xs">
                        $ USD
                      </span>
                      <input
                        type="number"
                        step={0.5}
                        min={minDepositUsd}
                        required
                        value={amountUsdInput}
                        onChange={(e) => {
                          const val = e.target.value;
                          setAmountUsdInput(val);
                          const num = Number(val);
                          if (!isNaN(num) && num > 0) {
                            // Convert to whole KES
                            const wholeKes = Math.round(num * kesPerUsd);
                            setAmountKesInput(String(wholeKes));
                          }
                          setErrorMessage('');
                        }}
                        placeholder={String(minDepositUsd)}
                        className="w-full bg-slate-950 border border-slate-800 focus:border-cyan-500 rounded-xl pl-16 pr-4 py-2.5 text-slate-100 font-mono text-sm font-bold focus:outline-none transition-colors"
                      />
                    </div>
                  )}

                  {/* Fractional error / Min error */}
                  {isFractional && (
                    <p className="text-[10px] text-rose-400 font-mono flex items-center gap-1">
                      <AlertCircle className="w-3 h-3 shrink-0" />
                      <span>Whole shillings only. Decimal cents are rejected by Paynecta.</span>
                    </p>
                  )}

                  {/* Preset Amount Badges */}
                  <div className="grid grid-cols-4 gap-1.5 pt-1">
                    {[
                      { kes: 650, usd: 5 },
                      { kes: 1300, usd: 10 },
                      { kes: 2600, usd: 20 },
                      { kes: 6500, usd: 50 },
                    ].map((p) => (
                      <button
                        key={p.kes}
                        type="button"
                        onClick={() => {
                          setAmountKesInput(String(p.kes));
                          setAmountUsdInput(String(p.usd));
                          setErrorMessage('');
                        }}
                        className={`py-1.5 px-1 rounded-lg text-center font-mono transition-colors border cursor-pointer ${
                          parsedKes === p.kes
                            ? 'bg-cyan-950 text-cyan-300 border-cyan-800 font-bold'
                            : 'bg-slate-950 text-slate-400 hover:text-slate-200 border-slate-800'
                        }`}
                      >
                        <span className="text-[10.5px] block font-bold">KES {p.kes}</span>
                        <span className="text-[9px] text-slate-500 block">≈ ${p.usd}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Clear Payment Instructions */}
                <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800/80 space-y-1 text-[11px] font-sans text-slate-300">
                  <div className="font-semibold text-slate-200 flex items-center gap-1.5 font-mono text-[10px] uppercase text-cyan-400">
                    <Smartphone className="w-3.5 h-3.5" />
                    <span>How Paynecta M-Pesa Checkout Works</span>
                  </div>
                  <ol className="list-decimal list-inside space-y-0.5 text-[10.5px] text-slate-400 font-mono">
                    <li>Click &ldquo;Continue to Payment&rdquo; to open Paynecta hosted checkout.</li>
                    <li>Enter your M-Pesa mobile phone number on Paynecta&apos;s secure screen.</li>
                    <li>Approve the STK PIN prompt on your phone (DevOptions never asks for your PIN).</li>
                    <li>Payment is independently verified by our backend and credited immediately.</li>
                  </ol>
                </div>

                {/* Conversion Ledger Card */}
                <div className="p-3 rounded-xl bg-[#090D16] border border-slate-800/90 space-y-1.5 font-mono text-xs">
                  <div className="flex items-center justify-between text-slate-400 text-[11px]">
                    <span>Amount Charged to M-Pesa:</span>
                    <span className="text-slate-200 font-bold">
                      KES {isValidAmount ? parsedKes.toLocaleString() : '0'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-slate-400 text-[11px]">
                    <span>Verified Exchange Rate:</span>
                    <span className="text-slate-300">1 USD = {kesPerUsd.toFixed(1)} KES</span>
                  </div>
                  <div className="flex items-center justify-between text-slate-400 text-[11px]">
                    <span>Processing Fee:</span>
                    <span className="text-emerald-400 font-bold">Free ($0.00)</span>
                  </div>
                  <div className="pt-1.5 border-t border-slate-800 flex items-center justify-between text-xs">
                    <span className="text-slate-300 font-semibold uppercase">Platform Balance Credit:</span>
                    <span className="text-emerald-400 font-bold font-mono text-sm">
                      +${calculatedUsd.toFixed(2)} USD
                    </span>
                  </div>
                </div>

                {/* Section 9: Distinction about trading funds and custody */}
                <div className="p-2.5 rounded-xl bg-slate-950/90 border border-slate-800 text-[10px] text-slate-400 font-mono flex items-start gap-2">
                  <Lock className="w-3.5 h-3.5 text-cyan-400 shrink-0 mt-0.5" />
                  <p className="leading-relaxed">
                    <strong className="text-slate-200 font-semibold">Trading Wallet Notice:</strong> Completed Paynecta collections fund your DevOptions trading balance. Funds are not held directly with external regulated brokers, and withdrawals require configuring verified payout channels.
                  </p>
                </div>

                {/* Error Banner with Inline Login Action */}
                {errorMessage && (
                  <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-500/50 text-rose-200 text-xs font-mono space-y-2">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-rose-400" />
                      <div className="flex-1 leading-relaxed">
                        <span className="font-bold block text-rose-300">
                          {authErrorCode === 'SESSION_EXPIRED'
                            ? 'Session Expired'
                            : authErrorCode === 'INVALID_TOKEN'
                            ? 'Authentication Error'
                            : authErrorCode === 'ACCOUNT_INACTIVE'
                            ? 'Account Inactive'
                            : authErrorCode === 'AUTH_REQUIRED'
                            ? 'Authentication Required'
                            : authErrorCode === 'TAPFLOW_MISSING' || errorMessage.includes('TapFlow') || errorMessage.includes('No active payment collection flow')
                            ? 'Paynecta TapFlow Configuration Required'
                            : authErrorCode === 'PAYNECTA_AUTH_FAILED'
                            ? 'Paynecta API Authentication Failed'
                            : authErrorCode === 'PAYNECTA_FORBIDDEN'
                            ? 'Paynecta Permission Error'
                            : 'Payment Error'}
                        </span>
                        <span>{errorMessage}</span>
                      </div>
                    </div>

                    {(authErrorCode === 'TAPFLOW_MISSING' ||
                      errorMessage.includes('TapFlow') ||
                      errorMessage.includes('No active payment collection flow')) && (
                      <div className="pt-2 border-t border-rose-900/50 space-y-2 text-[11px] font-sans">
                        <div className="text-amber-300 font-semibold flex items-center gap-1.5">
                          <span>Paynecta Dashboard Setup Instructions:</span>
                        </div>
                        <ol className="list-decimal list-inside space-y-1 text-slate-300 text-[10.5px]">
                          <li>
                            Sign in to your Paynecta account at{' '}
                            <span className="text-cyan-400 font-mono font-bold">
                              https://dashboard.paynecta.co.ke/
                            </span>
                          </li>
                          <li>
                            Navigate to <strong className="text-white">TapFlows</strong> in the left sidebar menu.
                          </li>
                          <li>
                            Ensure you have an active collection TapFlow configured with M-Pesa collection enabled.
                          </li>
                          <li>
                            Copy your TapFlow ID (format <code className="text-amber-300 font-mono">tap_...</code>) and save it in your backend environment as <code className="text-amber-300 font-mono">PAYNECTA_TAPFLOW_ID</code>.
                          </li>
                        </ol>
                      </div>
                    )}

                    {(authErrorCode === 'AUTH_REQUIRED' ||
                      authErrorCode === 'SESSION_EXPIRED' ||
                      authErrorCode === 'INVALID_TOKEN') &&
                      onOpenAuth && (
                        <div className="pt-2 border-t border-rose-900/50 flex items-center justify-between gap-2">
                          <span className="text-[10px] text-rose-300/80">Need to authenticate?</span>
                          <button
                            type="button"
                            onClick={() => {
                              setErrorMessage('');
                              setAuthErrorCode(null);
                              onOpenAuth('login');
                            }}
                            className="px-3 py-1 rounded-lg bg-rose-500 hover:bg-rose-400 text-slate-950 font-bold text-[11px] transition-colors cursor-pointer shrink-0"
                          >
                            Log In to Continue
                          </button>
                        </div>
                      )}
                  </div>
                )}

                {/* Submit Action */}
                <button
                  type="submit"
                  disabled={!isValidAmount || isSubmitting}
                  className={`w-full py-3 px-4 rounded-xl font-bold font-mono text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer ${
                    !isValidAmount || isSubmitting
                      ? 'bg-slate-900 text-slate-500 border border-slate-800 cursor-not-allowed opacity-60'
                      : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-950/40'
                  }`}
                >
                  {isSubmitting ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Creating Paynecta Session...</span>
                    </>
                  ) : (
                    <>
                      <span>Continue to Payment</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>

                <div className="flex items-center justify-center gap-1.5 text-[10px] text-slate-500 font-mono">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Secured by Paynecta Payment Infrastructure</span>
                </div>
              </form>
            )}

            {/* VIEW B: ACTIVE PAYMENT SESSION STATUS */}
            {activeDeposit && displayStatus !== 'ready_to_pay' && (
              <div className="space-y-4">
                {/* Status Hero Card */}
                <div
                  className={`p-4 rounded-2xl border text-center space-y-2 ${
                    displayStatus === 'succeeded'
                      ? 'bg-emerald-950/20 border-emerald-500/40 text-emerald-300'
                      : displayStatus === 'failed'
                      ? 'bg-rose-950/20 border-rose-500/40 text-rose-300'
                      : displayStatus === 'cancelled'
                      ? 'bg-slate-900/80 border-slate-700 text-slate-300'
                      : displayStatus === 'verification_delayed'
                      ? 'bg-amber-950/20 border-amber-500/40 text-amber-300'
                      : 'bg-cyan-950/20 border-cyan-500/40 text-cyan-300'
                  }`}
                >
                  <div className="w-12 h-12 rounded-full mx-auto flex items-center justify-center bg-slate-950/60 border border-current shadow-inner">
                    {displayStatus === 'succeeded' && (
                      <CheckCircle2 className="w-6 h-6 text-emerald-400" />
                    )}
                    {displayStatus === 'failed' && (
                      <AlertCircle className="w-6 h-6 text-rose-400" />
                    )}
                    {displayStatus === 'cancelled' && (
                      <X className="w-6 h-6 text-slate-400" />
                    )}
                    {displayStatus === 'verification_delayed' && (
                      <Clock className="w-6 h-6 text-amber-400 animate-pulse" />
                    )}
                    {(displayStatus === 'awaiting_payment' || displayStatus === 'verifying_payment') && (
                      <RefreshCw className="w-6 h-6 text-cyan-400 animate-spin" />
                    )}
                  </div>

                  <div>
                    <span className="text-[10px] font-mono uppercase tracking-widest font-bold block opacity-75">
                      Payment Status
                    </span>
                    <h3 className="text-base font-black font-mono">
                      {displayStatus === 'awaiting_payment'
                        ? 'Awaiting Approval'
                        : displayStatus === 'verifying_payment'
                        ? 'Verifying'
                        : displayStatus === 'succeeded'
                        ? 'Successful'
                        : displayStatus === 'cancelled'
                        ? 'Cancelled'
                        : displayStatus === 'failed'
                        ? 'Failed'
                        : displayStatus === 'verification_delayed'
                        ? 'Verification Delayed'
                        : 'Pending'}
                    </h3>
                  </div>

                  <p className="text-xs text-slate-300 max-w-sm mx-auto leading-relaxed">
                    {statusMessage ||
                      (displayStatus === 'awaiting_payment'
                        ? 'Approve the M-Pesa prompt on your phone or complete checkout on Paynecta.'
                        : '')}
                  </p>
                </div>

                {/* Transaction Metadata Card */}
                <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2 font-mono text-xs">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-400">Reference:</span>
                    <button
                      type="button"
                      onClick={() =>
                        copyToClipboard(activeDeposit.merchantReference, 'ref')
                      }
                      className="text-cyan-300 font-bold hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <span>{activeDeposit.merchantReference}</span>
                      {copiedRef === 'ref' ? (
                        <Check className="w-3 h-3 text-emerald-400" />
                      ) : (
                        <Copy className="w-3 h-3 text-slate-500" />
                      )}
                    </button>
                  </div>

                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-400">Amount to Pay:</span>
                    <span className="text-slate-100 font-bold">
                      KES {activeDeposit.amountKes.toLocaleString()}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-400">Platform Credit:</span>
                    <span className="text-emerald-400 font-bold">
                      +${activeDeposit.amountUsd.toFixed(2)} USD
                    </span>
                  </div>

                  {activeDeposit.providerReference && (
                    <div className="flex items-center justify-between text-[11px] pt-1 border-t border-slate-800/80">
                      <span className="text-slate-400">Receipt / Provider ID:</span>
                      <span className="text-emerald-300 font-bold">
                        {activeDeposit.providerReference}
                      </span>
                    </div>
                  )}
                </div>

                {/* Primary Action Buttons depending on status */}
                <div className="space-y-2">
                  {/* If Awaiting Payment or Verifying: Show Open Checkout & Check Status */}
                  {(displayStatus === 'awaiting_payment' ||
                    displayStatus === 'verifying_payment' ||
                    displayStatus === 'verification_delayed') && (
                    <div className="grid grid-cols-2 gap-2">
                      {activeDeposit.checkoutUrl && (
                        <a
                          href={activeDeposit.checkoutUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 font-mono font-bold text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          <span>Open Checkout</span>
                        </a>
                      )}

                      <button
                        type="button"
                        onClick={() => handleCheckStatus(false)}
                        disabled={isVerifying}
                        className={`py-2.5 px-3 rounded-xl font-mono font-bold text-xs uppercase flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                          !activeDeposit.checkoutUrl ? 'col-span-2' : ''
                        } bg-cyan-600 hover:bg-cyan-500 text-white`}
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${isVerifying ? 'animate-spin' : ''}`} />
                        <span>{isVerifying ? 'Verifying...' : 'Check Status'}</span>
                      </button>
                    </div>
                  )}

                  {/* Succeeded Actions */}
                  {displayStatus === 'succeeded' && (
                    <button
                      type="button"
                      onClick={() => {
                        handleResetForm();
                        onClose();
                      }}
                      className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-mono font-bold text-xs uppercase transition-colors cursor-pointer shadow-lg shadow-emerald-950/40"
                    >
                      Done &amp; Return to Trading
                    </button>
                  )}

                  {/* Cancel / Try Again Options */}
                  {(displayStatus === 'failed' || displayStatus === 'cancelled') && (
                    <button
                      type="button"
                      onClick={handleResetForm}
                      className="w-full py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-mono font-bold text-xs uppercase transition-colors cursor-pointer"
                    >
                      Try Another Deposit
                    </button>
                  )}

                  {/* Cancel ongoing payment */}
                  {displayStatus === 'awaiting_payment' && (
                    <button
                      type="button"
                      onClick={handleCancel}
                      className="w-full py-1.5 text-center text-[11px] text-slate-500 hover:text-rose-400 font-mono transition-colors cursor-pointer"
                    >
                      Cancel this deposit session
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ─────────────────────────────────────────────────────────────
            TAB 2: DEPOSIT AUDIT HISTORY
        ───────────────────────────────────────────────────────────── */}
        {activeTab === 'history' && (
          <div className="p-4 sm:p-5 overflow-y-auto space-y-3 text-xs max-h-[60vh]">
            <div className="flex items-center justify-between text-slate-400 font-mono text-[11px] pb-1 border-b border-slate-800/80">
              <span>Your Recent Paynecta Deposits</span>
              <button
                type="button"
                onClick={loadHistory}
                className="flex items-center gap-1 text-cyan-400 hover:underline cursor-pointer"
              >
                <RefreshCw className="w-3 h-3" />
                <span>Refresh</span>
              </button>
            </div>

            {pastDeposits.length === 0 ? (
              <div className="py-8 text-center text-slate-500 font-mono text-xs">
                No past deposits found for this account.
              </div>
            ) : (
              <div className="space-y-2">
                {pastDeposits
                  .filter((dep) => Boolean(dep && dep.id))
                  .map((dep) => (
                    <div
                      key={dep.id}
                      className="p-3 rounded-xl bg-slate-950 border border-slate-800/80 flex items-center justify-between gap-3 text-xs font-mono"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-100">
                            KES {(dep.amountKes || 0).toLocaleString()}
                          </span>
                          <span className="text-slate-500">&rarr;</span>
                          <span className="text-emerald-400 font-bold">
                            +${(dep.amountUsd || 0).toFixed(2)} USD
                          </span>
                        </div>
                        <span className="text-[10px] text-slate-500 block truncate">
                          Ref: {dep.merchantReference || 'N/A'}
                        </span>
                      <span className="text-[9px] text-slate-600 block">
                        {new Date(dep.createdAt).toLocaleString()}
                      </span>
                    </div>

                    <div className="text-right shrink-0 space-y-1">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                          dep.status === 'succeeded'
                            ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                            : dep.status === 'failed'
                            ? 'bg-rose-950 text-rose-300 border border-rose-800'
                            : dep.status === 'cancelled'
                            ? 'bg-slate-900 text-slate-400 border border-slate-800'
                            : 'bg-cyan-950 text-cyan-300 border border-cyan-800 animate-pulse'
                        }`}
                      >
                        {dep.status}
                      </span>

                      {dep.status === 'pending' && (
                        <button
                          type="button"
                          onClick={() => {
                            setActiveDeposit(dep);
                            setDisplayStatus('awaiting_payment');
                            setActiveTab('deposit');
                          }}
                          className="block text-[10px] text-cyan-400 hover:underline font-bold"
                        >
                          Verify &rarr;
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
