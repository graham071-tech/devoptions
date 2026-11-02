import { PREBUILT_STRATEGIES } from '../data/prebuiltStrategies';
import {
  CopyAllocation,
  CopyTrader,
  Strategy,
  Trade,
  Transaction,
  UserProfile,
} from '../types/trading';

const USER_KEY = 'binarypro_user_profile_v2';
const STRATEGIES_KEY = 'binarypro_strategies_v2';
const TRADES_KEY = 'binarypro_trades_v2';
const TRANSACTIONS_KEY = 'binarypro_transactions_v2';
const COPY_ALLOCATIONS_KEY = 'binarypro_copy_allocations_v2';

export const VETTED_COPY_TRADERS: CopyTrader[] = [
  {
    id: 'trader_sarah',
    name: 'Sarah Kiprono',
    handle: '@sarah_scalps',
    winRate: 78.4,
    return30d: 46.8,
    profitFactor: 2.85,
    maxDrawdown: 7.2,
    riskScore: 'Low',
    copiersCount: 1420,
    totalTrades: 864,
    bio: 'Specialized in Volatility 100 mean-reversion with strict 1.5% fixed stake sizing.',
    preferredMarket: 'Volatility 100 Index',
    minAllocation: 20,
  },
  {
    id: 'trader_elena',
    name: 'Elena Rostova',
    handle: '@elena_quant',
    winRate: 81.2,
    return30d: 52.3,
    profitFactor: 3.10,
    maxDrawdown: 6.8,
    riskScore: 'Low',
    copiersCount: 2150,
    totalTrades: 640,
    bio: 'High-probability digit parity (Even/Odd) statistical equilibrium and streak exhaustion.',
    preferredMarket: 'Volatility 100 (1s) Index',
    minAllocation: 15,
  },
  {
    id: 'trader_david',
    name: 'David Mwangi',
    handle: '@dmwangi_fx',
    winRate: 72.1,
    return30d: 38.5,
    profitFactor: 2.30,
    maxDrawdown: 9.4,
    riskScore: 'Medium',
    copiersCount: 980,
    totalTrades: 1120,
    bio: 'Algorithmic EMA crossover and trend-following strategy on Volatility 75.',
    preferredMarket: 'Volatility 75 Index',
    minAllocation: 25,
  },
  {
    id: 'trader_tariq',
    name: 'Tariq Al-Mansoor',
    handle: '@tariq_scalper',
    winRate: 69.5,
    return30d: 31.2,
    profitFactor: 2.05,
    maxDrawdown: 11.0,
    riskScore: 'Medium',
    copiersCount: 740,
    totalTrades: 530,
    bio: 'Micro-scalping ticks on Crash 500 post-drop recovery cycles.',
    preferredMarket: 'Crash 500 Index',
    minAllocation: 30,
  },
];

const DEFAULT_PROFILE: UserProfile = {
  name: 'Alex Vance',
  email: 'trader@binarypro.site',
  currency: 'USD',
  demoBalance: 10000.0,
  realBalance: 150.0, // realistic initial real balance for demo/testing
  copyTradingAllocated: 0.0,
  isRealAuthorized: true,
  derivAppId: '1089',
  derivToken: '',
  soundEnabled: true,
  chartType: 'candles',
  theme: 'obsidian',
  fastExecution: true,
  favorites: ['R_100', '1HZ100V', 'R_75', 'CRASH500'],
};

const INITIAL_TRANSACTIONS: Transaction[] = [
  {
    id: 'tx_init_1',
    type: 'deposit',
    method: 'mpesa',
    amountUSD: 100,
    amountLocal: 13000,
    localCurrency: 'KES',
    feeUSD: 0,
    netAmountUSD: 100,
    status: 'completed',
    reference: 'QHK928172M',
    createdAt: Date.now() - 86400000 * 2,
    details: { phone: '+254712345678' },
  },
  {
    id: 'tx_init_2',
    type: 'deposit',
    method: 'card',
    amountUSD: 50,
    feeUSD: 0,
    netAmountUSD: 50,
    status: 'completed',
    reference: 'CHG_8471928',
    createdAt: Date.now() - 86400000,
    details: { cardLast4: '4242', cardBrand: 'Visa' },
  },
];

class StorageService {
  public getUserProfile(): UserProfile {
    try {
      const data = localStorage.getItem(USER_KEY);
      if (data) {
        return { ...DEFAULT_PROFILE, ...JSON.parse(data) };
      }
    } catch (e) {
      console.error('Failed to load user profile from localStorage', e);
    }
    return DEFAULT_PROFILE;
  }

  public saveUserProfile(profile: UserProfile): void {
    try {
      localStorage.setItem(USER_KEY, JSON.stringify(profile));
    } catch (e) {
      console.error('Failed to save user profile', e);
    }
  }

  public resetDemoBalance(amount: number = 10000.0): UserProfile {
    const profile = this.getUserProfile();
    profile.demoBalance = amount;
    this.saveUserProfile(profile);
    return profile;
  }

