import React, { useState } from 'react';
import { Transaction, UserProfile } from '../../types/trading';
import { storage } from '../../services/storage';
import { audioEffects } from '../../services/audioEffects';
import { useToast } from '../common/ToastNotification';
import {
  X,
  Smartphone,
  Building,
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
  RefreshCw,
  ArrowRight,
  DollarSign,
} from 'lucide-react';

interface WithdrawModalProps {
  isOpen: boolean;
  onClose: () => void;
  profile: UserProfile;
  onProfileUpdate: (updated: UserProfile) => void;
}

const USD_TO_KES_RATE = 130.0;
const MIN_WITHDRAW_USD = 5.0;

export const WithdrawModal: React.FC<WithdrawModalProps> = ({
  isOpen,
  onClose,
  profile,
  onProfileUpdate,
}) => {
  const { showToast } = useToast();
  const [method, setMethod] = useState<'mpesa' | 'bank'>('mpesa');
  const [amountUSD, setAmountUSD] = useState<number>(25);
  const [phone, setPhone] = useState<string>('254712345678');
  const [bankName, setBankName] = useState<string>('Standard Chartered');
  const [accountNumber, setAccountNumber] = useState<string>('010203040506');
  const [accountHolder, setAccountHolder] = useState<string>(profile.name || 'Alex Vance');

  const [flowState, setFlowState] = useState<'input' | 'processing' | 'success'>('input');
  const [txRef, setTxRef] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');

  if (!isOpen) return null;

  const availableBalance = profile.realBalance;
  const feeUSD = 0.0; // Zero withdrawal fee promotion
  const netAmountUSD = Math.max(0, amountUSD - feeUSD);
  const netAmountKES = Math.round(netAmountUSD * USD_TO_KES_RATE);

  const handleStartWithdrawal = () => {
    if (amountUSD < MIN_WITHDRAW_USD) {
      setErrorMessage(`Minimum withdrawal is $${MIN_WITHDRAW_USD.toFixed(2)} USD.`);
      return;
    }
    if (amountUSD > availableBalance) {
      setErrorMessage(`Insufficient balance ($${availableBalance.toFixed(2)} available).`);
      return;
    }
    setErrorMessage('');

    setFlowState('processing');

    setTimeout(() => {
      const payoutRef = `WD_${Math.floor(1000000 + Math.random() * 9000000)}`;
      setTxRef(payoutRef);

      const newTx: Transaction = {
        id: `tx_${Date.now()}`,
        type: 'withdrawal',
        method: method,
        amountUSD,
        amountLocal: method === 'mpesa' ? netAmountKES : undefined,
        localCurrency: method === 'mpesa' ? 'KES' : 'USD',
        feeUSD,
        netAmountUSD,
        status: 'completed',
        reference: payoutRef,
        createdAt: Date.now(),
        details: {
          phone: method === 'mpesa' ? phone : undefined,
          bankName: method === 'bank' ? bankName : undefined,
          accountNumber: method === 'bank' ? accountNumber : undefined,
        },
      };

      storage.addTransaction(newTx);

      const updatedProfile = {
        ...profile,
        realBalance: Number((profile.realBalance - amountUSD).toFixed(2)),
      };
      storage.saveUserProfile(updatedProfile);
      onProfileUpdate(updatedProfile);

      audioEffects.playTradePlaced();
      showToast('success', 'Withdrawal Processed', `Disbursed $${amountUSD} via ${method.toUpperCase()} (${payoutRef})`);
      setFlowState('success');
    }, 1800);
  };

  const handleResetModal = () => {
    setFlowState('input');
    setErrorMessage('');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm select-none">
      <div className="bg-[#0D1322] border border-slate-800 rounded-2xl max-w-md w-full shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <div>
            <h3 className="font-bold text-slate-100 text-sm">Withdraw Real Funds</h3>
            <span className="text-[11px] text-emerald-400 font-mono font-semibold">
              Withdrawable: ${availableBalance.toFixed(2)} USD
            </span>
          </div>
          <button
            onClick={handleResetModal}
            className="text-slate-400 hover:text-slate-200 p-1 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body Content */}
        <div className="p-5 space-y-4">
          {flowState === 'input' && (
            <>
              {/* Withdrawal Method Tabs */}
              <div className="grid grid-cols-2 gap-2 p-1 bg-slate-950 rounded-xl border border-slate-800 text-xs">
                <button
                  onClick={() => setMethod('mpesa')}
                  className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg font-semibold transition-all ${
                    method === 'mpesa'
                      ? 'bg-emerald-600/20 text-emerald-300 border border-emerald-500/40 shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Smartphone className="w-4 h-4 text-emerald-400" />
                  <span>M-Pesa Mobile</span>
                </button>

                <button
                  onClick={() => setMethod('bank')}
                  className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg font-semibold transition-all ${
                    method === 'bank'
                      ? 'bg-cyan-600/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Building className="w-4 h-4 text-cyan-400" />
                  <span>Bank Wire</span>
                </button>
              </div>

              {/* Amount Input */}
              <div className="space-y-1.5 text-xs">
                <div className="flex items-center justify-between">
                  <label className="text-slate-300 font-medium">Withdrawal Amount (USD)</label>
                  <span className="text-[11px] text-amber-400 font-mono">Min: $5.00</span>
                </div>

                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-slate-500 font-mono text-sm">
                    $
                  </span>
                  <input
                    type="number"
                    min="5"
                    max={availableBalance}
                    step="5"
                    value={amountUSD}
                    onChange={(e) => setAmountUSD(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-8 pr-4 py-2.5 text-slate-100 font-mono text-base font-bold focus:outline-none focus:border-cyan-500"
                  />
                </div>

                {/* Percentage Shortcuts */}
                <div className="flex items-center gap-1.5 pt-1">
                  {[25, 50, 75, 100].map((pct) => (
                    <button
                      key={pct}
                      onClick={() => setAmountUSD(Math.max(5, Math.floor((availableBalance * pct) / 100)))}
                      className="flex-1 py-1 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-lg text-xs font-mono text-slate-300 transition-colors"
                    >
                      {pct}%
                    </button>
                  ))}
                </div>
              </div>

              {/* Method destination details */}
              {method === 'mpesa' ? (
                <div className="space-y-3 pt-1">
                  <div className="space-y-1.5 text-xs">
                    <label className="text-slate-300 font-medium">Destination M-Pesa Phone</label>
                    <input
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="254712345678"
                      className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-slate-100 font-mono text-xs focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-xs space-y-1">
                    <div className="flex justify-between text-slate-400">
                      <span>Disbursed KES:</span>
                      <span className="font-mono font-bold text-emerald-400">
                        KES {netAmountKES.toLocaleString()}
                      </span>
                    </div>
                    <div className="flex justify-between text-slate-400">
                      <span>Processing Fee:</span>
                      <span className="font-mono text-emerald-400 font-bold">$0.00 (0%)</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-2.5 pt-1 text-xs">
                  <div>
                    <label className="text-slate-400 block font-medium mb-1">Bank Name</label>
                    <input
                      type="text"
                      value={bankName}
                      onChange={(e) => setBankName(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-slate-100 font-mono text-xs focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                  <div>
                    <label className="text-slate-400 block font-medium mb-1">Account Number</label>
                    <input
                      type="text"
                      value={accountNumber}
                      onChange={(e) => setAccountNumber(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-slate-100 font-mono text-xs focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                </div>
              )}

              {errorMessage && (
                <div className="p-2.5 bg-rose-950/20 border border-rose-500/30 rounded-lg flex items-center gap-2 text-rose-300 text-xs">
                  <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                  <span>{errorMessage}</span>
                </div>
              )}

              {/* Submit CTA */}
              <button
                onClick={handleStartWithdrawal}
                disabled={availableBalance < MIN_WITHDRAW_USD}
                className="w-full py-3 px-4 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white font-bold rounded-xl text-xs transition-all shadow-lg shadow-cyan-950/40 flex items-center justify-center gap-2"
              >
                <span>Confirm Withdrawal of ${netAmountUSD}.00 USD</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </>
          )}

          {/* Processing State */}
          {flowState === 'processing' && (
            <div className="py-8 text-center space-y-3">
              <RefreshCw className="w-8 h-8 text-cyan-400 animate-spin mx-auto" />
              <h4 className="font-semibold text-slate-100 text-sm">
                Processing Instant Payout Request...
              </h4>
              <p className="text-xs text-slate-400 max-w-xs mx-auto">
                Disbursing funds to your selected payout destination via payment provider.
              </p>
            </div>
          )}

          {/* Success State */}
          {flowState === 'success' && (
            <div className="py-6 text-center space-y-4">
              <div className="w-12 h-12 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto border border-emerald-500/30">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h4 className="font-bold text-slate-100 text-base">
                  Withdrawal Successfully Disbursed!
                </h4>
                <p className="font-mono text-emerald-400 font-bold text-sm">
                  -${amountUSD}.00 USD Sent
                </p>
              </div>

              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 text-xs font-mono text-left space-y-1">
                <div className="flex justify-between text-slate-400">
                  <span>Payout Reference:</span>
                  <span className="text-slate-200 font-bold">{txRef}</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>Destination:</span>
                  <span className="text-slate-200">{method === 'mpesa' ? phone : bankName}</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>Remaining Balance:</span>
                  <span className="text-slate-200 font-bold">${profile.realBalance.toFixed(2)} USD</span>
                </div>
              </div>

              <button
                onClick={handleResetModal}
                className="w-full py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-100 font-semibold rounded-xl text-xs transition-colors"
              >
                Back to Trading
              </button>
            </div>
          )}

          {/* Regulatory info */}
          <div className="flex items-start gap-2 pt-1 border-t border-slate-800/80 text-[11px] text-slate-500">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <p>
              Withdrawals are processed instantly via automated settlement. No hidden charges or cancellation delays.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
