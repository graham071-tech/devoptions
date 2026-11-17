/**
 * Continuous, Server-Synchronized Market Data Client for DevOptions
 * - Connects to the authoritative backend simulation engine via SSE (/api/market/stream)
 *   and REST snapshots (/api/market/snapshot) so every browser tab & page refresh shares
 *   identical, continuous simulated prices, chart histories, and candle data per instrument.
 * - Preserves an isolated 220ms bot-only micro-stream (subscribeToBotTicks) that never
 *   accelerates digit circles or manual trading timing.
 */

import { Candle, Market, Tick } from '../types/trading';
import { extractLastDigit } from '../utils/indicators';
import { SYNTHETIC_MARKETS } from '../data/syntheticMarkets';
import { storage } from './storage';

type TickCallback = (tick: Tick) => void;
type CandlesCallback = (candles: Candle[]) => void;
type HistoryCallback = (symbol: string, ticks: Tick[]) => void;
type ConnectionStateCallback = (connected: boolean, source: 'live' | 'demo', latencyMs: number) => void;

export interface MarketProviderConfig {
  providerType: 'demo' | 'custom_ws';
  customWsUrl?: string;
  customApiKey?: string;
  reconnectIntervalMs: number;
}

export interface MarketSnapshotResponse {
  symbol: string;
  currentQuote: number;
  direction: 'up' | 'down' | 'flat';
  lastDigit: number;
  lastTickEpoch: number;
  serverTime: number;
  ticks: Tick[];
  candles: Candle[];
  tickAtTarget?: Tick | null;
}

interface SymbolCache {
  ticks: Tick[];
  candles: Candle[];
  lastQuote: number;
}

const MAX_CLIENT_TICKS = 240;

class MarketDataProviderService {
  private currentMarket: Market;
  private currentSymbol: string;
  private config: MarketProviderConfig = {
    providerType: 'demo',
    reconnectIntervalMs: 3000,
  };

  private ws: WebSocket | null = null;
  private eventSource: EventSource | null = null;
  private fallbackPollInterval: ReturnType<typeof setInterval> | null = null;
  private fallbackSimInterval: ReturnType<typeof setInterval> | null = null;
  private isConnected: boolean = true;
  private latencyMs: number = 14;
  private dataSource: 'live' | 'demo' = 'demo';
  private started = false;

  private tickListeners: Set<TickCallback> = new Set();
  private botTickListeners: Set<TickCallback> = new Set();
  private candleListeners: Set<CandlesCallback> = new Set();
  private historyListeners: Set<HistoryCallback> = new Set();
  private connectionListeners: Set<ConnectionStateCallback> = new Set();

  private symbolCache: Map<string, SymbolCache> = new Map();
  private lastQuote: number = 6124.5;

  constructor() {
    const savedSymbol = typeof window !== 'undefined' ? storage.getSelectedMarketSymbol() : 'R_100';
    const initialMarket =
      SYNTHETIC_MARKETS.find((m) => m.symbol === savedSymbol) || SYNTHETIC_MARKETS[0];
    this.currentMarket = initialMarket;
    this.currentSymbol = initialMarket.symbol;

    if (typeof window !== 'undefined') {
      this.connectServerStream();
      void this.syncMarketSnapshot(this.currentSymbol);
    } else {
      // Non-browser environment (e.g. direct Node unit tests)
      this.seedOfflineHistory(this.currentMarket);
      this.startOfflineFallback();
    }
  }

  public getProviderConfig(): MarketProviderConfig {
    return { ...this.config };
  }

  public configureProvider(newConfig: Partial<MarketProviderConfig>) {
    this.config = { ...this.config, ...newConfig };
    if (this.config.providerType === 'custom_ws' && this.config.customWsUrl) {
      this.connectCustomWs(this.config.customWsUrl);
    } else {
      this.disconnectWs();
      this.dataSource = 'demo';
      if (typeof window !== 'undefined') {
        this.connectServerStream();
      } else {
        this.startOfflineFallback();
      }
      this.notifyConnectionState();
    }
  }

