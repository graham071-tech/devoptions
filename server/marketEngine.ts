import fs from 'fs';
import path from 'path';
import { SYNTHETIC_MARKETS } from '../src/data/syntheticMarkets';
import { Candle, Market, Tick } from '../src/types/trading';
import { extractLastDigit } from '../src/utils/indicators';
import {
  getSupabaseClient,
  isSupabaseTransportError,
  markSupabaseUnreachable,
  shouldUseLocalFallback,
} from '../src/services/supabaseService';

export type MarketRegime = 'bullish' | 'bearish' | 'sideways';

export interface PersistentInstrumentState {
  symbol: string;
  lastQuote: number;
  direction: 'up' | 'down' | 'flat';
  lastDigit: number;
  regime: MarketRegime;
  regimeRemainingTicks: number;
  momentum: number;
  volScale: number;
  lastTickEpoch: number;
  ticks: Tick[];
  candles: Candle[];
}

interface MarketStateSnapshotFile {
  version: number;
  savedAt: number;
  instruments: Record<string, PersistentInstrumentState>;
}

const MAX_TICKS = 240;
const MAX_CANDLES = 100;
const TICK_MS = 1000;
const CANDLE_MS = 60000;

function resolveMarketStatePath(): string {
  const preferredDir = path.resolve(process.cwd(), 'data');
  try {
    if (!fs.existsSync(preferredDir)) {
      fs.mkdirSync(preferredDir, { recursive: true });
    }
    const probe = path.join(preferredDir, '.market-probe');
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    return path.join(preferredDir, 'market-state.json');
  } catch {
    return path.join('/tmp', 'devoptions-market-state.json');
  }
}

const MARKET_STATE_FILE = resolveMarketStatePath();

function getBaselinePrice(symbol: string): number {
  if (symbol.includes('CRASH1000')) return 9850;
  if (symbol.includes('CRASH')) return 10500;
  if (symbol.includes('BOOM1000')) return 7450;
  if (symbol.includes('BOOM')) return 8200;
  if (symbol.includes('JD100')) return 4200;
  if (symbol.includes('JD75')) return 3150;
  if (symbol.includes('100')) return 6124.5;
  if (symbol.includes('75')) return 7500;
  if (symbol.includes('50')) return 4850;
  if (symbol.includes('25')) return 2450;
  if (symbol.includes('10')) return 1250;
  return 6000;
}

/** Box-Muller transform for realistic Gaussian return shocks */
function sampleGaussian(): number {
  let u1 = 0;
  let u2 = 0;
  while (u1 <= 1e-7) u1 = Math.random();
  u2 = Math.random();
  return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
}

function getVolatilityScaleFactor(market: Market): number {
  if (market.symbol.includes('100')) return 1.0;
  if (market.symbol.includes('75')) return 0.85;
  if (market.symbol.includes('50')) return 0.65;
  if (market.symbol.includes('25')) return 0.45;
  if (market.symbol.includes('10')) return 0.28;
  return 0.75;
}

function alignEpochToSecond(ts: number): number {
  return Math.floor(ts / TICK_MS) * TICK_MS;
}

type FrameListener = (frame: { serverTime: number; ticks: Record<string, Tick> }) => void;

class ServerMarketEngine {
  private instruments: Map<string, PersistentInstrumentState> = new Map();
  private listeners: Set<FrameListener> = new Set();
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private initialized = false;
  private remoteSyncAttempted = false;
  private ticksSinceDiskSave = 0;
  private ticksSinceRemoteSave = 0;
  private remoteSaveInFlight = false;
  private shutdownHookRegistered = false;

  constructor() {
    this.initFromDiskSync();
  }

  private getMarketMeta(symbol: string): Market {
    return SYNTHETIC_MARKETS.find((m) => m.symbol === symbol) || SYNTHETIC_MARKETS[0];
  }

