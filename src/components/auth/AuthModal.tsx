import React, { useState, useEffect } from 'react';
import { authClient, AuthUser } from '../../services/authClient';
import { useToast } from '../common/ToastNotification';
import {
  X,
  Mail,
  Phone,
  Lock,
  Eye,
  EyeOff,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  RotateCcw,
  KeyRound,
  ShieldAlert,
  Crown,
  User,
} from 'lucide-react';

export type AuthMode = 'login' | 'register' | 'verify' | 'forgot' | 'reset';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialMode?: AuthMode;
  onAuthSuccess?: (user: AuthUser) => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  initialMode = 'login',
  onAuthSuccess,
}) => {
  const { showToast } = useToast();

  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [successMessage, setSuccessMessage] = useState<string>('');

  // Form fields
  const [fullName, setFullName] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [phone, setPhone] = useState<string>('+');
  const [password, setPassword] = useState<string>('');
  const [confirmPassword, setConfirmPassword] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState<boolean>(false);

  // Verification state
  const [verificationType, setVerificationType] = useState<'email' | 'phone'>('email');
  const [otpCode, setOtpCode] = useState<string>('');
  const [resendCooldown, setResendCooldown] = useState<number>(0);

  // Forgot password state
  const [forgotIdentifier, setForgotIdentifier] = useState<string>('');
  const [resetCode, setResetCode] = useState<string>('');
  const [newPassword, setNewPassword] = useState<string>('');
  const [confirmNewPassword, setConfirmNewPassword] = useState<string>('');

  const currentUser = authClient.getCurrentUser();

  useEffect(() => {
    setMode(initialMode);
    setErrorMessage('');
    setSuccessMessage('');
  }, [initialMode, isOpen]);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (resendCooldown > 0) {
      timer = setTimeout(() => setResendCooldown((prev) => prev - 1), 1000);
    }
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  if (!isOpen) return null;

  // Validation helpers
  const isValidEmail = (str: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str.trim());
  const isValidPhone = (str: string) => /^\+[1-9]\d{6,14}$/.test(str.trim().replace(/[\s\-]/g, ''));

  // 1. Handle Registration
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    setSuccessMessage('');

    if (!email || !phone || !password || !confirmPassword) {
      setErrorMessage('Please fill in all required registration fields.');
      return;
    }

    if (!isValidEmail(email)) {
      setErrorMessage('Please provide a valid email address.');
      return;
    }

    // Intelligent phone normalization for user convenience
    const cleanPhone = phone.trim().replace(/[\s\-\(\)\.]/g, '');
    let formattedPhone = cleanPhone;
    if (/^0[17]\d{8}$/.test(cleanPhone)) {
      formattedPhone = '+254' + cleanPhone.substring(1);
    } else if (/^[2-9]\d{9}$/.test(cleanPhone)) {
      formattedPhone = '+1' + cleanPhone;
    } else if (!cleanPhone.startsWith('+')) {
      formattedPhone = '+' + cleanPhone;
    }

    if (!isValidPhone(formattedPhone)) {
      setErrorMessage('Please provide a valid phone number with country code (e.g. +14155552671 or +254712345678).');
      return;
    }

    if (password.length < 8) {
      setErrorMessage('Password must be at least 8 characters long.');
      return;
    }

    const hasLetter = /[a-zA-Z]/.test(password);
    const hasNumberOrSymbol = /[\d!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password);
    if (!hasLetter || !hasNumberOrSymbol) {
      setErrorMessage('Password must contain both letters and at least one number or symbol.');
      return;
    }

    if (password !== confirmPassword) {
      setErrorMessage('Passwords do not match. Please verify your confirm password field.');
      return;
    }

    setLoading(true);
    try {
      const derivedName = (fullName.trim() || email.trim().split('@')[0] || 'Trader');
      const res = await authClient.register({
        fullName: derivedName,
        email: email.trim().toLowerCase(),
        phone: formattedPhone,
        password,
        confirmPassword,
      });
      setLoading(false);
      showToast('success', 'Account Registered', 'Welcome to DevOptions! Account created successfully.');
      setMode('verify');
      if (onAuthSuccess) onAuthSuccess(res.user);
    } catch (err: any) {
      setLoading(false);
      setErrorMessage(err.message || 'Registration failed');
    }
  };

  // 2. Handle Login
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    setSuccessMessage('');

    if (!email || !password) {
      setErrorMessage('Please enter your email or phone and password.');
      return;
    }

    setLoading(true);
    try {
      const res = await authClient.login({
        identifier: email,
        password,
      });
      setLoading(false);
      showToast('success', 'Logged In', 'Welcome back to DevOptions Terminal.');
      if (onAuthSuccess) onAuthSuccess(res.user);
      onClose();
    } catch (err: any) {
      setLoading(false);
      setErrorMessage(err.message || 'Login failed');
    }
  };

  // 3. Handle Verify Code
  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    setSuccessMessage('');

    if (!otpCode || otpCode.trim().length !== 6) {
      setErrorMessage('Please enter the complete 6-digit verification code.');
      return;
    }

    setLoading(true);
    try {
      let updatedUser: AuthUser;
      if (verificationType === 'email') {
        updatedUser = await authClient.verifyEmail(otpCode);
        showToast('success', 'Email Verified', 'Your email address has been verified.');
      } else {
        updatedUser = await authClient.verifyPhone(otpCode);
        showToast('success', 'Phone Verified', 'Your phone number has been verified.');
      }
      setLoading(false);
      setOtpCode('');
      setSuccessMessage(`${verificationType === 'email' ? 'Email' : 'Phone'} verified successfully!`);

      if (onAuthSuccess) onAuthSuccess(updatedUser);

      // If both verified, close modal or celebrate
      if (updatedUser.emailVerified && updatedUser.phoneVerified) {
        setTimeout(() => onClose(), 1200);
      }
    } catch (err: any) {
      setLoading(false);
      setErrorMessage(err.message || 'Verification failed');
    }
  };

  // 4. Handle Resend Code
  const handleResendCode = async () => {
    if (resendCooldown > 0) return;
    setLoading(true);
    setErrorMessage('');
    try {
      const res = await authClient.resendCode(verificationType);
      setLoading(false);
      setResendCooldown(30); // 30 sec cooldown
      showToast('info', 'Code Resent', res.message);
    } catch (err: any) {
      setLoading(false);
      setErrorMessage(err.message || 'Could not resend code');
    }
  };

  // 5. Handle Forgot Password Request
  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    setSuccessMessage('');

    if (!forgotIdentifier) {
      setErrorMessage('Please enter your registered email or phone number.');
      return;
    }

    setLoading(true);
    try {
      const res = await authClient.forgotPassword(forgotIdentifier);
      setLoading(false);
      setSuccessMessage(res.message);
      setMode('reset');
      if (res.devOtp) {
        setResetCode(res.devOtp);
      }
    } catch (err: any) {
      setLoading(false);
      setErrorMessage(err.message || 'Request failed');
    }
  };

  // 6. Handle Reset Password Submission
  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    setSuccessMessage('');

    if (!resetCode || !newPassword) {
      setErrorMessage('Please enter the verification code and new password.');
      return;
    }

    if (newPassword.length < 8) {
      setErrorMessage('New password must be at least 8 characters long.');
      return;
    }

    if (newPassword !== confirmNewPassword) {
      setErrorMessage('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const res = await authClient.resetPassword(
        forgotIdentifier,
        resetCode,
        newPassword,
        confirmNewPassword
      );
      setLoading(false);
      showToast('success', 'Password Reset', res.message);
      setMode('login');
      setPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      setLoading(false);
      setErrorMessage(err.message || 'Password reset failed');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-[#090D16] border border-slate-800 rounded-2xl w-full max-w-md max-h-[92vh] flex flex-col shadow-2xl overflow-hidden text-slate-200">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-800/80 flex items-center justify-between bg-slate-900/60">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-400 font-extrabold text-xs">
              D
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-100 flex items-center gap-1.5 leading-none">
                <span>DEV<span className="text-cyan-400">OPTIONS</span></span>
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 uppercase">
                  {mode === 'login' ? 'Sign In' : mode === 'register' ? 'Register' : mode === 'verify' ? 'Verification' : 'Reset'}
                </span>
              </h2>
              <p className="text-[11px] text-slate-400 mt-1 leading-none">
                {mode === 'login'
                  ? 'Access your trading terminal and positions'
                  : mode === 'register'
                  ? 'Create an independent trader account'
                  : mode === 'verify'
                  ? 'Confirm your email and phone verification'
                  : 'Recover your account credentials securely'}
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

        {/* Form Body */}
        <div className="p-5 overflow-y-auto space-y-4 text-xs">
          {/* Error & Success Banners */}
          {errorMessage && (
            <div className="p-2.5 rounded-lg bg-rose-950/30 border border-rose-500/30 text-rose-300 text-[11px] flex items-start gap-2">
              <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          {successMessage && (
            <div className="p-2.5 rounded-lg bg-emerald-950/30 border border-emerald-500/30 text-emerald-300 text-[11px] flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <span>{successMessage}</span>
            </div>
          )}

          {/* ─────────────────────────────────────────────────────────────
              VIEW 1: REGISTER
          ───────────────────────────────────────────────────────────── */}
          {mode === 'register' && (
            <form onSubmit={handleRegister} className="space-y-3.5">
              {/* Full Name */}
              <div className="space-y-1">
                <label className="text-[10px] font-semibold text-slate-400 uppercase font-mono flex items-center justify-between">
                  <span>Full Name</span>
                  <span className="text-slate-500 lowercase">e.g. Alex Morgan</span>
                </label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Alex Morgan"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-slate-100 text-xs focus:border-cyan-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* Email */}
              <div className="space-y-1">
                <label className="text-[10px] font-semibold text-slate-400 uppercase font-mono flex items-center justify-between">
                  <span>Email Address</span>
                  <span className="text-slate-500 lowercase">e.g. trader@example.com</span>
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="trader@domain.com"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-slate-100 text-xs focus:border-cyan-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* Phone */}
              <div className="space-y-1">
                <label className="text-[10px] font-semibold text-slate-400 uppercase font-mono flex items-center justify-between">
                  <span>Phone Number (E.164)</span>
                  <span className="text-slate-500">Include country code (+)</span>
                </label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input
                    type="tel"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+14155552671"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-slate-100 font-mono text-xs focus:border-cyan-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* Password */}
              <div className="space-y-1">
                <label className="text-[10px] font-semibold text-slate-400 uppercase font-mono flex items-center justify-between">
                  <span>Password</span>
                  <span className="text-slate-500">Min 8 characters</span>
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-9 py-2 text-slate-100 font-mono text-xs focus:border-cyan-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                  >
                    {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              {/* Confirm Password */}
              <div className="space-y-1">
                <label className="text-[10px] font-semibold text-slate-400 uppercase font-mono">
                  Confirm Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-9 py-2 text-slate-100 font-mono text-xs focus:border-cyan-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                  >
                    {showConfirmPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              {/* Live Password Requirements Checklist */}
              {password.length > 0 && (
                <div className="grid grid-cols-3 gap-1 p-2 rounded-lg bg-slate-950/70 border border-slate-800/80 text-[9.5px] font-mono">
                  <span className={`flex items-center gap-1 ${password.length >= 8 ? 'text-emerald-400 font-bold' : 'text-slate-500'}`}>
                    <span>{password.length >= 8 ? '✓' : '○'}</span>
                    <span>Min 8 chars</span>
                  </span>
                  <span className={`flex items-center gap-1 ${(/[a-zA-Z]/.test(password) && /[\d!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) ? 'text-emerald-400 font-bold' : 'text-slate-500'}`}>
                    <span>{(/[a-zA-Z]/.test(password) && /[\d!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) ? '✓' : '○'}</span>
                    <span>Letter & Number</span>
                  </span>
                  <span className={`flex items-center gap-1 ${(confirmPassword.length > 0 && password === confirmPassword) ? 'text-emerald-400 font-bold' : 'text-slate-500'}`}>
                    <span>{(confirmPassword.length > 0 && password === confirmPassword) ? '✓' : '○'}</span>
                    <span>Passwords match</span>
                  </span>
                </div>
              )}

              {/* Requirements summary */}
              <div className="p-2.5 rounded-lg bg-slate-950/60 border border-slate-800/80 text-[10px] text-slate-400 space-y-1 font-mono">
                <div className="flex items-center gap-1.5 text-slate-300 font-bold uppercase text-[9px]">
                  <ShieldCheck className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Security &amp; Independence</span>
                </div>
                <p>No broker API key or token required during registration. Account registration is separate from data/execution providers.</p>
              </div>

              {/* Submit */}
              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-gradient-to-r from-cyan-600 to-emerald-500 hover:from-cyan-500 hover:to-emerald-400 text-slate-950 font-bold text-xs uppercase tracking-wider transition-all shadow-lg shadow-cyan-950/30 cursor-pointer disabled:opacity-50"
              >
                <span>{loading ? 'Creating Account...' : 'Create Account'}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>

              <div className="text-center pt-1 text-[11px] text-slate-400">
                Already registered?{' '}
                <button
                  type="button"
                  onClick={() => {
                    setMode('login');
                    setErrorMessage('');
                  }}
                  className="text-cyan-400 hover:underline font-semibold cursor-pointer"
                >
                  Log In
                </button>
              </div>
            </form>
          )}

          {/* ─────────────────────────────────────────────────────────────
              VIEW 2: LOGIN
          ───────────────────────────────────────────────────────────── */}
          {mode === 'login' && (
            <div className="space-y-3.5">
              {/* Admin Quick Login Helper Card */}
              <div className="p-2.5 rounded-xl bg-amber-950/20 border border-amber-500/30 space-y-1.5 text-xs">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-amber-300 font-bold font-mono text-[10px] uppercase">
                    <Crown className="w-3.5 h-3.5 fill-current text-amber-400" />
                    <span>Administrator Access</span>
                  </div>
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono font-semibold">
                    ROLE: ADMIN
                  </span>
                </div>
                <p className="text-[10px] text-slate-300 leading-tight">
                  Pre-configured administrator accounts are active. Click to auto-fill credentials:
                </p>
                <div className="grid grid-cols-2 gap-1.5 pt-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      setEmail('admin@devoptions.io');
                      setPassword('Admin@DevOptions2026!');
                      showToast('info', 'Admin Filled', 'Master Admin credentials loaded.');
                    }}
                    className="px-2 py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-200 text-[10px] font-mono font-semibold flex items-center justify-center gap-1 transition-colors cursor-pointer"
                  >
                    <span>👑 admin@devoptions.io</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEmail('francisgraham071@gmail.com');
                      setPassword('Admin@DevOptions2026!');
                      showToast('info', 'Admin Filled', 'Francis Graham Admin credentials loaded.');
                    }}
                    className="px-2 py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-200 text-[10px] font-mono font-semibold flex items-center justify-center gap-1 transition-colors cursor-pointer truncate"
                  >
                    <span>👑 francisgraham...</span>
                  </button>
                </div>
              </div>

              <form onSubmit={handleLogin} className="space-y-3.5">
              <div className="space-y-1">
                <label className="text-[10px] font-semibold text-slate-400 uppercase font-mono">
                  Email or Phone Number
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input
                    type="text"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="trader@domain.com or +14155552671"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-slate-100 text-xs focus:border-cyan-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-semibold text-slate-400 uppercase font-mono">
                    Password
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setForgotIdentifier(email);
                      setMode('forgot');
                      setErrorMessage('');
                    }}
                    className="text-[10px] text-cyan-400 hover:underline font-mono cursor-pointer"
                  >
                    Forgot Password?
                  </button>
                </div>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-9 py-2 text-slate-100 font-mono text-xs focus:border-cyan-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                  >
                    {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              {/* Submit */}
              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs uppercase tracking-wider transition-all shadow-lg shadow-cyan-950/30 cursor-pointer disabled:opacity-50"
              >
                <span>{loading ? 'Authenticating...' : 'Sign In'}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>

              <div className="text-center pt-1 text-[11px] text-slate-400">
                Don't have an account yet?{' '}
                <button
                  type="button"
                  onClick={() => {
                    setMode('register');
                    setErrorMessage('');
                  }}
                  className="text-cyan-400 hover:underline font-semibold cursor-pointer"
                >
                  Create Account
                </button>
              </div>
            </form>
            </div>
          )}

          {/* ─────────────────────────────────────────────────────────────
              VIEW 3: VERIFICATION (EMAIL & PHONE TABS)
          ───────────────────────────────────────────────────────────── */}
          {mode === 'verify' && (
            <div className="space-y-4">
              {/* Status Pills */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setVerificationType('email');
                    setErrorMessage('');
                  }}
                  className={`p-2.5 rounded-xl border text-left transition-colors cursor-pointer ${
                    verificationType === 'email'
                      ? 'bg-slate-900 border-cyan-500'
                      : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono uppercase text-slate-400">Email</span>
                    {currentUser?.emailVerified ? (
                      <span className="text-[9px] px-1.5 py-0.2 rounded bg-emerald-950 text-emerald-400 border border-emerald-800 font-mono font-bold">
                        VERIFIED
                      </span>
                    ) : (
                      <span className="text-[9px] px-1.5 py-0.2 rounded bg-amber-950 text-amber-400 border border-amber-800 font-mono font-bold">
                        PENDING
                      </span>
                    )}
                  </div>
                  <span className="text-xs font-bold text-slate-200 truncate block mt-0.5">
                    {currentUser?.email || email}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setVerificationType('phone');
                    setErrorMessage('');
                  }}
                  className={`p-2.5 rounded-xl border text-left transition-colors cursor-pointer ${
                    verificationType === 'phone'
                      ? 'bg-slate-900 border-cyan-500'
                      : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono uppercase text-slate-400">Phone</span>
                    {currentUser?.phoneVerified ? (
                      <span className="text-[9px] px-1.5 py-0.2 rounded bg-emerald-950 text-emerald-400 border border-emerald-800 font-mono font-bold">
                        VERIFIED
                      </span>
                    ) : (
                      <span className="text-[9px] px-1.5 py-0.2 rounded bg-amber-950 text-amber-400 border border-amber-800 font-mono font-bold">
                        PENDING
                      </span>
                    )}
                  </div>
                  <span className="text-xs font-bold text-slate-200 truncate block mt-0.5 font-mono">
                    {currentUser?.phone || phone}
                  </span>
                </button>
              </div>

              {/* Dev / Sandbox helper badge */}
              {currentUser?.devNotice && (
                <div className="p-2.5 rounded-xl bg-cyan-950/40 border border-cyan-700/60 text-[10px] font-mono text-cyan-200 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1 font-bold uppercase text-[9px] text-cyan-300">
                      <Sparkles className="w-3 h-3 text-cyan-400" />
                      <span>Sandbox Verification Dispatch</span>
                    </div>
                    {((verificationType === 'email' && currentUser.devNotice.emailOtp) ||
                      (verificationType === 'phone' && currentUser.devNotice.phoneOtp)) && (
                      <button
                        type="button"
                        onClick={() => {
                          const code =
                            verificationType === 'email'
                              ? currentUser.devNotice?.emailOtp
                              : currentUser.devNotice?.phoneOtp;
                          if (code) setOtpCode(code);
                        }}
                        className="px-2 py-0.5 rounded bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-[9.5px] transition-colors cursor-pointer"
                      >
                        Auto-Fill Code
                      </button>
                    )}
                  </div>
                  <p className="text-slate-300">
                    {verificationType === 'email'
                      ? `Email Code: ${currentUser.devNotice.emailOtp || 'Dispatched to inbox'}`
                      : `SMS Code: ${currentUser.devNotice.phoneOtp || 'Dispatched via carrier'}`}
                  </p>
                  <p className="text-[9px] text-slate-400">
                    {currentUser.devNotice.info || 'In preview mode, codes are generated securely on the server.'}
                  </p>
                </div>
              )}

              {/* OTP Form */}
              <form onSubmit={handleVerifyCode} className="space-y-3">
                <div className="space-y-1">
                  <label className="text-[10px] font-semibold text-slate-400 uppercase font-mono flex items-center justify-between">
                    <span>Enter 6-Digit {verificationType === 'email' ? 'Email' : 'SMS'} Code</span>
                    <span className="text-slate-500 lowercase">6 digits</span>
                  </label>
                  <input
                    type="text"
                    maxLength={6}
                    required
                    value={otpCode}
                    onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                    placeholder="123456"
                    className="w-full text-center tracking-[0.4em] font-mono text-lg font-bold bg-slate-950 border border-slate-800 rounded-lg py-2.5 text-slate-100 focus:border-cyan-500 focus:outline-none"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading || otpCode.length !== 6}
                  className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs uppercase tracking-wider transition-all disabled:opacity-50 cursor-pointer shadow-lg shadow-emerald-950/30"
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>{loading ? 'Verifying...' : `Confirm ${verificationType === 'email' ? 'Email' : 'Phone'}`}</span>
                </button>
              </form>

              {/* Resend and Continue Controls */}
              <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px]">
                <button
                  type="button"
                  disabled={resendCooldown > 0 || loading}
                  onClick={handleResendCode}
                  className="text-cyan-400 hover:underline font-mono disabled:opacity-50 cursor-pointer"
                >
                  {resendCooldown > 0 ? `Resend Code in ${resendCooldown}s` : 'Resend Code'}
                </button>

                <button
                  type="button"
                  onClick={onClose}
                  className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800 font-bold transition-colors cursor-pointer text-xs"
                >
                  Continue to Trading Dashboard &rarr;
                </button>
              </div>
            </div>
          )}

          {/* ─────────────────────────────────────────────────────────────
              VIEW 4: FORGOT PASSWORD REQUEST
          ───────────────────────────────────────────────────────────── */}
          {mode === 'forgot' && (
            <form onSubmit={handleForgotPassword} className="space-y-3.5">
              <div className="space-y-1">
                <label className="text-[10px] font-semibold text-slate-400 uppercase font-mono">
                  Registered Email or Phone Number
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input
                    type="text"
                    required
                    value={forgotIdentifier}
                    onChange={(e) => setForgotIdentifier(e.target.value)}
                    placeholder="trader@domain.com or +14155552671"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-slate-100 text-xs focus:border-cyan-500 focus:outline-none"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs uppercase tracking-wider transition-all disabled:opacity-50 cursor-pointer"
              >
                <KeyRound className="w-3.5 h-3.5" />
                <span>{loading ? 'Sending Code...' : 'Send Password Reset Code'}</span>
              </button>

              <div className="text-center pt-1 text-[11px]">
                <button
                  type="button"
                  onClick={() => {
                    setMode('login');
                    setErrorMessage('');
                  }}
                  className="text-slate-400 hover:text-slate-200 cursor-pointer"
                >
                  &larr; Back to Sign In
                </button>
              </div>
            </form>
          )}

          {/* ─────────────────────────────────────────────────────────────
              VIEW 5: RESET PASSWORD CONFIRMATION
          ───────────────────────────────────────────────────────────── */}
          {mode === 'reset' && (
            <form onSubmit={handleResetPassword} className="space-y-3.5">
              <div className="space-y-1">
                <label className="text-[10px] font-semibold text-slate-400 uppercase font-mono">
                  6-Digit Reset Code
                </label>
                <input
                  type="text"
                  maxLength={6}
                  required
                  value={resetCode}
                  onChange={(e) => setResetCode(e.target.value)}
                  placeholder="123456"
                  className="w-full tracking-widest font-mono text-center bg-slate-950 border border-slate-800 rounded-lg py-2 text-slate-100 text-sm focus:border-cyan-500 focus:outline-none"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-semibold text-slate-400 uppercase font-mono">
                  New Password (Min 8 Chars)
                </label>
                <input
                  type="password"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 font-mono text-xs focus:border-cyan-500 focus:outline-none"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-semibold text-slate-400 uppercase font-mono">
                  Confirm New Password
                </label>
                <input
                  type="password"
                  required
                  value={confirmNewPassword}
                  onChange={(e) => setConfirmNewPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 font-mono text-xs focus:border-cyan-500 focus:outline-none"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs uppercase tracking-wider transition-all disabled:opacity-50 cursor-pointer"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>{loading ? 'Resetting Password...' : 'Save New Password'}</span>
              </button>

              <div className="text-center pt-1 text-[11px]">
                <button
                  type="button"
                  onClick={() => {
                    setMode('login');
                    setErrorMessage('');
                  }}
                  className="text-slate-400 hover:text-slate-200 cursor-pointer"
                >
                  &larr; Back to Sign In
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
