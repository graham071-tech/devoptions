/**
 * Provider-Independent Market Data Service for DevOptions
 * Supports:
 * 1. Default Simulated Demo Market Feed (Zero broker dependency, realistic mathematical volatility model)
 * 2. Custom Webhook / WebSocket Market Data Gateway (Configurable by website owner)
 *
 * Separates market data telemetry from financial trade execution.
 */

import { Candle, Market, Tick } from '../types/trading';
import { extractLastDigit } from '../utils/indicators';
import { SYNTHETIC_MARKETS } from '../data/syntheticMarkets';

type TickCallback = (tick: Tick) => void;
type CandlesCallback = (candles: Candle[]) => void;
type ConnectionStateCallback = (connected: boolean, source: 'live' | 'demo', latencyMs: number) => void;

export interface MarketProviderConfig {
  providerType: 'demo' | 'custom_ws';
  customWsUrl?: string;
  customApiKey?: string;
  reconnectIntervalMs: number;
}

class MarketDataProviderService {
  private currentMarket: Market = SYNTHETIC_MARKETS[0];
  private currentSymbol: string = 'R_100';
  private config: MarketProviderConfig = {
    providerType: 'demo',
    reconnectIntervalMs: 5000,
  };

  private ws: WebSocket | null = null;
  private simulationInterval: any = null;
  private isConnected: boolean = true;
  private latencyMs: number = 18;
  private dataSource: 'live' | 'demo' = 'demo';

  private tickListeners: Set<TickCallback> = new Set();
  private candleListeners: Set<CandlesCallback> = new Set();
  private connectionListeners: Set<ConnectionStateCallback> = new Set();

  private lastQuote: number = 6124.5;
  private lastCandles: Candle[] = [];

