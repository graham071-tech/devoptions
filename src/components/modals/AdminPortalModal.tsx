import React, { useState, useEffect } from 'react';
import {
  authClient,
  AuthUser,
  AdminMetrics,
  AdminUserRecord,
} from '../../services/authClient';
import { useToast } from '../common/ToastNotification';
import {
  X,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Users,
  TrendingUp,
  Activity,
  DollarSign,
  UserPlus,
  RefreshCw,
  KeyRound,
  Copy,
  Check,
  Trash2,
  ArrowUpRight,
  Search,
  Lock,
  Mail,
  Phone,
  Crown,
  Eye,
  EyeOff,
  UserCheck,
} from 'lucide-react';

interface AdminPortalModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: AuthUser | null;
  onOpenAuthModal?: () => void;
}

export const AdminPortalModal: React.FC<AdminPortalModalProps> = ({
  isOpen,
  onClose,
  currentUser,
}) => {
  const { showToast } = useToast();

  const [activeTab, setActiveTab] = useState<'users' | 'metrics' | 'new-admin'>('users');
  const [metrics, setMetrics] = useState<AdminMetrics | null>(null);
  const [users, setUsers] = useState<AdminUserRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // New admin form state
  const [newAdminEmail, setNewAdminEmail] = useState<string>('');
  const [newAdminPhone, setNewAdminPhone] = useState<string>('+18005550199');
  const [newAdminPassword, setNewAdminPassword] = useState<string>('Admin@DevOptions2026!');
  const [newAdminName, setNewAdminName] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [creatingAdmin, setCreatingAdmin] = useState<boolean>(false);

  // Balance adjustment state
  const [adjustingUserId, setAdjustingUserId] = useState<string | null>(null);
  const [adjustAmount, setAdjustAmount] = useState<string>('1000');
  const [adjustType, setAdjustType] = useState<'demo' | 'real'>('demo');

  const isAdmin = currentUser?.role === 'admin';

  const loadData = async () => {
    if (!isAdmin) return;
    setLoading(true);
    try {
      const [overviewData, userList] = await Promise.all([
        authClient.getAdminOverview(),
        authClient.getAdminUsers(),
      ]);
      setMetrics(overviewData.metrics);
      setUsers(userList);
    } catch (err: any) {
      showToast('error', 'Admin Access Error', err.message || 'Failed to load administrator data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && isAdmin) {
      loadData();
    }
  }, [isOpen, isAdmin]);

  if (!isOpen) return null;

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    showToast('info', 'Copied to Clipboard', text);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleToggleRole = async (user: AdminUserRecord) => {
    const newRole = user.role === 'admin' ? 'user' : 'admin';
    try {
      await authClient.updateUserRole(user.id, newRole);
      showToast('success', 'Role Updated', `${user.email} is now a ${newRole.toUpperCase()}.`);
      loadData();
    } catch (err: any) {
      showToast('error', 'Update Failed', err.message || 'Could not update user role');
    }
  };

  const handleAdjustBalance = async (userId: string) => {
    const amt = parseFloat(adjustAmount);
    if (isNaN(amt) || amt <= 0) {
      showToast('error', 'Invalid Amount', 'Please provide a valid balance number');
      return;
    }
    try {
      await authClient.adjustUserBalance(userId, adjustType, amt, 'add');
      showToast('success', 'Funds Deposited', `Added $${amt.toLocaleString()} to ${adjustType.toUpperCase()} account.`);
      setAdjustingUserId(null);
      loadData();
    } catch (err: any) {
      showToast('error', 'Action Failed', err.message);
    }
  };

  const handleDeleteUser = async (user: AdminUserRecord) => {
    if (user.id === currentUser?.id) {
      showToast('error', 'Operation Denied', 'You cannot delete your own active administrator account.');
      return;
    }

    if (!window.confirm(`Are you sure you want to delete account: ${user.email}? This cannot be undone.`)) {
      return;
    }

    try {
      await authClient.deleteUser(user.id);
      showToast('success', 'Account Deleted', `Account ${user.email} removed.`);
      loadData();
    } catch (err: any) {
      showToast('error', 'Delete Failed', err.message);
    }
  };

  const handleCreateAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAdminEmail || !newAdminPassword) {
      showToast('error', 'Missing Data', 'Email and password are required');
      return;
    }
    setCreatingAdmin(true);
    try {
      await authClient.createAdminAccount({
        email: newAdminEmail,
        phone: newAdminPhone,
        password: newAdminPassword,
        fullName: newAdminName || 'DevOptions Administrator',
      });
      showToast('success', 'Admin Created', `Administrator account ${newAdminEmail} has been provisioned.`);
      setNewAdminEmail('');
      setNewAdminName('');
      setActiveTab('users');
      loadData();
    } catch (err: any) {
      showToast('error', 'Creation Failed', err.message);
    } finally {
      setCreatingAdmin(false);
    }
  };

  const filteredUsers = users.filter((u) => {
    const q = searchQuery.toLowerCase();
    return (
      u.email.toLowerCase().includes(q) ||
      u.phone.toLowerCase().includes(q) ||
      (u.fullName && u.fullName.toLowerCase().includes(q)) ||
      u.role.toLowerCase().includes(q)
    );
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/85 backdrop-blur-md animate-in fade-in duration-150">
      <div className="bg-[#0A0E18] border border-amber-500/30 rounded-2xl w-full max-w-4xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden text-slate-100">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-800 bg-gradient-to-r from-amber-950/30 via-slate-900 to-slate-950 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-500 to-amber-700 flex items-center justify-center text-slate-950 shadow-lg shadow-amber-900/40">
              <Crown className="w-5 h-5 fill-current" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-extrabold tracking-wide text-white">
                  DevOptions Admin Portal
                </h2>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 uppercase">
                  ROOT PRIVILEGES
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Logged in as <span className="text-amber-400 font-mono font-semibold">{currentUser?.email || 'admin@devoptions.io'}</span> (Role: Admin)
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={loadData}
              disabled={loading}
              title="Refresh Data"
              className="p-1.5 text-slate-400 hover:text-slate-100 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-amber-400' : ''}`} />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-100 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Admin Quick Credentials Banner */}
        <div className="bg-amber-950/20 border-b border-amber-900/30 px-5 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-amber-400 shrink-0" />
            <span className="text-slate-300 text-[11px]">
              <strong className="text-amber-300">Admin Login Credentials:</strong> Email: <code className="text-slate-100 bg-slate-900/80 px-1 py-0.5 rounded font-mono">admin@devoptions.io</code> or <code className="text-slate-100 bg-slate-900/80 px-1 py-0.5 rounded font-mono">francisgraham071@gmail.com</code> | Password: <code className="text-slate-100 bg-slate-900/80 px-1 py-0.5 rounded font-mono">Admin@DevOptions2026!</code>
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => copyToClipboard('admin@devoptions.io', 'email')}
              className="px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 text-[10px] font-mono border border-slate-700 text-slate-300 flex items-center gap-1 transition-colors cursor-pointer"
            >
              {copiedKey === 'email' ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              <span>Copy Email</span>
            </button>
            <button
              onClick={() => copyToClipboard('Admin@DevOptions2026!', 'pwd')}
              className="px-2 py-1 rounded bg-slate-900 hover:bg-slate-800 text-[10px] font-mono border border-slate-700 text-slate-300 flex items-center gap-1 transition-colors cursor-pointer"
            >
              {copiedKey === 'pwd' ? <Check className="w-3 h-3 text-emerald-400" /> : <KeyRound className="w-3 h-3" />}
              <span>Copy Password</span>
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="px-5 pt-3 border-b border-slate-800/80 flex items-center gap-2 bg-slate-950/40 text-xs shrink-0">
          <button
            onClick={() => setActiveTab('users')}
            className={`flex items-center gap-2 px-3 py-2 font-semibold border-b-2 transition-colors cursor-pointer ${
              activeTab === 'users'
                ? 'border-amber-400 text-amber-300 bg-slate-900/40'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>User Accounts ({users.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('metrics')}
            className={`flex items-center gap-2 px-3 py-2 font-semibold border-b-2 transition-colors cursor-pointer ${
              activeTab === 'metrics'
                ? 'border-amber-400 text-amber-300 bg-slate-900/40'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>Platform Metrics</span>
          </button>
          <button
            onClick={() => setActiveTab('new-admin')}
            className={`flex items-center gap-2 px-3 py-2 font-semibold border-b-2 transition-colors cursor-pointer ${
              activeTab === 'new-admin'
                ? 'border-amber-400 text-amber-300 bg-slate-900/40'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>Provision New Admin</span>
          </button>
        </div>

        {/* Tab Content */}
        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          {/* TAB 1: USER ACCOUNTS DIRECTORY */}
          {activeTab === 'users' && (
            <div className="space-y-4">
              {/* Search & Actions Bar */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
                <div className="relative w-full sm:w-80">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search by email, phone, or name..."
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-amber-500"
                  />
                </div>
                <div className="text-[11px] text-slate-400 flex items-center gap-2">
                  <span>Showing <strong>{filteredUsers.length}</strong> registered traders</span>
                </div>
              </div>

              {/* Users Table */}
              <div className="border border-slate-800/90 rounded-xl overflow-hidden bg-slate-950/60 shadow-lg">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="bg-slate-900/80 border-b border-slate-800 text-[10px] font-mono text-slate-400 uppercase tracking-wider">
                        <th className="py-2.5 px-3">Trader Identity</th>
                        <th className="py-2.5 px-3">Role</th>
                        <th className="py-2.5 px-3">Verification</th>
                        <th className="py-2.5 px-3">Balances (Demo / Real)</th>
                        <th className="py-2.5 px-3 text-right">Administrative Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
                      {filteredUsers.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-8 text-center text-slate-500 font-sans">
                            No accounts match your query.
                          </td>
                        </tr>
                      ) : (
                        filteredUsers.map((user) => {
                          const isSelf = user.id === currentUser?.id;
                          return (
                            <tr key={user.id} className="hover:bg-slate-900/40 transition-colors">
                              {/* Identifier */}
                              <td className="py-3 px-3">
                                <div className="font-sans font-semibold text-slate-100">
                                  {user.email}
                                </div>
                                <div className="text-[10px] text-slate-500 flex items-center gap-2">
                                  <span>{user.phone}</span>
                                  {user.fullName && (
                                    <span className="text-slate-400">• {user.fullName}</span>
                                  )}
                                </div>
                              </td>

                              {/* Role */}
                              <td className="py-3 px-3">
                                {user.role === 'admin' ? (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold text-[10px]">
                                    <Crown className="w-3 h-3 fill-current" />
                                    ADMIN
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700 text-[10px]">
                                    TRADER
                                  </span>
                                )}
                              </td>

                              {/* Verification */}
                              <td className="py-3 px-3">
                                <div className="flex items-center gap-1.5">
                                  <span
                                    title={`Email: ${user.emailVerified ? 'Verified' : 'Pending'}`}
                                    className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                                      user.emailVerified
                                        ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-800/60'
                                        : 'bg-rose-950/80 text-rose-400 border border-rose-800/60'
                                    }`}
                                  >
                                    EMAIL: {user.emailVerified ? '✓' : '✗'}
                                  </span>
                                  <span
                                    title={`Phone: ${user.phoneVerified ? 'Verified' : 'Pending'}`}
                                    className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                                      user.phoneVerified
                                        ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-800/60'
                                        : 'bg-rose-950/80 text-rose-400 border border-rose-800/60'
                                    }`}
                                  >
                                    PHONE: {user.phoneVerified ? '✓' : '✗'}
                                  </span>
                                </div>
                              </td>

                              {/* Balances */}
                              <td className="py-3 px-3">
                                <div>
                                  <span className="text-cyan-400 font-bold">
                                    ${user.demoBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                  </span>
                                  <span className="text-slate-500 text-[9px] ml-1">DEMO</span>
                                </div>
                                <div>
                                  <span className="text-emerald-400 font-bold">
                                    ${user.realBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                  </span>
                                  <span className="text-slate-500 text-[9px] ml-1">REAL</span>
                                </div>
                              </td>

                              {/* Actions */}
                              <td className="py-3 px-3 text-right">
                                <div className="flex items-center justify-end gap-1.5">
                                  {/* Balance Inject */}
                                  <button
                                    onClick={() => setAdjustingUserId(adjustingUserId === user.id ? null : user.id)}
                                    className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px] font-sans font-semibold border border-slate-700 transition-colors cursor-pointer"
                                  >
                                    +/- Funds
                                  </button>

                                  {/* Toggle Role */}
                                  <button
                                    onClick={() => handleToggleRole(user)}
                                    disabled={isSelf && user.role === 'admin'}
                                    title={isSelf ? 'Cannot demote yourself' : 'Toggle user/admin role'}
                                    className={`px-2 py-1 rounded text-[10px] font-sans font-semibold transition-colors cursor-pointer ${
                                      user.role === 'admin'
                                        ? 'bg-amber-500/10 text-amber-300 border border-amber-500/30 hover:bg-amber-500/20 disabled:opacity-40'
                                        : 'bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700'
                                    }`}
                                  >
                                    {user.role === 'admin' ? 'Make Trader' : 'Make Admin'}
                                  </button>

                                  {/* Delete */}
                                  <button
                                    onClick={() => handleDeleteUser(user)}
                                    disabled={isSelf}
                                    title={isSelf ? 'Cannot delete self' : 'Delete user'}
                                    className="p-1 rounded text-rose-400 hover:bg-rose-950/40 border border-rose-900/40 disabled:opacity-30 transition-colors cursor-pointer"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>

                                {/* Inline Balance Adjust Drawer */}
                                {adjustingUserId === user.id && (
                                  <div className="mt-2 p-2 bg-slate-900 rounded-lg border border-slate-700 text-left space-y-2">
                                    <div className="flex items-center gap-2">
                                      <select
                                        value={adjustType}
                                        onChange={(e) => setAdjustType(e.target.value as any)}
                                        className="bg-slate-950 border border-slate-700 rounded px-1.5 py-1 text-[10px] text-slate-200 font-mono"
                                      >
                                        <option value="demo">Demo Account</option>
                                        <option value="real">Real Account</option>
                                      </select>
                                      <input
                                        type="number"
                                        value={adjustAmount}
                                        onChange={(e) => setAdjustAmount(e.target.value)}
                                        placeholder="Amount ($)"
                                        className="w-24 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-[10px] text-slate-200 font-mono"
                                      />
                                      <button
                                        onClick={() => handleAdjustBalance(user.id)}
                                        className="px-2 py-1 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold rounded text-[10px] cursor-pointer"
                                      >
                                        Deposit
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: SYSTEM METRICS */}
          {activeTab === 'metrics' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div className="p-4 rounded-xl bg-slate-900/70 border border-slate-800">
                  <span className="text-[10px] font-mono uppercase text-slate-500">Total Registered Users</span>
                  <div className="text-2xl font-black text-slate-100 mt-1">
                    {metrics?.totalUsers ?? users.length}
                  </div>
                  <span className="text-[10px] text-emerald-400 mt-0.5 block">
                    {metrics?.verifiedUsers ?? 0} Fully Verified
                  </span>
                </div>

                <div className="p-4 rounded-xl bg-slate-900/70 border border-slate-800">
                  <span className="text-[10px] font-mono uppercase text-slate-500">Administrator Accounts</span>
                  <div className="text-2xl font-black text-amber-400 mt-1">
                    {metrics?.adminsCount ?? 2}
                  </div>
                  <span className="text-[10px] text-slate-400 mt-0.5 block">
                    Full console management
                  </span>
                </div>

                <div className="p-4 rounded-xl bg-slate-900/70 border border-slate-800">
                  <span className="text-[10px] font-mono uppercase text-slate-500">Active User Sessions</span>
                  <div className="text-2xl font-black text-cyan-400 mt-1">
                    {metrics?.activeSessions ?? 1}
                  </div>
                  <span className="text-[10px] text-slate-400 mt-0.5 block">
                    Live authenticated tokens
                  </span>
                </div>

                <div className="p-4 rounded-xl bg-slate-900/70 border border-slate-800">
                  <span className="text-[10px] font-mono uppercase text-slate-500">Total Trades Processed</span>
                  <div className="text-2xl font-black text-indigo-400 mt-1">
                    {metrics?.totalTrades ?? 0}
                  </div>
                  <span className="text-[10px] text-slate-400 mt-0.5 block">
                    Persisted in database
                  </span>
                </div>

                <div className="p-4 rounded-xl bg-slate-900/70 border border-slate-800">
                  <span className="text-[10px] font-mono uppercase text-slate-500">Total Volume Staged</span>
                  <div className="text-2xl font-black text-emerald-400 mt-1">
                    ${(metrics?.totalVolume ?? 0).toLocaleString()}
                  </div>
                  <span className="text-[10px] text-slate-400 mt-0.5 block">
                    Cumulative execution stake
                  </span>
                </div>

                <div className="p-4 rounded-xl bg-slate-900/70 border border-slate-800">
                  <span className="text-[10px] font-mono uppercase text-slate-500">Platform Net P&amp;L</span>
                  <div className={`text-2xl font-black mt-1 ${
                    (metrics?.netProfitLoss ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`}>
                    ${(metrics?.netProfitLoss ?? 0).toLocaleString()}
                  </div>
                  <span className="text-[10px] text-slate-400 mt-0.5 block">
                    Trader settlement balance
                  </span>
                </div>
              </div>

              {/* Admin Accounts Table */}
              <div className="p-4 rounded-xl bg-slate-900/40 border border-slate-800 space-y-2">
                <h3 className="text-xs font-bold text-slate-200 uppercase font-mono flex items-center gap-2">
                  <Crown className="w-4 h-4 text-amber-400" />
                  <span>Authorized Administrator Accounts</span>
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div className="p-3 bg-slate-950 rounded-lg border border-slate-800 text-xs">
                    <div className="font-bold text-amber-300">Master Root Admin</div>
                    <div className="text-slate-300 font-mono text-[11px] mt-0.5">admin@devoptions.io</div>
                    <div className="text-slate-500 text-[10px] mt-1">Phone: +1 (800) 555-0199 • Default: Admin@DevOptions2026!</div>
                  </div>
                  <div className="p-3 bg-slate-950 rounded-lg border border-slate-800 text-xs">
                    <div className="font-bold text-amber-300">Dedicated Platform Admin</div>
                    <div className="text-slate-300 font-mono text-[11px] mt-0.5">francisgraham071@gmail.com</div>
                    <div className="text-slate-500 text-[10px] mt-1">Phone: +1 (234) 567-8900 • Default: Admin@DevOptions2026!</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: PROVISION NEW ADMIN */}
          {activeTab === 'new-admin' && (
            <div className="max-w-lg mx-auto p-4 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-4">
              <div className="text-center space-y-1">
                <div className="inline-flex p-2.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 mb-1">
                  <UserPlus className="w-5 h-5" />
                </div>
                <h3 className="text-sm font-bold text-slate-100">Provision Administrator Account</h3>
                <p className="text-[11px] text-slate-400">
                  Create a new platform administrator with verified credentials and full management rights.
                </p>
              </div>

              <form onSubmit={handleCreateAdmin} className="space-y-3 pt-2 text-xs">
                <div className="space-y-1">
                  <label className="text-[10px] font-semibold text-slate-400 uppercase font-mono">
                    Admin Email Address
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <input
                      type="email"
                      required
                      value={newAdminEmail}
                      onChange={(e) => setNewAdminEmail(e.target.value)}
                      placeholder="admin2@devoptions.io"
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-slate-100 focus:outline-none focus:border-amber-500"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-semibold text-slate-400 uppercase font-mono">
                    Full Name (Optional)
                  </label>
                  <input
                    type="text"
                    value={newAdminName}
                    onChange={(e) => setNewAdminName(e.target.value)}
                    placeholder="Operations Lead"
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-semibold text-slate-400 uppercase font-mono">
                    Phone Number
                  </label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <input
                      type="text"
                      value={newAdminPhone}
                      onChange={(e) => setNewAdminPhone(e.target.value)}
                      placeholder="+14155552671"
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-9 pr-3 py-2 text-slate-100 font-mono focus:outline-none focus:border-amber-500"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-semibold text-slate-400 uppercase font-mono">
                    Initial Password
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      value={newAdminPassword}
                      onChange={(e) => setNewAdminPassword(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-9 pr-9 py-2 text-slate-100 font-mono focus:outline-none focus:border-amber-500"
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

                <button
                  type="submit"
                  disabled={creatingAdmin}
                  className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-slate-950 font-bold text-xs uppercase tracking-wider transition-all shadow-lg shadow-amber-950/40 cursor-pointer disabled:opacity-50 mt-2"
                >
                  {creatingAdmin ? 'Provisioning...' : 'Provision Administrator Account'}
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