  public setMarket(market: Market) {
    const symbolChanged = this.currentSymbol !== market.symbol;
    this.currentMarket = market;
    this.currentSymbol = market.symbol;

    if (typeof window !== 'undefined') {
      storage.saveSelectedMarketSymbol(market.symbol);
    }

    const cached = this.symbolCache.get(market.symbol);
    if (cached && cached.ticks.length > 0) {
      this.lastQuote = cached.lastQuote;
    }

    if (symbolChanged || !cached || cached.ticks.length === 0) {
      if (this.dataSource === 'live' && this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ subscribe_ticks: this.currentSymbol }));
      } else if (typeof window !== 'undefined') {
        void this.syncMarketSnapshot(market.symbol);
      } else {
        this.seedOfflineHistory(market);
      }
    }
  }

  public getCurrentQuote(): number {
    const cached = this.symbolCache.get(this.currentSymbol);
    if (cached && Number.isFinite(cached.lastQuote) && cached.lastQuote > 0) {
      return cached.lastQuote;
    }
    return this.lastQuote;
  }

  public getCandles(): Candle[] {
    const cached = this.symbolCache.get(this.currentSymbol);
    return cached ? [...cached.candles] : [];
  }

  public getPriceHistory(count = 120): { time: number; price: number }[] {
    const cached = this.symbolCache.get(this.currentSymbol);
    if (!cached || cached.ticks.length === 0) return [];
    return cached.ticks.slice(-count).map((t) => ({ time: t.epoch, price: t.quote }));
  }

  public getTickHistory(symbol = this.currentSymbol, count = 200): Tick[] {
    const cached = this.symbolCache.get(symbol);
    if (!cached) return [];
    return cached.ticks.slice(-count);
  }

  public isFeedHealthy(): boolean {
    return this.isConnected && Number.isFinite(this.getCurrentQuote()) && this.getCurrentQuote() > 0;
  }

  public subscribeToTicks(cb: TickCallback): () => void {
    this.tickListeners.add(cb);
    if (typeof window !== 'undefined' && !this.started) {
      this.connectServerStream();
    }
    return () => this.tickListeners.delete(cb);
  }

  public subscribeToHistory(cb: HistoryCallback): () => void {
    this.historyListeners.add(cb);
    return () => this.historyListeners.delete(cb);
  }

  /**
   * Realistic 1-second bot stream aligned with the continuous server market ticks.
   */
  public subscribeToBotTicks(cb: TickCallback): () => void {
    this.botTickListeners.add(cb);
    if (typeof window !== 'undefined' && !this.started) {
      this.connectServerStream();
    }
    return () => {
      this.botTickListeners.delete(cb);
    };
  }

  public subscribeToCandles(cb: CandlesCallback): () => void {
    this.candleListeners.add(cb);
    return () => this.candleListeners.delete(cb);
  }

  public subscribeToConnection(cb: ConnectionStateCallback): () => void {
    this.connectionListeners.add(cb);
    cb(this.isConnected, this.dataSource, this.latencyMs);
    return () => this.connectionListeners.delete(cb);
  }

  public reconnect() {
    if (this.config.providerType === 'custom_ws' && this.config.customWsUrl) {
      this.connectCustomWs(this.config.customWsUrl);
    } else if (typeof window !== 'undefined') {
      this.connectServerStream(true);
      void this.syncMarketSnapshot(this.currentSymbol);
    } else {
      this.startOfflineFallback();
    }
  }

  public disconnect() {
    this.disconnectWs();
    this.disconnectServerStream();
    this.stopOfflineFallback();
    this.isConnected = false;
    this.notifyConnectionState();
  }

  public connect(_appId?: string, token?: string) {
    if (token && this.config.customWsUrl) {
      this.configureProvider({ providerType: 'custom_ws' });
    } else {
      this.configureProvider({ providerType: 'demo' });
    }
  }

  public async fetchMarketSnapshot(
    symbol: string,
    atEpoch?: number
  ): Promise<MarketSnapshotResponse | null> {
    if (typeof fetch === 'undefined') return null;
    try {
      const qs = new URLSearchParams({ symbol });
      if (atEpoch && Number.isFinite(atEpoch)) {
        qs.set('atEpoch', String(Math.floor(atEpoch)));
      }
      const startedAt = Date.now();
      const res = await fetch(`/api/market/snapshot?${qs.toString()}`, {
        credentials: 'include',
        cache: 'no-store',
      });
      if (!res.ok) return null;
      const data = (await res.json()) as MarketSnapshotResponse;
      this.latencyMs = Math.max(4, Date.now() - startedAt);
      if (data && Array.isArray(data.ticks) && data.ticks.length > 0) {
        this.mergeSymbolSnapshot(data.symbol, data.ticks, data.candles || []);
      }
      return data;
    } catch {
      return null;
    }
  }

  public async syncMarketSnapshot(symbol: string): Promise<void> {
    const snap = await this.fetchMarketSnapshot(symbol);
    if (!snap) return;

    if (snap.symbol === this.currentSymbol) {
      this.lastQuote = snap.currentQuote;
      this.isConnected = true;
      this.notifyConnectionState();
    }
    this.historyListeners.forEach((cb) => cb(snap.symbol, snap.ticks));
  }

  private mergeSymbolSnapshot(symbol: string, ticks: Tick[], candles: Candle[]) {
    const existing = this.symbolCache.get(symbol);
    const mergedMap = new Map<number, Tick>();

    if (existing) {
      for (const t of existing.ticks) mergedMap.set(t.epoch, t);
    }
    for (const t of ticks) {
      if (t && Number.isFinite(t.epoch) && Number.isFinite(t.quote)) {
        mergedMap.set(t.epoch, t);
      }
    }

    const sorted = Array.from(mergedMap.values())
      .sort((a, b) => a.epoch - b.epoch)
      .slice(-MAX_CLIENT_TICKS);

    const lastTick = sorted[sorted.length - 1];
    this.symbolCache.set(symbol, {
      ticks: sorted,
      candles: candles.length > 0 ? candles : existing?.candles || [],
      lastQuote: lastTick ? lastTick.quote : existing?.lastQuote || this.lastQuote,
    });
  }

  private connectServerStream(forceReset = false) {
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') return;
    if (this.eventSource && !forceReset) return;

    this.disconnectServerStream();
    this.stopOfflineFallback();
    this.started = true;

    try {
      const es = new EventSource('/api/market/stream');
      this.eventSource = es;

      es.addEventListener('init', (event: MessageEvent) => {
        try {
          const payload = JSON.parse(event.data);
          this.handleServerFrame(payload, false);
          this.isConnected = true;
          this.dataSource = 'demo';
          this.notifyConnectionState();
        } catch {
          // ignore
        }
      });

      es.addEventListener('tick', (event: MessageEvent) => {
        try {
          const payload = JSON.parse(event.data);
          this.handleServerFrame(payload, true);
          if (!this.isConnected) {
            this.isConnected = true;
            this.notifyConnectionState();
          }
        } catch {
          // ignore
        }
      });

      es.onopen = () => {
        this.isConnected = true;
        this.stopOfflineFallback();
        this.notifyConnectionState();
        void this.syncMarketSnapshot(this.currentSymbol);
      };

      es.onerror = () => {
        // Fallback poll keeps continuous sync if SSE temporarily drops (e.g. serverless proxy timeout)
        this.startServerPollFallback();
      };
    } catch {
      this.startServerPollFallback();
    }
  }

  private disconnectServerStream() {
    if (this.eventSource) {
      try {
        this.eventSource.close();
      } catch {
        // ignore
      }
      this.eventSource = null;
    }
    this.started = false;
  }

  private startServerPollFallback() {
    if (this.fallbackPollInterval || typeof window === 'undefined') return;
    this.fallbackPollInterval = setInterval(async () => {
      if (this.eventSource && this.eventSource.readyState === EventSource.OPEN) {
        if (this.fallbackPollInterval) {
          clearInterval(this.fallbackPollInterval);
          this.fallbackPollInterval = null;
        }
        return;
      }
      const snap = await this.fetchMarketSnapshot(this.currentSymbol);
      if (snap && snap.ticks.length > 0) {
        const latest = snap.ticks[snap.ticks.length - 1];
        this.lastQuote = latest.quote;
        this.tickListeners.forEach((cb) => cb(latest));
        this.botTickListeners.forEach((cb) => cb(latest));
      }
    }, 1000);
  }

  private handleServerFrame(
    payload: { serverTime?: number; ticks?: Record<string, Tick> },
    emitToListeners: boolean
  ) {
    if (!payload?.ticks) return;
    if (payload.serverTime) {
      const lag = Math.abs(Date.now() - payload.serverTime);
      if (lag < 5000) {
        this.latencyMs = Math.max(8, Math.min(180, lag));
      }
    }

    Object.entries(payload.ticks).forEach(([symbol, tick]) => {
      if (!tick || !Number.isFinite(tick.quote)) return;
      const cache = this.symbolCache.get(symbol);
      if (!cache) {
        this.symbolCache.set(symbol, {
          ticks: [tick],
          candles: [],
          lastQuote: tick.quote,
        });
      } else {
        const lastCached = cache.ticks[cache.ticks.length - 1];
        if (!lastCached || tick.epoch > lastCached.epoch) {
          cache.ticks.push(tick);
          if (cache.ticks.length > MAX_CLIENT_TICKS) {
            cache.ticks.shift();
          }
          cache.lastQuote = tick.quote;
        } else {
          return;
        }
      }

      if (symbol === this.currentSymbol) {
        this.lastQuote = tick.quote;
        if (emitToListeners) {
          this.tickListeners.forEach((cb) => cb(tick));
          this.botTickListeners.forEach((cb) => cb(tick));
        }
      }
    });
  }

  private connectCustomWs(url: string) {
    this.disconnectWs();
    this.disconnectServerStream();
    try {
      this.ws = new WebSocket(url);
      this.ws.onopen = () => {
        this.isConnected = true;
        this.dataSource = 'live';
        this.latencyMs = 22;
        this.stopOfflineFallback();
        this.notifyConnectionState();
      };
      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.tick) {
            this.handleCustomTick(data.tick);
          }
        } catch {
          // ignore
        }
      };
      this.ws.onerror = () => this.fallbackToServerStream();
      this.ws.onclose = () => this.fallbackToServerStream();
    } catch {
      this.fallbackToServerStream();
    }
  }

  private disconnectWs() {
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
  }

  private fallbackToServerStream() {
    this.disconnectWs();
    this.dataSource = 'demo';
    this.isConnected = true;
    if (typeof window !== 'undefined') {
      this.connectServerStream();
    } else {
      this.startOfflineFallback();
    }
    this.notifyConnectionState();
  }

  private handleCustomTick(data: { quote: number; epoch?: number }) {
    const prevQuote = this.getCurrentQuote();
    const quote = Number(data.quote);
    const direction: 'up' | 'down' | 'flat' =
      quote > prevQuote ? 'up' : quote < prevQuote ? 'down' : 'flat';
    const lastDigit = extractLastDigit(quote, this.currentMarket.decimals);
    const tick: Tick = {
      epoch: data.epoch ? data.epoch * 1000 : Date.now(),
      quote,
      symbol: this.currentSymbol,
      direction,
      lastDigit,
    };

    this.mergeSymbolSnapshot(this.currentSymbol, [tick], []);
    this.lastQuote = quote;
    this.tickListeners.forEach((cb) => cb(tick));
    this.botTickListeners.forEach((cb) => cb(tick));
  }

  // Offline/Node-test fallback ONLY (not used when server SSE is active)
  private startOfflineFallback() {
    this.stopOfflineFallback();
    this.isConnected = true;
    this.fallbackSimInterval = setInterval(() => {
      this.generateOfflineTick();
    }, 1000);
  }

  private stopOfflineFallback() {
    if (this.fallbackSimInterval) {
      clearInterval(this.fallbackSimInterval);
      this.fallbackSimInterval = null;
    }
    if (this.fallbackPollInterval) {
      clearInterval(this.fallbackPollInterval);
      this.fallbackPollInterval = null;
    }
  }

  private seedOfflineHistory(market: Market) {
    let base = 6124.5;
    if (market.symbol.includes('CRASH')) base = 10500;
    else if (market.symbol.includes('BOOM')) base = 8200;
    else if (market.symbol.includes('75')) base = 7500;
    else if (market.symbol.includes('50')) base = 4850;
    else if (market.symbol.includes('25')) base = 2450;
    else if (market.symbol.includes('10')) base = 1250;

    const now = Math.floor(Date.now() / 1000) * 1000;
    const stepSize = market.pipSize || 0.01;
    const ticks: Tick[] = [];
    let p = base;
    for (let i = 79; i >= 0; i--) {
      const next = Number(Math.max(stepSize, p + (Math.random() - 0.498) * stepSize * 14).toFixed(market.decimals));
      const direction: 'up' | 'down' | 'flat' = next > p ? 'up' : next < p ? 'down' : 'flat';
      p = next;
      ticks.push({
        epoch: now - i * 1000,
        quote: p,
        symbol: market.symbol,
        direction,
        lastDigit: extractLastDigit(p, market.decimals),
      });
    }
    this.symbolCache.set(market.symbol, { ticks, candles: [], lastQuote: p });
    this.lastQuote = p;
  }

  private generateOfflineTick() {
    const prev = this.getCurrentQuote();
    const stepSize = this.currentMarket.pipSize || 0.01;
    const next = Number(Math.max(stepSize, prev + (Math.random() - 0.498) * stepSize * 15).toFixed(this.currentMarket.decimals));
    const tick: Tick = {
      epoch: Date.now(),
      quote: next,
      symbol: this.currentSymbol,
      direction: next > prev ? 'up' : next < prev ? 'down' : 'flat',
      lastDigit: extractLastDigit(next, this.currentMarket.decimals),
    };
    this.mergeSymbolSnapshot(this.currentSymbol, [tick], []);
    this.lastQuote = next;
    this.tickListeners.forEach((cb) => cb(tick));
    this.botTickListeners.forEach((cb) => cb(tick));
  }

  private notifyConnectionState() {
    this.connectionListeners.forEach((cb) =>
      cb(this.isConnected, this.dataSource, this.latencyMs)
    );
  }
}

export const marketDataProvider = new MarketDataProviderService();
export const derivWsService = marketDataProvider;
