import fs from 'fs';
import path from 'path';
import {
  getSupabaseClient,
  isSupabaseTransportError,
  markSupabaseUnreachable,
  shouldUseLocalFallback,
} from '../src/services/supabaseService.js';

export const PROTECTED_ADMIN_EMAIL = 'francisgraham071@gmail.com';
export const MAX_ADMIN_CONSECUTIVE_LOSSES = 3;
export const MAX_ADMIN_TOTAL_LOSSES = 5;

export type AdminRiskHaltCode =
  | 'MAX_CONSECUTIVE_LOSSES'
  | 'MAX_TOTAL_LOSSES'
  | 'MAX_LOSS_REACHED';

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
  totalLosses: number;
  maxTotalLosses: number;
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
  periodStartedAt: number;
  periodResetCount: number;
  revision: number;
  processedSettlementIds: string[];
  activeTradeStakes: Record<string, ActiveRiskReservation>;
  updatedAt: number;
}

export interface PublicAdminRiskState {
  userId: string;
  enabled: boolean;
  consecutiveLosses: number;
  maxConsecutiveLosses: number;
  totalLosses: number;
  maxTotalLosses: number;
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
  periodStartedAt: number;
  periodResetCount: number;
  updatedAt: number;
}

export class RiskSessionError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly riskState: PublicAdminRiskState | null;

  constructor(
    status: number,
    code: string,
    message: string,
    riskState: PublicAdminRiskState | null = null
  ) {
    super(message);
    this.name = 'RiskSessionError';
    this.status = status;
    this.code = code;
    this.riskState = riskState;
  }
}

interface AdminRiskFile {
  version: number;
  states: Record<string, AdminRiskState>;
}

function resolveRiskFilePath(): string {
  if (process.env.VERCEL && process.env.NODE_ENV !== 'test') {
    return path.join('/tmp', 'devoptions-admin-risk.json');
  }
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
    totalLosses: state.totalLosses,
    maxTotalLosses: state.maxTotalLosses,
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
    periodStartedAt: state.periodStartedAt,
    periodResetCount: state.periodResetCount,
    updatedAt: state.updatedAt,
  };
}

function recomputeDerivedFields(raw: Partial<AdminRiskState>, fallbackEmail = ''): AdminRiskState {
  const now = Date.now();
  const activeTradeStakes =
    raw.activeTradeStakes && typeof raw.activeTradeStakes === 'object'
      ? raw.activeTradeStakes
      : {};
  const reservations = Object.values(activeTradeStakes);
  const activeOpenStake = Number(
    reservations.reduce((sum, item) => sum + Number(item?.stake || 0), 0).toFixed(2)
  );
  const sessionNetPnl = Number.isFinite(Number(raw.sessionNetPnl)) ? Number(raw.sessionNetPnl) : 0;
  const cumulativeLoss = Number(Math.max(0, -sessionNetPnl).toFixed(2));
  const configuredMaxLoss = Math.max(1, Number(raw.configuredMaxLoss || 15));
  const remainingLossAllowance = Number(
    Math.max(0, configuredMaxLoss - cumulativeLoss - activeOpenStake).toFixed(2)
  );

  const hydrated: AdminRiskState = {
    userId: String(raw.userId || ''),
    email: String(raw.email || fallbackEmail),
    enabled: raw.enabled !== false,
    consecutiveLosses: Math.max(0, Math.floor(Number(raw.consecutiveLosses || 0))),
    maxConsecutiveLosses: MAX_ADMIN_CONSECUTIVE_LOSSES,
    totalLosses: Math.max(0, Math.floor(Number(raw.totalLosses || 0))),
    maxTotalLosses: MAX_ADMIN_TOTAL_LOSSES,
    configuredMaxLoss,
    sessionNetPnl: Number(sessionNetPnl.toFixed(2)),
    cumulativeLoss,
    activeOpenStake,
    remainingLossAllowance,
    halted: Boolean(raw.halted),
    haltReason: raw.haltReason ?? null,
    haltCode: raw.haltCode ?? null,
    activeMode: raw.activeMode === 'real' ? 'real' : 'demo',
    botRunning: Boolean(raw.botRunning),
    periodStartedAt: Number(raw.periodStartedAt || raw.updatedAt || now),
    periodResetCount: Math.max(0, Math.floor(Number(raw.periodResetCount || 0))),
    revision: Math.max(0, Math.floor(Number(raw.revision || 0))),
    processedSettlementIds: Array.isArray(raw.processedSettlementIds)
      ? raw.processedSettlementIds.slice(-MAX_PROCESSED_IDS)
      : [],
    activeTradeStakes,
    updatedAt: Number(raw.updatedAt || now),
  };

  // Enforce invariants even when hydrating an older or partially persisted state
  if (hydrated.totalLosses >= MAX_ADMIN_TOTAL_LOSSES) {
    hydrated.halted = true;
    hydrated.botRunning = false;
    hydrated.haltCode = 'MAX_TOTAL_LOSSES';
    hydrated.haltReason =
      hydrated.haltReason ||
      'Maximum 5 total losing trades reached for this risk-control period. Trading is locked until the risk period is manually reset.';
  } else if (hydrated.cumulativeLoss >= hydrated.configuredMaxLoss) {
    hydrated.halted = true;
    hydrated.botRunning = false;
    hydrated.haltCode = 'MAX_LOSS_REACHED';
    hydrated.haltReason =
      hydrated.haltReason ||
      `Maximum loss limit reached ($${hydrated.cumulativeLoss.toFixed(2)} / $${hydrated.configuredMaxLoss.toFixed(2)}). Trading halted until the risk period is manually reset.`;
  } else if (hydrated.consecutiveLosses >= MAX_ADMIN_CONSECUTIVE_LOSSES) {
    hydrated.halted = true;
    hydrated.botRunning = false;
    hydrated.haltCode = 'MAX_CONSECUTIVE_LOSSES';
    hydrated.haltReason =
      hydrated.haltReason ||
      'Maximum 3 consecutive losing trades reached. Automated trading halted until manual restart.';
  }

  return hydrated;
}

