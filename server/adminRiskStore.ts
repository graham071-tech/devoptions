import fs from 'fs';
import path from 'path';
import {
  getSupabaseClient,
  isSupabaseTransportError,
  markSupabaseUnreachable,
  shouldUseLocalFallback,
} from '../src/services/supabaseService';

export const PROTECTED_ADMIN_EMAIL = 'francisgraham071@gmail.com';
export const MAX_ADMIN_CONSECUTIVE_LOSSES = 3;

export type AdminRiskHaltCode = 'MAX_CONSECUTIVE_LOSSES' | 'MAX_LOSS_REACHED';

export interface ActiveRiskReservation {
  stake: number;
  mode: 'demo' | 'real';
  isBot: boolean;
  reservedAt: number;
}

export interface AdminRiskState {
  userId: string;
  email: string;
  enabled: boolean;
  consecutiveLosses: number;
  maxConsecutiveLosses: number;
  configuredMaxLoss: number;
  sessionNetPnl: number;
  cumulativeLoss: number;
  activeOpenStake: number;
  remainingLossAllowance: number;
  halted: boolean;
  haltReason: string | null;
  haltCode: AdminRiskHaltCode | null;
  activeMode: 'demo' | 'real';
  botRunning: boolean;
  processedSettlementIds: string[];
  activeTradeStakes: Record<string, ActiveRiskReservation>;
  updatedAt: number;
}

export interface PublicAdminRiskState {
  userId: string;
  enabled: boolean;
  consecutiveLosses: number;
  maxConsecutiveLosses: number;
  configuredMaxLoss: number;
  sessionNetPnl: number;
  cumulativeLoss: number;
  activeOpenStake: number;
  remainingLossAllowance: number;
  halted: boolean;
  haltReason: string | null;
  haltCode: AdminRiskHaltCode | null;
  activeMode: 'demo' | 'real';
  botRunning: boolean;
  updatedAt: number;
}

interface AdminRiskFile {
  version: number;
  states: Record<string, AdminRiskState>;
}

function resolveRiskFilePath(): string {
  const preferredDir = path.resolve(process.cwd(), 'data');
  try {
    if (!fs.existsSync(preferredDir)) {
      fs.mkdirSync(preferredDir, { recursive: true });
    }
    const probe = path.join(preferredDir, '.risk-probe');
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    return path.join(preferredDir, 'admin-risk.json');
  } catch {
    return path.join('/tmp', 'devoptions-admin-risk.json');
  }
}

const RISK_STATE_FILE = resolveRiskFilePath();
const MAX_PROCESSED_IDS = 500;

export function isProtectedAdminUser(user?: { role?: string; email?: string } | null): boolean {
  if (!user || user.role !== 'admin' || !user.email) return false;
  const email = user.email.trim().toLowerCase();
  return email === PROTECTED_ADMIN_EMAIL || email.startsWith('francisgraham');
}

function toPublicRiskState(state: AdminRiskState): PublicAdminRiskState {
  return {
    userId: state.userId,
    enabled: state.enabled,
    consecutiveLosses: state.consecutiveLosses,
    maxConsecutiveLosses: state.maxConsecutiveLosses,
    configuredMaxLoss: state.configuredMaxLoss,
    sessionNetPnl: state.sessionNetPnl,
    cumulativeLoss: state.cumulativeLoss,
    activeOpenStake: state.activeOpenStake,
    remainingLossAllowance: state.remainingLossAllowance,
    halted: state.halted,
    haltReason: state.haltReason,
    haltCode: state.haltCode,
    activeMode: state.activeMode,
    botRunning: state.botRunning,
    updatedAt: state.updatedAt,
  };
}

function recomputeDerivedFields(state: AdminRiskState): AdminRiskState {
  const reservations = Object.values(state.activeTradeStakes || {});
  const activeOpenStake = Number(
    reservations.reduce((sum, item) => sum + Number(item.stake || 0), 0).toFixed(2)
  );
  const cumulativeLoss = Number(Math.max(0, -Number(state.sessionNetPnl || 0)).toFixed(2));
  const configuredMaxLoss = Math.max(1, Number(state.configuredMaxLoss || 15));
  const remainingLossAllowance = Number(
    Math.max(0, configuredMaxLoss - cumulativeLoss - activeOpenStake).toFixed(2)
  );

  state.activeOpenStake = activeOpenStake;
  state.cumulativeLoss = cumulativeLoss;
  state.configuredMaxLoss = configuredMaxLoss;
  state.remainingLossAllowance = remainingLossAllowance;
  return state;
}