  public getStrategies(): Strategy[] {
    try {
      const data = localStorage.getItem(STRATEGIES_KEY);
      if (data) {
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch (e) {
      console.error('Failed to load strategies', e);
    }
    this.saveStrategies(PREBUILT_STRATEGIES);
    return PREBUILT_STRATEGIES;
  }

  public saveStrategies(strategies: Strategy[]): void {
    try {
      localStorage.setItem(STRATEGIES_KEY, JSON.stringify(strategies));
    } catch (e) {
      console.error('Failed to save strategies', e);
    }
  }

  public saveStrategy(strategy: Strategy): Strategy[] {
    const all = this.getStrategies();
    const index = all.findIndex((s) => s.id === strategy.id);
    if (index >= 0) {
      all[index] = { ...strategy, updatedAt: Date.now() };
    } else {
      all.unshift({ ...strategy, createdAt: Date.now(), updatedAt: Date.now() });
    }
    this.saveStrategies(all);
    return all;
  }

  public deleteStrategy(id: string): Strategy[] {
    const all = this.getStrategies().filter((s) => s.id !== id);
    this.saveStrategies(all);
    return all;
  }

  public getTradeHistory(): Trade[] {
    try {
      const data = localStorage.getItem(TRADES_KEY);
      if (data) {
        return JSON.parse(data);
      }
    } catch (e) {
      console.error('Failed to load trades', e);
    }
    return [];
  }

  public addTrade(trade: Trade): Trade[] {
    const trades = this.getTradeHistory();
    trades.unshift(trade);
    const trimmed = trades.slice(0, 500);
    try {
      localStorage.setItem(TRADES_KEY, JSON.stringify(trimmed));
    } catch (e) {
      console.error('Failed to store trade', e);
    }
    return trimmed;
  }

  public clearTradeHistory(): void {
    try {
      localStorage.removeItem(TRADES_KEY);
    } catch (e) {
      // ignore
    }
  }

  // Transactions Ledger
  public getTransactions(): Transaction[] {
    try {
      const data = localStorage.getItem(TRANSACTIONS_KEY);
      if (data) {
        return JSON.parse(data);
      }
    } catch (e) {
      console.error('Failed to load transactions', e);
    }
    this.saveTransactions(INITIAL_TRANSACTIONS);
    return INITIAL_TRANSACTIONS;
  }

  public saveTransactions(txs: Transaction[]): void {
    try {
      localStorage.setItem(TRANSACTIONS_KEY, JSON.stringify(txs));
    } catch (e) {
      console.error('Failed to save transactions', e);
    }
  }

  public addTransaction(tx: Transaction): Transaction[] {
    const all = this.getTransactions();
    all.unshift(tx);
    this.saveTransactions(all);
    return all;
  }

  public updateTransaction(txId: string, updates: Partial<Transaction>): Transaction[] {
    const all = this.getTransactions();
    const idx = all.findIndex((t) => t.id === txId);
    if (idx >= 0) {
      all[idx] = { ...all[idx], ...updates };
      this.saveTransactions(all);
    }
    return all;
  }

  // Copy Trading
  public getCopyTraders(): CopyTrader[] {
    return VETTED_COPY_TRADERS;
  }

  public getCopyAllocations(): CopyAllocation[] {
    try {
      const data = localStorage.getItem(COPY_ALLOCATIONS_KEY);
      if (data) {
        return JSON.parse(data);
      }
    } catch (e) {
      console.error('Failed to load copy allocations', e);
    }
    return [];
  }

  public saveCopyAllocation(allocation: CopyAllocation): CopyAllocation[] {
    const all = this.getCopyAllocations();
    const idx = all.findIndex((a) => a.traderId === allocation.traderId);
    if (idx >= 0) {
      all[idx] = allocation;
    } else {
      all.push(allocation);
    }
    try {
      localStorage.setItem(COPY_ALLOCATIONS_KEY, JSON.stringify(all));
    } catch (e) {
      // ignore
    }

    // Update profile copyTradingAllocated sum
    const totalAllocated = all.reduce((sum, a) => sum + (a.isPaused ? 0 : a.allocatedAmount), 0);
    const profile = this.getUserProfile();
    profile.copyTradingAllocated = totalAllocated;
    this.saveUserProfile(profile);

    return all;
  }

  public saveCopyAllocations(allocations: CopyAllocation[]): void {
    try {
      localStorage.setItem(COPY_ALLOCATIONS_KEY, JSON.stringify(allocations));
    } catch (e) {
      // ignore
    }
  }


  public clearHistory(): void {
    this.clearTradeHistory();
  }

  public exportBackup(): string {
    const backup = {
      profile: this.getUserProfile(),
      strategies: this.getStrategies(),
      trades: this.getTradeHistory(),
      transactions: this.getTransactions(),
      copyAllocations: this.getCopyAllocations(),
      version: 2,
      exportedAt: Date.now(),
    };
    return JSON.stringify(backup, null, 2);
  }

  public importBackup(jsonString: string): boolean {
    try {
      const parsed = JSON.parse(jsonString);
      if (parsed.profile) this.saveUserProfile(parsed.profile);
      if (parsed.strategies) this.saveStrategies(parsed.strategies);
      if (parsed.trades) localStorage.setItem(TRADES_KEY, JSON.stringify(parsed.trades));
      if (parsed.transactions) this.saveTransactions(parsed.transactions);
      if (parsed.copyAllocations) this.saveCopyAllocations(parsed.copyAllocations);
      return true;
    } catch (e) {
      console.error('Failed to import backup:', e);
      return false;
    }
  }

  public removeCopyAllocation(traderId: string): CopyAllocation[] {
    const all = this.getCopyAllocations().filter((a) => a.traderId !== traderId);
    try {
      localStorage.setItem(COPY_ALLOCATIONS_KEY, JSON.stringify(all));
    } catch (e) {
      // ignore
    }

    const totalAllocated = all.reduce((sum, a) => sum + (a.isPaused ? 0 : a.allocatedAmount), 0);
    const profile = this.getUserProfile();
    profile.copyTradingAllocated = totalAllocated;
    this.saveUserProfile(profile);

    return all;
  }
}

export const storage = new StorageService();