  constructor() {
    this.seedInitialHistory();
    this.startSimulation();
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
      this.startSimulation();
      this.notifyConnectionState();
    }
  }

  public setMarket(market: Market) {
    const symbolChanged = this.currentSymbol !== market.symbol;
    this.currentMarket = market;
    this.currentSymbol = market.symbol;

    if (symbolChanged) {
      this.seedInitialHistory();
      if (this.dataSource === 'live' && this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ subscribe_ticks: this.currentSymbol }));
      }
    }
  }

  public getCurrentQuote(): number {
    return this.lastQuote;
  }

  public getCandles(): Candle[] {
    return [...this.lastCandles];
  }

  public subscribeToTicks(cb: TickCallback): () => void {
    this.tickListeners.add(cb);
    return () => this.tickListeners.delete(cb);
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
    } else {
      this.startSimulation();
    }
  }

  public disconnect() {
    this.disconnectWs();
    if (this.simulationInterval) {
      clearInterval(this.simulationInterval);
      this.simulationInterval = null;
    }
    this.isConnected = false;
    this.notifyConnectionState();
  }

  // Compatibility helper for legacy code
  public connect(appId?: string, token?: string) {
    if (token && this.config.customWsUrl) {
      this.configureProvider({ providerType: 'custom_ws' });
    } else {
      this.configureProvider({ providerType: 'demo' });
    }
  }

  private connectCustomWs(url: string) {
    this.disconnectWs();
    try {
      this.ws = new WebSocket(url);
      this.ws.onopen = () => {
        this.isConnected = true;
        this.dataSource = 'live';
        this.latencyMs = 22;
        this.stopSimulation();
        this.notifyConnectionState();
      };
      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.tick) {
            this.handleCustomTick(data.tick);
          }
        } catch (e) {
          // parse error
        }
      };
      this.ws.onerror = () => {
        this.fallbackToSimulation();
      };
      this.ws.onclose = () => {
        this.fallbackToSimulation();
      };
    } catch (e) {
      this.fallbackToSimulation();
    }
  }

  private disconnectWs() {
    if (this.ws) {
      try {
        this.ws.close();
      } catch (e) {}
      this.ws = null;
    }
  }

  private fallbackToSimulation() {
    this.disconnectWs();
    this.dataSource = 'demo';
    this.isConnected = true;
    this.latencyMs = 15;
    this.startSimulation();
    this.notifyConnectionState();
  }

  private handleCustomTick(data: { quote: number; epoch?: number }) {
    const prevQuote = this.lastQuote;
    this.lastQuote = Number(data.quote);
    const direction: 'up' | 'down' | 'flat' =
      this.lastQuote > prevQuote ? 'up' : this.lastQuote < prevQuote ? 'down' : 'flat';
    const lastDigit = extractLastDigit(this.lastQuote, this.currentMarket.decimals);

    const tick: Tick = {
      epoch: data.epoch ? data.epoch * 1000 : Date.now(),
      quote: this.lastQuote,
      symbol: this.currentSymbol,
      direction,
      lastDigit,
    };

    this.tickListeners.forEach((cb) => cb(tick));
  }

  private startSimulation() {
    this.stopSimulation();
    this.isConnected = true;
    this.dataSource = 'demo';
    this.notifyConnectionState();

    // Generate ticks at realistic intervals (1 tick per second)
    this.simulationInterval = setInterval(() => {
      this.generateSimulatedTick();
    }, 1000);
  }

  private stopSimulation() {
    if (this.simulationInterval) {
      clearInterval(this.simulationInterval);
      this.simulationInterval = null;
    }
  }

  private seedInitialHistory() {
    const symbol = this.currentMarket.symbol;
    let base = 6000;
    if (symbol.includes('10')) base = 1250;
    else if (symbol.includes('25')) base = 2450;
    else if (symbol.includes('50')) base = 4850;
    else if (symbol.includes('75')) base = 7500;
    else if (symbol.includes('100')) base = 6124;
    else if (symbol.includes('CRASH')) base = 10500;
    else if (symbol.includes('BOOM')) base = 8200;

    this.lastQuote = base;
    const now = Date.now();
    const count = 60;
    const candles: Candle[] = [];

    let current = base;
    for (let i = count; i >= 0; i--) {
      const time = now - i * 60000;
      const change = (Math.random() - 0.495) * (base * 0.0008);
      const open = current;
      const close = Number((open + change).toFixed(this.currentMarket.decimals));
      const high = Number((Math.max(open, close) + Math.random() * (base * 0.0004)).toFixed(this.currentMarket.decimals));
      const low = Number((Math.min(open, close) - Math.random() * (base * 0.0004)).toFixed(this.currentMarket.decimals));

      candles.push({ epoch: time, open, high, low, close });
      current = close;
    }

    this.lastCandles = candles;
    this.lastQuote = current;
  }

  private generateSimulatedTick() {
    const prevQuote = this.lastQuote;
    const stepSize = this.currentMarket.pipSize || 0.01;
    const decimals = this.currentMarket.decimals;

    // Geometric Brownian Motion step
    const randomFactor = (Math.random() - 0.498);
    let delta = randomFactor * (stepSize * 15);

    // Asymmetric spike dynamics for Crash/Boom
    if (this.currentMarket.category === 'crash_boom') {
      if (this.currentMarket.symbol.includes('CRASH') && Math.random() < 0.05) {
        delta = -stepSize * 80; // Sudden drop
      } else if (this.currentMarket.symbol.includes('BOOM') && Math.random() < 0.05) {
        delta = stepSize * 80; // Sudden spike
      }
    }

    let nextQuote = Number((prevQuote + delta).toFixed(decimals));
    if (nextQuote <= 0) nextQuote = prevQuote;

    this.lastQuote = nextQuote;
    const direction: 'up' | 'down' | 'flat' =
      nextQuote > prevQuote ? 'up' : nextQuote < prevQuote ? 'down' : 'flat';
    const lastDigit = extractLastDigit(nextQuote, decimals);

    const tick: Tick = {
      epoch: Date.now(),
      quote: nextQuote,
      symbol: this.currentSymbol,
      direction,
      lastDigit,
    };

    // Update active candle
    if (this.lastCandles.length > 0) {
      const lastCandle = this.lastCandles[this.lastCandles.length - 1];
      const now = Date.now();
      if (now - lastCandle.epoch < 60000) {
        lastCandle.close = nextQuote;
        if (nextQuote > lastCandle.high) lastCandle.high = nextQuote;
        if (nextQuote < lastCandle.low) lastCandle.low = nextQuote;
      } else {
        this.lastCandles.push({
          epoch: now,
          open: nextQuote,
          high: nextQuote,
          low: nextQuote,
          close: nextQuote,
        });
        if (this.lastCandles.length > 100) this.lastCandles.shift();
      }
    }

    this.tickListeners.forEach((cb) => cb(tick));
  }

  private notifyConnectionState() {
    this.connectionListeners.forEach((cb) =>
      cb(this.isConnected, this.dataSource, this.latencyMs)
    );
  }
}

export const marketDataProvider = new MarketDataProviderService();
// Backwards compatibility alias:
export const derivWsService = marketDataProvider;
