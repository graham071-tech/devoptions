/**
 * Fast, lightweight rolling technical analysis engine for automated trading.
 * Runs in O(n) over a bounded window (<= 60 points) with zero heavy allocations.
 */

import { ContractType } from '../types/trading';
import { extractLastDigit } from './indicators';

export interface FastSignalAnalysis {
  feedValid: boolean;
  shouldExecute: boolean;
  contractType: ContractType;
  targetDigit?: number;
  signalLabel: string;
  rsi: number;
  emaFast: number;
  emaSlow: number;
  reason?: string;
}

export function analyzeFastMarketSignal(
  prices: number[],
  decimals: number,
  contractType: ContractType
): FastSignalAnalysis {
  if (!Array.isArray(prices) || prices.length < 15) {
    return {
      feedValid: false,
      shouldExecute: false,
      contractType,
      signalLabel: 'WARMING BUFFER',
      rsi: 50,
      emaFast: 0,
      emaSlow: 0,
      reason: 'Awaiting sufficient market ticks for technical analysis.',
    };
  }

  const windowPrices = prices.slice(-60);
  const len = windowPrices.length;
  const latest = windowPrices[len - 1];
  const prev = windowPrices[len - 2];
  const prev2 = windowPrices[len - 3];

  if (!Number.isFinite(latest) || latest <= 0 || !Number.isFinite(prev)) {
    return {
      feedValid: false,
      shouldExecute: false,
      contractType,
      signalLabel: 'FEED INVALID',
      rsi: 50,
      emaFast: 0,
      emaSlow: 0,
      reason: 'Market quote stream returned invalid price data.',
    };
  }

  // Single-pass EMA(5), EMA(12), and RSI(14) calculation
  const kFast = 2 / (5 + 1);
  const kSlow = 2 / (12 + 1);
  let emaFast = windowPrices[0];
  let emaSlow = windowPrices[0];

  const rsiStart = Math.max(1, len - 14);
  let gains = 0;
  let losses = 0;

  for (let i = 1; i < len; i++) {
    const p = windowPrices[i];
    if (!Number.isFinite(p) || p <= 0) {
      return {
        feedValid: false,
        shouldExecute: false,
        contractType,
        signalLabel: 'FEED INVALID',
        rsi: 50,
        emaFast: 0,
        emaSlow: 0,
        reason: 'Market feed contains corrupt price points.',
      };
    }
    emaFast = p * kFast + emaFast * (1 - kFast);
    emaSlow = p * kSlow + emaSlow * (1 - kSlow);

    if (i >= rsiStart) {
      const diff = p - windowPrices[i - 1];
      if (diff >= 0) gains += diff;
      else losses += -diff;
    }
  }

  const avgGain = gains / 14;
  const avgLoss = losses / 14;
  const rsi =
    avgLoss === 0 ? (avgGain === 0 ? 50 : 100) : Number((100 - 100 / (1 + avgGain / avgLoss)).toFixed(1));

  // Detect frozen/dead feed (zero variance over last 15 ticks)
  let minP = latest;
  let maxP = latest;
  for (let i = Math.max(0, len - 15); i < len; i++) {
    if (windowPrices[i] < minP) minP = windowPrices[i];
    if (windowPrices[i] > maxP) maxP = windowPrices[i];
  }
  if (maxP === minP) {
    return {
      feedValid: false,
      shouldExecute: false,
      contractType,
      signalLabel: 'FEED STALLED',
      rsi,
      emaFast,
      emaSlow,
      reason: 'Market quotes have stalled with zero price movement.',
    };
  }

  const momentumUp = latest > prev && prev >= prev2;
  const momentumDown = latest < prev && prev <= prev2;

  if (contractType === 'CALL') {
    const confirmed =
      (emaFast > emaSlow && (rsi < 80 || momentumUp)) ||
      rsi <= 35 ||
      (momentumUp && rsi < 68);
    return {
      feedValid: true,
      shouldExecute: confirmed,
      contractType,
      signalLabel: confirmed ? 'BULLISH CONFIRMED' : 'SCANNING CALL',
      rsi,
      emaFast,
      emaSlow,
    };
  }

  if (contractType === 'PUT') {
    const confirmed =
      (emaFast < emaSlow && (rsi > 20 || momentumDown)) ||
      rsi >= 65 ||
      (momentumDown && rsi > 32);
    return {
      feedValid: true,
      shouldExecute: confirmed,
      contractType,
      signalLabel: confirmed ? 'BEARISH CONFIRMED' : 'SCANNING PUT',
      rsi,
      emaFast,
      emaSlow,
    };
  }

  // Digit-based contracts (EVEN, ODD, DIFFERS, MATCHES)
  const counts = new Int32Array(10);
  const digitSliceStart = Math.max(0, len - 25);
  let evenCount = 0;
  let oddCount = 0;
  for (let i = digitSliceStart; i < len; i++) {
    const d = extractLastDigit(windowPrices[i], decimals);
    counts[d]++;
    if (d % 2 === 0) evenCount++;
    else oddCount++;
  }

  const latestDigit = extractLastDigit(latest, decimals);

  if (contractType === 'EVEN') {
    const confirmed = latestDigit % 2 === 0 || evenCount >= oddCount;
    return {
      feedValid: true,
      shouldExecute: confirmed,
      contractType,
      signalLabel: confirmed ? 'EVEN PARITY READY' : 'SCANNING EVEN',
      rsi,
      emaFast,
      emaSlow,
    };
  }

  if (contractType === 'ODD') {
    const confirmed = latestDigit % 2 !== 0 || oddCount >= evenCount;
    return {
      feedValid: true,
      shouldExecute: confirmed,
      contractType,
      signalLabel: confirmed ? 'ODD PARITY READY' : 'SCANNING ODD',
      rsi,
      emaFast,
      emaSlow,
    };
  }

  // Find coldest and hottest digit for DIFFERS / MATCHES
  let coldestDigit = 0;
  let hottestDigit = 0;
  for (let d = 1; d < 10; d++) {
    if (counts[d] < counts[coldestDigit]) coldestDigit = d;
    if (counts[d] > counts[hottestDigit]) hottestDigit = d;
  }

  const targetDigit = contractType === 'MATCHES' ? hottestDigit : coldestDigit;

  return {
    feedValid: true,
    shouldExecute: true,
    contractType,
    targetDigit,
    signalLabel: `${contractType} #${targetDigit}`,
    rsi,
    emaFast,
    emaSlow,
  };
}