  private chooseNextRegime(current?: MarketRegime): { regime: MarketRegime; duration: number } {
    const r = Math.random();
    let next: MarketRegime = 'sideways';
    if (current === 'bullish') {
      next = r < 0.48 ? 'sideways' : r < 0.82 ? 'bearish' : 'bullish';
    } else if (current === 'bearish') {
      next = r < 0.48 ? 'sideways' : r < 0.82 ? 'bullish' : 'bearish';
    } else {
      next = r < 0.42 ? 'bullish' : r < 0.84 ? 'bearish' : 'sideways';
    }
    const duration = 18 + Math.floor(Math.random() * 48); // 18..65s regime waves
    return { regime: next, duration };
  }

  private advanceInstrumentOneStep(
    state: PersistentInstrumentState,
    market: Market,
    epoch: number,
    recordHistory = true
  ): Tick {
    const prevQuote = state.lastQuote;
    const decimals = market.decimals;
    const pip = market.pipSize || 0.01;
    const volBase = Math.max(pip * 4, prevQuote * 0.00018 * getVolatilityScaleFactor(market));

    // Smooth regime transition
    state.regimeRemainingTicks -= 1;
    if (state.regimeRemainingTicks <= 0) {
      const nextRegime = this.chooseNextRegime(state.regime);
      state.regime = nextRegime.regime;
      state.regimeRemainingTicks = nextRegime.duration;
    }

    // Mean-reverting volatility clustering
    state.volScale = Math.max(
      0.65,
      Math.min(1.75, state.volScale * 0.94 + (0.7 + Math.random() * 0.65) * 0.06)
    );

    const regimeBias =
      state.regime === 'bullish'
        ? volBase * 0.22
        : state.regime === 'bearish'
        ? -volBase * 0.22
        : 0;

    let shock = sampleGaussian() * volBase * state.volScale;

    // Instrument-specific realistic behavior for Crash/Boom and Jump
    if (market.category === 'crash_boom') {
      const freq = market.symbol.includes('1000') ? 0.014 : 0.028;
      if (market.symbol.includes('CRASH')) {
        shock = Math.abs(shock) * 0.22 + volBase * 0.28;
        if (Math.random() < freq) {
          shock = -volBase * (7.5 + Math.random() * 5.0);
          state.momentum = 0;
        }
      } else {
        shock = -Math.abs(shock) * 0.22 - volBase * 0.28;
        if (Math.random() < freq) {
          shock = volBase * (7.5 + Math.random() * 5.0);
          state.momentum = 0;
        }
      }
    } else if (market.category === 'jump') {
      if (Math.random() < 0.025) {
        const jumpDir = Math.random() < 0.5 ? 1 : -1;
        shock += jumpDir * volBase * (4.0 + Math.random() * 3.0);
      }
    }

    // Autocorrelated momentum (prevents jerky white-noise oscillation)
    const targetMomentum = regimeBias + shock * 0.45;
    state.momentum = state.momentum * 0.42 + targetMomentum * 0.58;
    const rawDelta = state.momentum + shock * 0.55;

    // Gentle soft-anchor preventing degenerate zero or runaway distortion while letting long trends breathe
    const minAllowed = Math.max(pip * 50, getBaselinePrice(market.symbol) * 0.25);
    const maxAllowed = getBaselinePrice(market.symbol) * 3.5;

    let nextQuote = Number((prevQuote + rawDelta).toFixed(decimals));
    if (!Number.isFinite(nextQuote) || nextQuote < minAllowed) {
      nextQuote = Number((minAllowed + Math.abs(rawDelta)).toFixed(decimals));
      state.momentum = Math.abs(state.momentum);
    } else if (nextQuote > maxAllowed) {
      nextQuote = Number((maxAllowed - Math.abs(rawDelta)).toFixed(decimals));
      state.momentum = -Math.abs(state.momentum);
    }

    const direction: 'up' | 'down' | 'flat' =
      nextQuote > prevQuote ? 'up' : nextQuote < prevQuote ? 'down' : 'flat';
    const lastDigit = extractLastDigit(nextQuote, decimals);

    state.lastQuote = nextQuote;
    state.direction = direction;
    state.lastDigit = lastDigit;
    state.lastTickEpoch = epoch;

    const tick: Tick = {
      epoch,
      quote: nextQuote,
      symbol: state.symbol,
      direction,
      lastDigit,
    };

    if (recordHistory) {
      state.ticks.push(tick);
      if (state.ticks.length > MAX_TICKS) {
        state.ticks.splice(0, state.ticks.length - MAX_TICKS);
      }

      const candleBucket = Math.floor(epoch / CANDLE_MS) * CANDLE_MS;
      const lastCandle = state.candles[state.candles.length - 1];
      if (lastCandle && lastCandle.epoch === candleBucket) {
        lastCandle.close = nextQuote;
        if (nextQuote > lastCandle.high) lastCandle.high = nextQuote;
        if (nextQuote < lastCandle.low) lastCandle.low = nextQuote;
      } else {
        state.candles.push({
          epoch: candleBucket,
          open: nextQuote,
          high: nextQuote,
          low: nextQuote,
          close: nextQuote,
        });
        if (state.candles.length > MAX_CANDLES) {
          state.candles.splice(0, state.candles.length - MAX_CANDLES);
        }
      }
    }

    return tick;
  }

