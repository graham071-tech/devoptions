/**
 * Core type definitions for BinaryPro Trading Platform
 */

export type PageId =
  | 'home'
  | 'positions'
  // Compatibility aliases
  | 'trade'
  | 'dashboard'
  | 'trading'
  | 'analysis'
  | 'builder'
  | 'bots'
  | 'backtesting'
  | 'library'
  | 'history'
  | 'account'
  | 'settings'
  | 'help';

export interface Market {
  symbol: string;
  displayName: string;
  category: 'volatility' | 'daily_reset' | 'jump' | 'crash_boom' | 'step';
  decimals: number;
  pipSize: number;
  volatilityLabel: string;
  description: string;
  minStake: number;
  maxStake: number;
  payoutRate: number; // e.g. 0.95 for 95%
  isFavorite?: boolean;
}

export interface Tick {
  epoch: number;
  quote: number;
  symbol: string;
  direction: 'up' | 'down' | 'flat';
  lastDigit: number;
}

export interface Candle {
  epoch: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export type ContractType =
  | 'CALL' // Rise / Higher
  | 'PUT' // Fall / Lower
  | 'MATCHES'
  | 'DIFFERS'
  | 'EVEN'
  | 'ODD'
  | 'OVER'
  | 'UNDER'
  | 'TOUCH'
  | 'NOTOUCH';

export interface Trade {
  id: string;
  symbol: string;
  contractType: ContractType;
  stake: number;
  payoutRate: number;
  potentialPayout: number;
  entryTime: number;
  exitTime?: number;
  entryPrice: number;
  exitPrice?: number;
  targetDigit?: number;
  barrier?: number;
  status: 'active' | 'won' | 'lost';
  profitLoss: number;
  mode: 'demo' | 'real';
  durationTicks: number;
  remainingTicks: number;
  ticksRecorded: number[];
  strategyName?: string;
  botId?: string;
  isCopiedTrade?: boolean;
  copiedTraderName?: string;
}

export interface Transaction {
  id: string;
  type: 'deposit' | 'withdrawal';
  method: 'mpesa' | 'card' | 'bank';
  amountUSD: number;
  amountLocal?: number;
  localCurrency?: string;
  feeUSD: number;
  netAmountUSD: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  reference: string;
  createdAt: number;
  details: {
    phone?: string;
    cardLast4?: string;
    cardBrand?: string;
    bankName?: string;
    accountNumber?: string;
  };
}

export interface CopyTrader {
  id: string;
  name: string;
  handle: string;
  winRate: number;
  return30d: number;
  profitFactor: number;
  maxDrawdown: number;
  riskScore: 'Low' | 'Medium' | 'High';
  copiersCount: number;
  totalTrades: number;
  bio: string;
  preferredMarket: string;
  minAllocation: number;
}

export interface CopyAllocation {
  traderId: string;
  allocatedAmount: number;
  stopLossAmount: number;
  isPaused: boolean;
  startedAt: number;
  copiedTradesCount: number;
  profitEarned: number;
}

export interface UserProfile {
  name: string;
  email: string;
  currency: string;
  demoBalance: number;
  realBalance: number;
  copyTradingAllocated: number;
  isRealAuthorized: boolean;
  derivAppId: string;
  derivToken: string;
  soundEnabled: boolean;
  chartType: 'candles' | 'line';
  theme: 'obsidian' | 'navy';
  fastExecution: boolean;
  favorites: string[];
  marketDataProviderId?: string;
  marketDataEndpoint?: string;
  executionProviderId?: string;
  executionApiKey?: string;
}

// Strategy Builder Block Types
export type BlockCategory =
  | 'market'
  | 'indicator'
  | 'comparison'
  | 'logic'
  | 'action'
  | 'risk'
  | 'utility';

export type BlockType =
  | 'market_data'
  | 'indicator_rsi'
  | 'indicator_sma'
  | 'indicator_ema'
  | 'indicator_bollinger'
  | 'indicator_macd'
  | 'last_digit'
  | 'compare_greater'
  | 'compare_less'
  | 'compare_equal'
  | 'compare_cross_above'
  | 'compare_cross_below'
  | 'logic_and'
  | 'logic_or'
  | 'action_trade'
  | 'risk_management'
  | 'cooldown_rule';

export interface BlockPort {
  id: string;
  name: string;
  type: 'number' | 'boolean' | 'action' | 'any';
}

export interface StrategyBlock {
  id: string;
  type: BlockType;
  category: BlockCategory;
  title: string;
  position: { x: number; y: number };
  params: Record<string, any>;
  inputs: BlockPort[];
  outputs: BlockPort[];
}

export interface StrategyConnection {
  id: string;
  fromBlockId: string;
  fromPortId: string;
  toBlockId: string;
  toPortId: string;
}

export interface RiskLimits {
  maxStake: number;
  takeProfitTarget: number;
  stopLossLimit: number;
  maxConsecutiveLosses: number;
  cooldownSeconds: number;
}

export interface Strategy {
  id: string;
  name: string;
  description: string;
  marketSymbol: string;
  blocks: StrategyBlock[];
  connections: StrategyConnection[];
  riskLimits: RiskLimits;
  createdAt: number;
  updatedAt: number;
  isBuiltIn?: boolean;
}

export interface ValidationIssue {
  id: string;
  blockId?: string;
  severity: 'error' | 'warning';
  message: string;
}

export interface BacktestSettings {
  strategyId: string;
  symbol: string;
  sampleSize: number;
  initialBalance: number;
  stake: number;
  contractType: ContractType;
  durationTicks: number;
  payoutRate: number;
  applyMartingale: boolean;
  martingaleMultiplier: number;
}

export interface BacktestResult {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  initialBalance: number;
  finalBalance: number;
  netProfit: number;
  returnPercentage: number;
  profitFactor: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;
  trades: SimulatedBacktestTrade[];
  balanceCurve: { index: number; balance: number; tradePnl: number; isWin: boolean }[];
  monteCarloPaths?: number[][];
}

export interface SimulatedBacktestTrade {
  id: string;
  tradeIndex: number;
  timestamp: number;
  entryPrice: number;
  exitPrice: number;
  contractType: ContractType;
  stake: number;
  payout: number;
  pnl: number;
  balanceAfter: number;
  isWin: boolean;
  reason: string;
}

export interface BotAutomationState {
  status: 'idle' | 'running' | 'paused' | 'stopped';
  sessionProfit: number;
  tradesExecuted: number;
  wins: number;
  losses: number;
  consecutiveLosses: number;
  currentStake: number;
}

