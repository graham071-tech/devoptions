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
const ACTIVE_TRADES_KEY = 'devoptions_active_trades_v1';
const TRANSACTIONS_KEY = 'binarypro_transactions_v2';
const COPY_ALLOCATIONS_KEY = 'binarypro_copy_allocations_v2';
const SELECTED_MARKET_KEY = 'devoptions_selected_market_v1';
const TRADING_MODE_KEY = 'devoptions_trading_mode_v1';
const BOT_PREFS_KEY = 'devoptions_bot_prefs_v1';
const BOT_SESSION_KEY = 'devoptions_bot_session_v1';
const DIGIT_WINDOW_KEY = 'devoptions_digit_window_v1';

export interface PersistedBotPreferences {
  executionMode: 'automated' | 'manual';
  stake: number;
  contractType: Trade['contractType'];
  durationTicks: number;
  targetProfit: number;
  maxLoss: number;
}

export interface PersistedBotSession {
  botStatus: 'idle' | 'scanning' | 'ready' | 'running' | 'stopping' | 'stopped' | 'error';
  botPhase: string;
  stopReason: string;
  botSessionId: string;
  processedTradeIds: string[];
  botConfig: {
    targetProfit: number;
    maxLoss: number;
    stake: number;
    contractType: Trade['contractType'];
    durationTicks: number;
  } | null;
  sessionStats: {
    realizedPnl: number;
    tradesCount: number;
    wins: number;
    losses: number;
  };
}

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
  name: 'Trader',
  email: 'trader@devoptions.io',
  currency: 'USD',
  demoBalance: 10000.0,
  realBalance: 0.0,
  copyTradingAllocated: 0.0,
  isRealAuthorized: false,
  derivAppId: '1089',
  derivToken: '',
  soundEnabled: true,
  chartType: 'candles',
  theme: 'obsidian',
  fastExecution: true,
  favorites: ['R_100', '1HZ100V', 'R_75', 'CRASH500'],
};

const INITIAL_TRANSACTIONS: Transaction[] = [];

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
    if (trades.some((t) => t.id === trade.id)) {
      return trades;
    }
    trades.unshift(trade);
    const trimmed = trades.slice(0, 500);
    try {
      localStorage.setItem(TRADES_KEY, JSON.stringify(trimmed));
    } catch (e) {
      console.error('Failed to store trade', e);
    }
    return trimmed;
  }

  public getActiveTrades(): Trade[] {
    try {
      const data = localStorage.getItem(ACTIVE_TRADES_KEY);
      if (data) {
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
      // ignore
    }
    return [];
  }

  public saveActiveTrades(trades: Trade[]): void {
    try {
      localStorage.setItem(ACTIVE_TRADES_KEY, JSON.stringify(trades));
    } catch {
      // ignore
    }
  }

  public getSelectedMarketSymbol(): string {
    try {
      return localStorage.getItem(SELECTED_MARKET_KEY) || 'R_100';
    } catch {
      return 'R_100';
    }
  }

  public saveSelectedMarketSymbol(symbol: string): void {
    try {
      localStorage.setItem(SELECTED_MARKET_KEY, symbol);
    } catch {
      // ignore
    }
  }

  public getTradingMode(): 'demo' | 'real' {
    try {
      return localStorage.getItem(TRADING_MODE_KEY) === 'real' ? 'real' : 'demo';
    } catch {
      return 'demo';
    }
  }

  public saveTradingMode(mode: 'demo' | 'real'): void {
    try {
      localStorage.setItem(TRADING_MODE_KEY, mode);
    } catch {
      // ignore
    }
  }

  public getBotPreferences(): PersistedBotPreferences {
    const defaults: PersistedBotPreferences = {
      executionMode: 'automated',
      stake: 5,
      contractType: 'CALL',
      durationTicks: 5,
      targetProfit: 20,
      maxLoss: 15,
    };
    try {
      const raw = localStorage.getItem(BOT_PREFS_KEY);
      if (raw) {
        return { ...defaults, ...JSON.parse(raw) };
      }
    } catch {
      // ignore
    }
    return defaults;
  }

  public saveBotPreferences(prefs: PersistedBotPreferences): void {
    try {
      localStorage.setItem(BOT_PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // ignore
    }
  }

  public getBotSessionState(): PersistedBotSession | null {
    try {
      const raw = localStorage.getItem(BOT_SESSION_KEY);
      if (raw) return JSON.parse(raw);
    } catch {
      // ignore
    }
    return null;
  }

  public saveBotSessionState(state: PersistedBotSession | null): void {
    try {
      if (!state) localStorage.removeItem(BOT_SESSION_KEY);
      else localStorage.setItem(BOT_SESSION_KEY, JSON.stringify(state));
    } catch {
      // ignore
    }
  }

  public getDigitSampleWindow(): number {
    try {
      const v = Number(localStorage.getItem(DIGIT_WINDOW_KEY));
      if (v === 25 || v === 50 || v === 100) return v;
    } catch {
      // ignore
    }
    return 50;
  }

  public saveDigitSampleWindow(sz: number): void {
    try {
      localStorage.setItem(DIGIT_WINDOW_KEY, String(sz));
    } catch {
      // ignore
    }
  }

  public replaceTradeHistory(trades: Trade[]): void {
    try {
      localStorage.setItem(TRADES_KEY, JSON.stringify(trades.slice(0, 500)));
    } catch (e) {
      console.error('Failed to replace trade history', e);
    }
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