class AdminRiskStore {
  private states: Map<string, AdminRiskState> = new Map();
  private userLocks: Map<string, Promise<void>> = new Map();

  constructor() {
    if (!(process.env.VERCEL && process.env.NODE_ENV !== 'test')) {
      this.loadFromDiskSync();
    }
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
    } catch {
      console.warn('[AdminRiskStore] Could not read persisted risk state file, starting clean.');
    }
  }

  private saveToDiskSync() {
    if (process.env.VERCEL && process.env.NODE_ENV !== 'test') return;
    try {
      const payload: AdminRiskFile = {
        version: 2,
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
    if (process.env.NODE_ENV !== 'test') {
      try {
        if (!(await shouldUseLocalFallback())) {
          const { data, error } = await getSupabaseClient()
            .from('admin_risk_states')
            .select('state,updated_at')
            .eq('user_id', user.id)
            .maybeSingle();
          if (error) throw error;
          if (data?.state) {
            const remote = recomputeDerivedFields(data.state as Partial<AdminRiskState>, user.email);
            const local = this.states.get(user.id);
            const remoteNewer =
              !local ||
              remote.revision > local.revision ||
              (remote.revision === local.revision && Number(remote.updatedAt) >= Number(local.updatedAt));
            if (remoteNewer) {
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
      current = recomputeDerivedFields(
        {
          userId: user.id,
          email: user.email,
          enabled: true,
          consecutiveLosses: 0,
          maxConsecutiveLosses: MAX_ADMIN_CONSECUTIVE_LOSSES,
          totalLosses: 0,
          maxTotalLosses: MAX_ADMIN_TOTAL_LOSSES,
          configuredMaxLoss: 15,
          sessionNetPnl: 0,
          activeMode: 'demo',
          botRunning: false,
          periodStartedAt: Date.now(),
          periodResetCount: 0,
          revision: 0,
          processedSettlementIds: [],
          activeTradeStakes: {},
          updatedAt: Date.now(),
        },
        user.email
      );
      this.states.set(user.id, current);
      this.saveToDiskSync();
    }
    return current;
  }

  private async persistState(state: AdminRiskState): Promise<void> {
    state.updatedAt = Date.now();
    state.revision = (state.revision || 0) + 1;
    const normalized = recomputeDerivedFields(state, state.email);
    this.states.set(normalized.userId, normalized);
    this.saveToDiskSync();

    if (process.env.NODE_ENV === 'test') return;
    try {
      if (await shouldUseLocalFallback()) return;
      const { error } = await getSupabaseClient()
        .from('admin_risk_states')
        .upsert(
          {
            user_id: normalized.userId,
            email: normalized.email,
            state: normalized,
            updated_at: normalized.updatedAt,
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
   * cannot interleave or bypass consecutive-loss / total-loss / max-loss checks.
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
    this.loadFromDiskSync();
  }

  public async getRiskState(user: { id: string; email: string; role?: string }): Promise<PublicAdminRiskState | null> {
    if (!isProtectedAdminUser(user)) return null;
    return this.withUserLock(user.id, async () => {
      const state = await this.ensureRemoteLoaded(user);
      return toPublicRiskState(state);
    });
  }

  /**
   * Manual bot restart: clears a 3-consecutive-loss pause if total losses (< 5) and max loss (< limit)
   * remain within bounds. Never clears MAX_TOTAL_LOSSES or MAX_LOSS_REACHED without an authorized period reset.
   */
  public async startManualBotSession(
    user: { id: string; email: string; role?: string },
    params: { maxLoss: number; mode: 'demo' | 'real' }
  ): Promise<PublicAdminRiskState | null> {
    if (!isProtectedAdminUser(user)) return null;
    const maxLoss = Number(params.maxLoss);
    if (!Number.isFinite(maxLoss) || maxLoss <= 0 || maxLoss > 1000000) {
      throw new RiskSessionError(400, 'INVALID_MAX_LOSS', 'Maximum loss threshold must be a positive dollar amount.');
    }

    return this.withUserLock(user.id, async () => {
      const state = await this.ensureRemoteLoaded(user);
      recomputeDerivedFields(state, user.email);

      if (state.totalLosses >= MAX_ADMIN_TOTAL_LOSSES || state.haltCode === 'MAX_TOTAL_LOSSES') {
        state.halted = true;
        state.botRunning = false;
        state.haltCode = 'MAX_TOTAL_LOSSES';
        state.haltReason =
          'Maximum 5 total losing trades reached for this risk-control period. Reset the risk period before restarting.';
        await this.persistState(state);
        throw new RiskSessionError(403, 'MAX_TOTAL_LOSSES', state.haltReason, toPublicRiskState(state));
      }

      if (state.haltCode === 'MAX_LOSS_REACHED' || state.cumulativeLoss >= state.configuredMaxLoss) {
        state.halted = true;
        state.botRunning = false;
        state.haltCode = 'MAX_LOSS_REACHED';
        state.haltReason = `Maximum loss limit reached ($${state.cumulativeLoss.toFixed(2)} / $${state.configuredMaxLoss.toFixed(2)}). Reset the risk period before restarting.`;
        await this.persistState(state);
        throw new RiskSessionError(403, 'ADMIN_MAX_LOSS_EXCEEDED', state.haltReason, toPublicRiskState(state));
      }

      const normalizedMaxLoss = Number(maxLoss.toFixed(2));
      const hasPeriodActivity = state.totalLosses > 0 || state.cumulativeLoss > 0 || state.sessionNetPnl !== 0;

      // Within an active loss period, never inflate configuredMaxLoss above the established limit
      const nextMaxLoss = hasPeriodActivity
        ? Math.min(state.configuredMaxLoss, normalizedMaxLoss)
        : normalizedMaxLoss;

      if (state.cumulativeLoss >= nextMaxLoss) {
        state.configuredMaxLoss = nextMaxLoss;
        state.halted = true;
        state.botRunning = false;
        state.haltCode = 'MAX_LOSS_REACHED';
        state.haltReason = `Maximum loss limit reached ($${state.cumulativeLoss.toFixed(2)} / $${nextMaxLoss.toFixed(2)}). Reset the risk period before restarting.`;
        await this.persistState(state);
        throw new RiskSessionError(403, 'ADMIN_MAX_LOSS_EXCEEDED', state.haltReason, toPublicRiskState(state));
      }

      state.consecutiveLosses = 0;
      state.configuredMaxLoss = nextMaxLoss;
      state.halted = false;
      state.haltReason = null;
      state.haltCode = null;
      state.botRunning = true;
      state.activeMode = params.mode === 'real' ? 'real' : 'demo';
      await this.persistState(state);
      return toPublicRiskState(this.states.get(user.id)!);
    });
  }

  /**
   * Authorized manual reset of the risk-control period (clears totalLosses, cumulativeLoss, consecutiveLosses, and halts).
   */
  public async resetRiskControlPeriod(
    user: { id: string; email: string; role?: string },
    params?: { maxLoss?: number }
  ): Promise<PublicAdminRiskState | null> {
    if (!isProtectedAdminUser(user)) return null;

    return this.withUserLock(user.id, async () => {
      const state = await this.ensureRemoteLoaded(user);
      if (Object.keys(state.activeTradeStakes).length > 0) {
        throw new RiskSessionError(
          409,
          'ACTIVE_TRADES_PENDING',
          'Cannot reset the risk-control period while open positions are still unsettled.',
          toPublicRiskState(state)
        );
      }

      if (params?.maxLoss !== undefined) {
        const nextMaxLoss = Number(params.maxLoss);
        if (!Number.isFinite(nextMaxLoss) || nextMaxLoss <= 0 || nextMaxLoss > 1000000) {
          throw new RiskSessionError(
            400,
            'INVALID_MAX_LOSS',
            'Maximum loss threshold must be between $1 and $1,000,000.'
          );
        }
        state.configuredMaxLoss = Number(nextMaxLoss.toFixed(2));
      }

      state.consecutiveLosses = 0;
      state.totalLosses = 0;
      state.sessionNetPnl = 0;
      state.cumulativeLoss = 0;
      state.halted = false;
      state.haltReason = null;
      state.haltCode = null;
      state.botRunning = false;
      state.periodStartedAt = Date.now();
      state.periodResetCount = (state.periodResetCount || 0) + 1;
      await this.persistState(state);
      return toPublicRiskState(this.states.get(user.id)!);
    });
  }

  public async stopBotSession(user: { id: string; email: string; role?: string }): Promise<PublicAdminRiskState | null> {
    if (!isProtectedAdminUser(user)) return null;
    return this.withUserLock(user.id, async () => {
      const state = await this.ensureRemoteLoaded(user);
      state.botRunning = false;
      await this.persistState(state);
      return toPublicRiskState(this.states.get(user.id)!);
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
      // Never allow altering maxLoss to bypass an active halt or inflate allowance once losses exist in this period
      if (!state.halted && params.maxLoss !== undefined) {
        const requestedMaxLoss = Number(params.maxLoss);
        if (Number.isFinite(requestedMaxLoss) && requestedMaxLoss > 0 && requestedMaxLoss <= 1000000) {
          const normalized = Number(requestedMaxLoss.toFixed(2));
          const hasLosses = state.totalLosses > 0 || state.cumulativeLoss > 0;
          state.configuredMaxLoss = hasLosses
            ? Math.min(state.configuredMaxLoss, normalized)
            : normalized;
          if (state.cumulativeLoss >= state.configuredMaxLoss) {
            state.halted = true;
            state.botRunning = false;
            state.haltCode = 'MAX_LOSS_REACHED';
            state.haltReason = `Maximum loss limit reached ($${state.cumulativeLoss.toFixed(2)} / $${state.configuredMaxLoss.toFixed(2)}). Trading halted until the risk period is reset.`;
          }
        }
      }
      await this.persistState(state);
      return toPublicRiskState(this.states.get(user.id)!);
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
    | { allowed: false; status: 400 | 403 | 409; code: string; error: string; riskState: PublicAdminRiskState }
  > {
    if (!isProtectedAdminUser(user)) {
      return { allowed: true, riskState: null };
    }

    const state = await this.ensureRemoteLoaded(user);
    state.activeMode = mode === 'real' ? 'real' : 'demo';

    const stake = Number(trade.stake);
    if (!Number.isFinite(stake) || stake <= 0) {
      return {
        allowed: false,
        status: 400,
        code: 'INVALID_STAKE',
        error: 'Trade stake must be a positive number.',
        riskState: toPublicRiskState(state),
      };
    }

    if (state.activeTradeStakes[trade.id] || state.processedSettlementIds.includes(trade.id)) {
      return {
        allowed: false,
        status: 409,
        code: 'DUPLICATE_TRADE',
        error: 'Duplicate trade execution blocked.',
        riskState: toPublicRiskState(state),
      };
    }

    if (state.totalLosses >= MAX_ADMIN_TOTAL_LOSSES) {
      state.halted = true;
      state.botRunning = false;
      state.haltCode = 'MAX_TOTAL_LOSSES';
      state.haltReason =
        'Maximum 5 total losing trades reached for this risk-control period. Trading locked until the risk period is manually reset.';
      await this.persistState(state);
      return {
        allowed: false,
        status: 403,
        code: 'MAX_TOTAL_LOSSES',
        error: state.haltReason,
        riskState: toPublicRiskState(this.states.get(user.id)!),
      };
    }

    if (state.halted) {
      return {
        allowed: false,
        status: 403,
        code: state.haltCode === 'MAX_LOSS_REACHED' ? 'ADMIN_MAX_LOSS_EXCEEDED' : 'ADMIN_RISK_HALTED',
        error:
          state.haltReason ||
          'Administrator risk protection has halted trading. Manual intervention is required to continue.',
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
        riskState: toPublicRiskState(this.states.get(user.id)!),
      };
    }

    const activeCount = Object.keys(state.activeTradeStakes).length;
    if (state.totalLosses + activeCount >= MAX_ADMIN_TOTAL_LOSSES) {
      return {
        allowed: false,
        status: 409,
        code: 'CONCURRENT_LOSS_CAP',
        error:
          'Concurrent trade blocked: open position could exceed the maximum 5 total losing trades limit for this period.',
        riskState: toPublicRiskState(state),
      };
    }

    if (state.consecutiveLosses + activeCount >= MAX_ADMIN_CONSECUTIVE_LOSSES) {
      return {
        allowed: false,
        status: 409,
        code: 'CONCURRENT_LOSS_CAP',
        error:
          'Concurrent trade blocked: open position could exceed the maximum 3 consecutive losing trades limit.',
        riskState: toPublicRiskState(state),
      };
    }

    recomputeDerivedFields(state, user.email);

    if (state.cumulativeLoss >= state.configuredMaxLoss) {
      state.halted = true;
      state.botRunning = false;
      state.haltCode = 'MAX_LOSS_REACHED';
      state.haltReason = `Maximum loss limit reached ($${state.cumulativeLoss.toFixed(2)} / $${state.configuredMaxLoss.toFixed(2)}). Trading halted until the risk period is manually reset.`;
      await this.persistState(state);
      return {
        allowed: false,
        status: 403,
        code: 'ADMIN_MAX_LOSS_EXCEEDED',
        error: state.haltReason,
        riskState: toPublicRiskState(this.states.get(user.id)!),
      };
    }

    if (stake > state.remainingLossAllowance) {
      return {
        allowed: false,
        status: 403,
        code: 'ADMIN_MAX_LOSS_EXCEEDED',
        error: `Trade blocked: stake ($${stake.toFixed(2)}) exceeds remaining max loss allowance ($${state.remainingLossAllowance.toFixed(2)}).`,
        riskState: toPublicRiskState(state),
      };
    }

    state.activeTradeStakes[trade.id] = {
      stake,
      mode,
      isBot: Boolean(trade.botId),
      reservedAt: Date.now(),
    };
    await this.persistState(state);
    return { allowed: true, riskState: toPublicRiskState(this.states.get(user.id)!) };
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
    return toPublicRiskState(this.states.get(user.id)!);
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
      state.totalLosses += 1;
    }

    if (state.totalLosses >= MAX_ADMIN_TOTAL_LOSSES) {
      state.halted = true;
      state.botRunning = false;
      state.haltCode = 'MAX_TOTAL_LOSSES';
      state.haltReason =
        'Maximum 5 total losing trades reached for this risk-control period. Trading locked until the risk period is manually reset.';
    } else if (state.consecutiveLosses >= MAX_ADMIN_CONSECUTIVE_LOSSES) {
      state.halted = true;
      state.botRunning = false;
      state.haltCode = 'MAX_CONSECUTIVE_LOSSES';
      state.haltReason =
        'Maximum 3 consecutive losing trades reached. Automated trading halted until manual restart.';
    } else if (state.cumulativeLoss >= state.configuredMaxLoss) {
      state.halted = true;
      state.botRunning = false;
      state.haltCode = 'MAX_LOSS_REACHED';
      state.haltReason = `Maximum loss limit reached ($${state.cumulativeLoss.toFixed(2)} / $${state.configuredMaxLoss.toFixed(2)}). Trading halted until the risk period is manually reset.`;
    }

    await this.persistState(state);
    return toPublicRiskState(this.states.get(user.id)!);
  }
}

export const adminRiskStore = new AdminRiskStore();