  private createFreshInstrument(market: Market, nowAligned: number): PersistentInstrumentState {
    const base = getBaselinePrice(market.symbol);
    const initialRegime = this.chooseNextRegime();
    const seedTicksCount = 120;
    const startEpoch = nowAligned - (seedTicksCount - 1) * TICK_MS;

    const state: PersistentInstrumentState = {
      symbol: market.symbol,
      lastQuote: base,
      direction: 'flat',
      lastDigit: extractLastDigit(base, market.decimals),
      regime: initialRegime.regime,
      regimeRemainingTicks: initialRegime.duration,
      momentum: 0,
      volScale: 1.0,
      lastTickEpoch: startEpoch - TICK_MS,
      ticks: [],
      candles: [],
    };

    for (let i = 0; i < seedTicksCount; i++) {
      this.advanceInstrumentOneStep(state, market, startEpoch + i * TICK_MS, true);
    }
    return state;
  }

  private catchUpInstrument(state: PersistentInstrumentState, market: Market, nowAligned: number) {
    if (!Number.isFinite(state.lastTickEpoch) || state.lastTickEpoch >= nowAligned) {
      return;
    }

    const gapSeconds = Math.floor((nowAligned - state.lastTickEpoch) / TICK_MS);
    if (gapSeconds <= 0) return;

    if (gapSeconds > MAX_TICKS) {
      // Long downtime: apply a continuous macro drift jump for intermediate time, then replay final MAX_TICKS seamlessly
      const skippedSeconds = gapSeconds - MAX_TICKS;
      const coarseEpoch = state.lastTickEpoch + skippedSeconds * TICK_MS;
      const coarseSteps = Math.min(80, Math.ceil(skippedSeconds / 30));
      for (let i = 0; i < coarseSteps; i++) {
        this.advanceInstrumentOneStep(state, market, coarseEpoch, false);
      }
      state.lastTickEpoch = nowAligned - MAX_TICKS * TICK_MS;
    }

    const startNext = state.lastTickEpoch + TICK_MS;
    for (let t = startNext; t <= nowAligned; t += TICK_MS) {
      this.advanceInstrumentOneStep(state, market, t, true);
    }
  }