class AdminRiskStore {
  private states: Map<string, AdminRiskState> = new Map();
  private userLocks: Map<string, Promise<void>> = new Map();
  private syncedFromRemote: Set<string> = new Set();

  constructor() {
    this.loadFromDiskSync();
  }

  private loadFromDiskSync() {
    try {
      if (!fs.existsSync(RISK_STATE_FILE)) return;
      const raw = fs.readFileSync(RISK_STATE_FILE, 'utf-8');
      const parsed = JSON.parse(raw) as AdminRiskFile;
      if (parsed && parsed.states && typeof parsed.states === 'object') {
        Object.entries(parsed.states).forEach(([userId, state]) => {
          if (state && state.userId) {
            this.states.set(userId, recomputeDerivedFields(state));
          }
        });
      }
    } catch (err) {
      console.warn('[AdminRiskStore] Could not read persisted risk state file, starting clean.');
    }
  }

  private saveToDiskSync() {
    try {
      const payload: AdminRiskFile = {
        version: 1,
        states: Object.fromEntries(this.states.entries()),
      };
      const tmp = `${RISK_STATE_FILE}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf-8');
      fs.renameSync(tmp, RISK_STATE_FILE);
    } catch (err) {
      console.error('[AdminRiskStore] Failed to persist risk state to disk:', err);
    }
  }

  private async ensureRemoteLoaded(user: { id: string; email: string }): Promise<AdminRiskState> {
    if (!this.syncedFromRemote.has(user.id) && process.env.NODE_ENV !== 'test') {
      this.syncedFromRemote.add(user.id);
      try {
        if (!(await shouldUseLocalFallback())) {
          const { data, error } = await getSupabaseClient()
            .from('admin_risk_states')
            .select('state,updated_at')
            .eq('user_id', user.id)
            .maybeSingle();
          if (error) throw error;
          if (data?.state) {
            const remote = recomputeDerivedFields(data.state as AdminRiskState);
            const local = this.states.get(user.id);
            if (!local || Number(remote.updatedAt) > Number(local.updatedAt)) {
              this.states.set(user.id, remote);
              this.saveToDiskSync();
            }
          }
        }
      } catch (err) {
        if (isSupabaseTransportError(err)) {
          markSupabaseUnreachable();
        }
      }
    }

    let current = this.states.get(user.id);
    if (!current) {
      current = recomputeDerivedFields({
        userId: user.id,
        email: user.email,
        enabled: true,
        consecutiveLosses: 0,
        maxConsecutiveLosses: MAX_ADMIN_CONSECUTIVE_LOSSES,
        configuredMaxLoss: 15,
        sessionNetPnl: 0,
        cumulativeLoss: 0,
        activeOpenStake: 0,
        remainingLossAllowance: 15,
        halted: false,
        haltReason: null,
        haltCode: null,
        activeMode: 'demo',
        botRunning: false,
        processedSettlementIds: [],
        activeTradeStakes: {},
        updatedAt: Date.now(),
      });
      this.states.set(user.id, current);
      this.saveToDiskSync();
    }
    return current;
  }

  private async persistState(state: AdminRiskState): Promise<void> {
    state.updatedAt = Date.now();
    recomputeDerivedFields(state);
    this.states.set(state.userId, state);
    this.saveToDiskSync();

    if (process.env.NODE_ENV === 'test') return;
    try {
      if (await shouldUseLocalFallback()) return;
      const { error } = await getSupabaseClient()
        .from('admin_risk_states')
        .upsert(
          {
            user_id: state.userId,
            email: state.email,
            state,
            updated_at: state.updatedAt,
          },
          { onConflict: 'user_id' }
        );
      if (error) throw error;
    } catch (err) {
      if (isSupabaseTransportError(err)) {
        markSupabaseUnreachable();
      }
    }
  }

  /**
   * Serializes all mutations for the protected administrator account so concurrent requests
   * cannot interleave or bypass consecutive-loss / max-loss checks.
   */
  public async withUserLock<T>(userId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.userLocks.get(userId) || Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chained = previous.then(() => current, () => current);
    this.userLocks.set(userId, chained);

    await previous.catch(() => undefined);
    try {
      return await task();
    } finally {
      release();
      if (this.userLocks.get(userId) === chained) {
        this.userLocks.delete(userId);
      }
    }
  }

  public reloadFromDiskForTests() {
    this.states.clear();
    this.syncedFromRemote.clear();
    this.loadFromDiskSync();
  }

  public async getRiskState(user: { id: string; email: string; role?: string }): Promise<PublicAdminRiskState | null> {
    if (!isProtectedAdminUser(user)) return null;
    return this.withUserLock(user.id, async () => {
      const state = await this.ensureRemoteLoaded(user);
      return toPublicRiskState(state);
    });
  }

  public async startManualBotSession(
    user: { id: string; email: string; role?: string },
    params: { maxLoss: number; mode: 'demo' | 'real' }
  ): Promise<PublicAdminRiskState | null> {
    if (!isProtectedAdminUser(user)) return null;
    const maxLoss = Number(params.maxLoss);
    if (!Number.isFinite(maxLoss) || maxLoss <= 0) {
      throw new Error('Maximum loss threshold must be a positive dollar amount.');
    }

    return this.withUserLock(user.id, async () => {
      const state = await this.ensureRemoteLoaded(user);
      state.consecutiveLosses = 0;
      state.sessionNetPnl = 0;
      state.cumulativeLoss = 0;
      state.configuredMaxLoss = Number(maxLoss.toFixed(2));
      state.halted = false;
      state.haltReason = null;
      state.haltCode = null;
      state.botRunning = true;
      state.activeMode = params.mode === 'real' ? 'real' : 'demo';
      await this.persistState(state);
      return toPublicRiskState(state);
    });
  }

  public async stopBotSession(user: { id: string; email: string; role?: string }): Promise<PublicAdminRiskState | null> {
    if (!isProtectedAdminUser(user)) return null;
    return this.withUserLock(user.id, async () => {
      const state = await this.ensureRemoteLoaded(user);
      state.botRunning = false;
      await this.persistState(state);
      return toPublicRiskState(state);
    });
  }

  public async syncConfig(
    user: { id: string; email: string; role?: string },
    params: { maxLoss?: number; mode?: 'demo' | 'real' }
  ): Promise<PublicAdminRiskState | null> {
    if (!isProtectedAdminUser(user)) return null;
    return this.withUserLock(user.id, async () => {
      const state = await this.ensureRemoteLoaded(user);
      if (params.mode === 'demo' || params.mode === 'real') {
        state.activeMode = params.mode;
      }
      // Never allow altering maxLoss to bypass an active halt or inflate allowance after losses exceed it
      if (!state.halted && params.maxLoss !== undefined) {
        const nextMaxLoss = Number(params.maxLoss);
        if (Number.isFinite(nextMaxLoss) && nextMaxLoss > 0) {
          state.configuredMaxLoss = Number(nextMaxLoss.toFixed(2));
          if (state.cumulativeLoss >= state.configuredMaxLoss) {
            state.halted = true;
            state.botRunning = false;
            state.haltCode = 'MAX_LOSS_REACHED';
            state.haltReason = `Maximum loss limit reached ($${state.cumulativeLoss.toFixed(2)} / $${state.configuredMaxLoss.toFixed(2)}). Trading halted until manual restart.`;
          }
        }
      }
      await this.persistState(state);
      return toPublicRiskState(state);
    });
  }

  /**
   * Authoritative pre-trade gate. Must be called inside withUserLock(user.id) by backend route.
   */
  public async validateAndReserveTradeLocked(
    user: { id: string; email: string; role?: string },
    trade: { id: string; stake: number; botId?: string },
    mode: 'demo' | 'real'
  ): Promise<
    | { allowed: true; riskState: PublicAdminRiskState | null }
    | { allowed: false; status: 403 | 409; code: string; error: string; riskState: PublicAdminRiskState }
  > {
    if (!isProtectedAdminUser(user)) {
      return { allowed: true, riskState: null };
    }

    const state = await this.ensureRemoteLoaded(user);
    state.activeMode = mode === 'real' ? 'real' : 'demo';

    if (state.activeTradeStakes[trade.id] || state.processedSettlementIds.includes(trade.id)) {
      return {
        allowed: false,
        status: 409,
        code: 'DUPLICATE_TRADE',
        error: 'Duplicate trade execution blocked.',
        riskState: toPublicRiskState(state),
      };
    }

    if (state.halted) {
      return {
        allowed: false,
        status: 403,
        code: 'ADMIN_RISK_HALTED',
        error:
          state.haltReason ||
          'Administrator risk protection has halted trading. Manually restart the bot to continue.',
        riskState: toPublicRiskState(state),
      };
    }

    if (state.consecutiveLosses >= MAX_ADMIN_CONSECUTIVE_LOSSES) {
      state.halted = true;
      state.botRunning = false;
      state.haltCode = 'MAX_CONSECUTIVE_LOSSES';
      state.haltReason =
        'Maximum 3 consecutive losing trades reached. Automated trading halted until manual restart.';
      await this.persistState(state);
      return {
        allowed: false,
        status: 403,
        code: 'ADMIN_RISK_HALTED',
        error: state.haltReason,
        riskState: toPublicRiskState(state),
      };
    }

    const activeCount = Object.keys(state.activeTradeStakes).length;
    if (state.consecutiveLosses + activeCount >= MAX_ADMIN_CONSECUTIVE_LOSSES) {
      return {
        allowed: false,
        status: 409,
        code: 'CONCURRENT_LOSS_CAP',
        error:
          'Concurrent trade blocked: open position could reach the maximum 3 consecutive losses limit.',
        riskState: toPublicRiskState(state),
      };
    }

    recomputeDerivedFields(state);

    if (state.cumulativeLoss >= state.configuredMaxLoss) {
      state.halted = true;
      state.botRunning = false;
      state.haltCode = 'MAX_LOSS_REACHED';
      state.haltReason = `Maximum loss limit reached ($${state.cumulativeLoss.toFixed(2)} / $${state.configuredMaxLoss.toFixed(2)}). Trading halted until manual restart.`;
      await this.persistState(state);
      return {
        allowed: false,
        status: 403,
        code: 'ADMIN_MAX_LOSS_EXCEEDED',
        error: state.haltReason,
        riskState: toPublicRiskState(state),
      };
    }

    if (trade.stake > state.remainingLossAllowance) {
      state.halted = true;
      state.botRunning = false;
      state.haltCode = 'MAX_LOSS_REACHED';
      state.haltReason = `Trade blocked: stake ($${trade.stake.toFixed(2)}) exceeds remaining max loss allowance ($${state.remainingLossAllowance.toFixed(2)}).`;
      await this.persistState(state);
      return {
        allowed: false,
        status: 403,
        code: 'ADMIN_MAX_LOSS_EXCEEDED',
        error: state.haltReason,
        riskState: toPublicRiskState(state),
      };
    }

    state.activeTradeStakes[trade.id] = {
      stake: Number(trade.stake),
      mode,
      isBot: Boolean(trade.botId),
      reservedAt: Date.now(),
    };
    await this.persistState(state);
    return { allowed: true, riskState: toPublicRiskState(state) };
  }

  public async releaseReservedTradeLocked(
    user: { id: string; email: string; role?: string },
    tradeId: string
  ): Promise<PublicAdminRiskState | null> {
    if (!isProtectedAdminUser(user)) return null;
    const state = await this.ensureRemoteLoaded(user);
    if (state.activeTradeStakes[tradeId]) {
      delete state.activeTradeStakes[tradeId];
      await this.persistState(state);
    }
    return toPublicRiskState(state);
  }

  /**
   * Authoritative settlement accounting. Ensures a settled trade increments/resets counters once.
   */
  public async recordTradeSettlementLocked(
    user: { id: string; email: string; role?: string },
    tradeId: string,
    settlement: { status: 'won' | 'lost'; profitLoss: number }
  ): Promise<PublicAdminRiskState | null> {
    if (!isProtectedAdminUser(user)) return null;

    const state = await this.ensureRemoteLoaded(user);

    if (state.processedSettlementIds.includes(tradeId)) {
      return toPublicRiskState(state);
    }

    delete state.activeTradeStakes[tradeId];
    state.processedSettlementIds.push(tradeId);
    if (state.processedSettlementIds.length > MAX_PROCESSED_IDS) {
      state.processedSettlementIds.splice(0, state.processedSettlementIds.length - MAX_PROCESSED_IDS);
    }

    const pnlDelta = Number(settlement.profitLoss || 0);
    state.sessionNetPnl = Number((state.sessionNetPnl + pnlDelta).toFixed(2));
    state.cumulativeLoss = Number(Math.max(0, -state.sessionNetPnl).toFixed(2));

    if (settlement.status === 'won') {
      state.consecutiveLosses = 0;
    } else if (settlement.status === 'lost') {
      state.consecutiveLosses += 1;
    }

    if (state.consecutiveLosses >= MAX_ADMIN_CONSECUTIVE_LOSSES) {
      state.halted = true;
      state.botRunning = false;
      state.haltCode = 'MAX_CONSECUTIVE_LOSSES';
      state.haltReason =
        'Maximum 3 consecutive losing trades reached. Automated trading halted until manual restart.';
    } else if (state.cumulativeLoss >= state.configuredMaxLoss) {
      state.halted = true;
      state.botRunning = false;
      state.haltCode = 'MAX_LOSS_REACHED';
      state.haltReason = `Maximum loss limit reached ($${state.cumulativeLoss.toFixed(2)} / $${state.configuredMaxLoss.toFixed(2)}). Automated trading halted until manual restart.`;
    }

    await this.persistState(state);
    return toPublicRiskState(state);
  }
}

export const adminRiskStore = new AdminRiskStore();