  private initFromDiskSync() {
    if (this.initialized) return;
    this.initialized = true;

    const nowAligned = alignEpochToSecond(Date.now());
    let loadedInstruments: Record<string, PersistentInstrumentState> = {};

    try {
      if (fs.existsSync(MARKET_STATE_FILE)) {
        const raw = fs.readFileSync(MARKET_STATE_FILE, 'utf-8');
        const parsed = JSON.parse(raw) as MarketStateSnapshotFile;
        if (parsed && parsed.instruments && typeof parsed.instruments === 'object') {
          loadedInstruments = parsed.instruments;
        }
      }
    } catch (err) {
      console.warn('[MarketEngine] Could not parse persisted market snapshot, re-initializing cleanly.');
    }

    for (const market of SYNTHETIC_MARKETS) {
      const existing = loadedInstruments[market.symbol];
      if (
        existing &&
        Number.isFinite(existing.lastQuote) &&
        existing.lastQuote > 0 &&
        Array.isArray(existing.ticks) &&
        existing.ticks.length > 0
      ) {
        const hydrated: PersistentInstrumentState = {
          symbol: market.symbol,
          lastQuote: existing.lastQuote,
          direction: existing.direction || 'flat',
          lastDigit: existing.lastDigit ?? extractLastDigit(existing.lastQuote, market.decimals),
          regime: existing.regime || 'sideways',
          regimeRemainingTicks: Number(existing.regimeRemainingTicks) || 24,
          momentum: Number(existing.momentum) || 0,
          volScale: Number(existing.volScale) || 1.0,
          lastTickEpoch: Number(existing.lastTickEpoch) || nowAligned,
          ticks: existing.ticks.slice(-MAX_TICKS),
          candles: Array.isArray(existing.candles) ? existing.candles.slice(-MAX_CANDLES) : [],
        };
        this.catchUpInstrument(hydrated, market, nowAligned);
        this.instruments.set(market.symbol, hydrated);
      } else {
        this.instruments.set(market.symbol, this.createFreshInstrument(market, nowAligned));
      }
    }

    this.saveSnapshotToDisk();
    this.registerShutdownHook();
  }

  private registerShutdownHook() {
    if (this.shutdownHookRegistered) return;
    this.shutdownHookRegistered = true;

    const persistOnExit = () => {
      this.saveSnapshotToDisk();
    };
    process.once('SIGTERM', persistOnExit);
    process.once('SIGINT', persistOnExit);
  }

  public startLoop() {
    if (this.tickTimer || process.env.VERCEL || process.env.NODE_ENV === 'test') {
      return;
    }

    this.tickTimer = setInterval(() => {
      this.stepAllToNow();
    }, TICK_MS);

    if (typeof this.tickTimer.unref === 'function') {
      this.tickTimer.unref();
    }
  }

  public stopLoop() {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    this.saveSnapshotToDisk();
  }

  private async reconcileFromSupabaseOnce() {
    if (this.remoteSyncAttempted || process.env.NODE_ENV === 'test') return;
    this.remoteSyncAttempted = true;
    try {
      if (await shouldUseLocalFallback()) return;
      const { data, error } = await getSupabaseClient().from('market_states').select('symbol,state,updated_at');
      if (error) throw error;
      if (!Array.isArray(data) || data.length === 0) return;

      const nowAligned = alignEpochToSecond(Date.now());
      let updatedAny = false;
      for (const row of data) {
        const remote = row.state as PersistentInstrumentState | undefined;
        if (!remote || !remote.symbol || !Number.isFinite(remote.lastQuote)) continue;
        const local = this.instruments.get(remote.symbol);
        if (!local || Number(remote.lastTickEpoch) > Number(local.lastTickEpoch)) {
          const market = this.getMarketMeta(remote.symbol);
          const hydrated: PersistentInstrumentState = {
            ...remote,
            ticks: Array.isArray(remote.ticks) ? remote.ticks.slice(-MAX_TICKS) : [],
            candles: Array.isArray(remote.candles) ? remote.candles.slice(-MAX_CANDLES) : [],
          };
          this.catchUpInstrument(hydrated, market, nowAligned);
          this.instruments.set(remote.symbol, hydrated);
          updatedAny = true;
        }
      }
      if (updatedAny) {
        this.saveSnapshotToDisk();
      }
    } catch (err) {
      if (isSupabaseTransportError(err)) {
        markSupabaseUnreachable();
      }
    }
  }

  public async ensureUpToDate() {
    if (!this.remoteSyncAttempted) {
      await this.reconcileFromSupabaseOnce();
    }
    this.stepAllToNow();
  }

  public stepAllToNow(): Record<string, Tick> {
    const nowAligned = alignEpochToSecond(Date.now());
    const emittedTicks: Record<string, Tick> = {};
    let advanced = false;

    for (const market of SYNTHETIC_MARKETS) {
      let state = this.instruments.get(market.symbol);
      if (!state) {
        state = this.createFreshInstrument(market, nowAligned);
        this.instruments.set(market.symbol, state);
        emittedTicks[market.symbol] = state.ticks[state.ticks.length - 1];
        advanced = true;
        continue;
      }

      if (state.lastTickEpoch < nowAligned) {
        this.catchUpInstrument(state, market, nowAligned);
        advanced = true;
      }

      const latest = state.ticks[state.ticks.length - 1];
      if (latest) {
        emittedTicks[market.symbol] = latest;
      }
    }

    if (advanced) {
      if (this.listeners.size > 0) {
        const payload = { serverTime: nowAligned, ticks: emittedTicks };
        this.listeners.forEach((cb) => cb(payload));
      }

      this.ticksSinceDiskSave += 1;
      this.ticksSinceRemoteSave += 1;

      if (this.ticksSinceDiskSave >= 3) {
        this.ticksSinceDiskSave = 0;
        this.saveSnapshotToDisk();
      }
      if (this.ticksSinceRemoteSave >= 15) {
        this.ticksSinceRemoteSave = 0;
        void this.saveSnapshotToSupabase();
      }
    }

    return emittedTicks;
  }

  public saveSnapshotToDisk() {
    try {
      const payload: MarketStateSnapshotFile = {
        version: 1,
        savedAt: Date.now(),
        instruments: {},
      };
      this.instruments.forEach((state, symbol) => {
        payload.instruments[symbol] = state;
      });
      const tmp = `${MARKET_STATE_FILE}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(payload), 'utf-8');
      fs.renameSync(tmp, MARKET_STATE_FILE);
    } catch (err) {
      console.error('[MarketEngine] Failed to persist market state:', err);
    }
  }

  private async saveSnapshotToSupabase() {
    if (this.remoteSaveInFlight || process.env.NODE_ENV === 'test') return;
    this.remoteSaveInFlight = true;
    try {
      if (await shouldUseLocalFallback()) return;
      const rows = Array.from(this.instruments.values()).map((state) => ({
        symbol: state.symbol,
        state,
        updated_at: state.lastTickEpoch,
      }));
      const { error } = await getSupabaseClient().from('market_states').upsert(rows, { onConflict: 'symbol' });
      if (error) throw error;
    } catch (err) {
      if (isSupabaseTransportError(err)) {
        markSupabaseUnreachable();
      }
    } finally {
      this.remoteSaveInFlight = false;
    }
  }

  public getInstrumentSnapshot(symbol: string): PersistentInstrumentState | null {
    this.stepAllToNow();
    const state = this.instruments.get(symbol);
    if (!state) return null;
    return {
      ...state,
      ticks: [...state.ticks],
      candles: [...state.candles],
    };
  }

  public getAllLatestTicks(): Record<string, Tick> {
    this.stepAllToNow();
    const result: Record<string, Tick> = {};
    this.instruments.forEach((state, symbol) => {
      const latest = state.ticks[state.ticks.length - 1];
      if (latest) result[symbol] = latest;
    });
    return result;
  }

  /**
   * Look up recorded continuous tick price at or immediately after targetEpoch so open trades
   * settle identically across browser refreshes and closures.
   */
  public getPriceAtOrAfter(symbol: string, targetEpoch: number): Tick | null {
    this.stepAllToNow();
    const state = this.instruments.get(symbol);
    if (!state || state.ticks.length === 0) return null;
    for (const tick of state.ticks) {
      if (tick.epoch >= targetEpoch) {
        return tick;
      }
    }
    return null;
  }

  public subscribe(cb: FrameListener): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }
}

export const marketEngine = new ServerMarketEngine();
