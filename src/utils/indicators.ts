/**
 * Technical indicators calculation engine for real-time and historical analysis
 */

export function calculateSMA(values: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      result.push(null);
    } else {
      let sum = 0;
      for (let j = 0; j < period; j++) {
        sum += values[i - j];
      }
      result.push(sum / period);
    }
  }
  return result;
}

export function calculateEMA(values: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  const k = 2 / (period + 1);
  let prevEma: number | null = null;

  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      result.push(null);
    } else if (i === period - 1) {
      let sum = 0;
      for (let j = 0; j < period; j++) {
        sum += values[j];
      }
      prevEma = sum / period;
      result.push(prevEma);
    } else {
      if (prevEma !== null) {
        prevEma = values[i] * k + prevEma * (1 - k);
        result.push(prevEma);
      } else {
        result.push(null);
      }
    }
  }
  return result;
}

export function calculateRSI(closes: number[], period: number = 14): (number | null)[] {
  const result: (number | null)[] = [];
  if (closes.length <= period) {
    return closes.map(() => null);
  }

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = 0; i < closes.length; i++) {
    if (i < period) {
      result.push(null);
    } else if (i === period) {
      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      const rsi = 100 - 100 / (1 + rs);
      result.push(Number(rsi.toFixed(2)));
    } else {
      const diff = closes[i] - closes[i - 1];
      const gain = diff > 0 ? diff : 0;
      const loss = diff < 0 ? Math.abs(diff) : 0;

      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;

      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      const rsi = 100 - 100 / (1 + rs);
      result.push(Number(rsi.toFixed(2)));
    }
  }
  return result;
}

export interface BollingerBandsResult {
  upper: (number | null)[];
  middle: (number | null)[];
  lower: (number | null)[];
}

export function calculateBollingerBands(
  closes: number[],
  period: number = 20,
  multiplier: number = 2
): BollingerBandsResult {
  const middle = calculateSMA(closes, period);
  const upper: (number | null)[] = [];
  const lower: (number | null)[] = [];

  for (let i = 0; i < closes.length; i++) {
    const smaVal = middle[i];
    if (smaVal === null || i < period - 1) {
      upper.push(null);
      lower.push(null);
    } else {
      let sumSquares = 0;
      for (let j = 0; j < period; j++) {
        const diff = closes[i - j] - smaVal;
        sumSquares += diff * diff;
      }
      const stdDev = Math.sqrt(sumSquares / period);
      upper.push(smaVal + multiplier * stdDev);
      lower.push(smaVal - multiplier * stdDev);
    }
  }

  return { upper, middle, lower };
}

export interface MACDResult {
  macd: (number | null)[];
  signal: (number | null)[];
  histogram: (number | null)[];
}

export function calculateMACD(
  closes: number[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9
): MACDResult {
  const fastEma = calculateEMA(closes, fastPeriod);
  const slowEma = calculateEMA(closes, slowPeriod);

  const macdLine: (number | null)[] = [];
  for (let i = 0; i < closes.length; i++) {
    const f = fastEma[i];
    const s = slowEma[i];
    if (f !== null && s !== null) {
      macdLine.push(f - s);
    } else {
      macdLine.push(null);
    }
  }

  // Filter out nulls to calculate signal EMA on MACD line
  const validMacdValues: number[] = [];
  const validIndices: number[] = [];
  macdLine.forEach((val, idx) => {
    if (val !== null) {
      validMacdValues.push(val);
      validIndices.push(idx);
    }
  });

  const signalSubEma = calculateEMA(validMacdValues, signalPeriod);
  const signalLine: (number | null)[] = closes.map(() => null);
  const histogram: (number | null)[] = closes.map(() => null);

  for (let j = 0; j < validIndices.length; j++) {
    const origIdx = validIndices[j];
    const sigVal = signalSubEma[j];
    signalLine[origIdx] = sigVal;
    const mVal = macdLine[origIdx];
    if (mVal !== null && sigVal !== null) {
      histogram[origIdx] = mVal - sigVal;
    }
  }

  return { macd: macdLine, signal: signalLine, histogram };
}

export interface DigitStats {
  counts: number[];
  percentages: number[];
  sampleSize: number;
  hottestDigit: number;
  coldestDigit: number;
  evenCount: number;
  oddCount: number;
  evenPercent: number;
  oddPercent: number;
  underFivePercent: number;
  overFourPercent: number;
  recentDigits: number[];
  repeatStreak: { digit: number; count: number } | null;
}

export function extractLastDigit(quote: number, decimals: number): number {
  const formatted = quote.toFixed(decimals);
  const char = formatted.charAt(formatted.length - 1);
  const parsed = parseInt(char, 10);
  return isNaN(parsed) ? 0 : parsed;
}

export function analyzeLastDigits(
  quotes: number[],
  decimals: number,
  sampleSize: number = 100
): DigitStats {
  const recentQuotes = quotes.slice(-sampleSize);
  const digits = recentQuotes.map((q) => extractLastDigit(q, decimals));

  const counts = Array(10).fill(0);
  let evenCount = 0;
  let oddCount = 0;
  let underFiveCount = 0;
  let overFourCount = 0;

  for (const d of digits) {
    counts[d]++;
    if (d % 2 === 0) evenCount++;
    else oddCount++;

    if (d < 5) underFiveCount++;
    else overFourCount++;
  }

  const total = Math.max(digits.length, 1);
  const percentages = counts.map((c) => Number(((c / total) * 100).toFixed(1)));

  let hottest = 0;
  let coldest = 0;
  let maxCount = -1;
  let minCount = Infinity;

  for (let i = 0; i < 10; i++) {
    if (counts[i] > maxCount) {
      maxCount = counts[i];
      hottest = i;
    }
    if (counts[i] < minCount) {
      minCount = counts[i];
      coldest = i;
    }
  }

  // Calculate repeat streak
  let repeatStreak: { digit: number; count: number } | null = null;
  if (digits.length >= 2) {
    const lastDigit = digits[digits.length - 1];
    let count = 0;
    for (let i = digits.length - 1; i >= 0; i--) {
      if (digits[i] === lastDigit) count++;
      else break;
    }
    if (count >= 2) {
      repeatStreak = { digit: lastDigit, count };
    }
  }

  return {
    counts,
    percentages,
    sampleSize: digits.length,
    hottestDigit: hottest,
    coldestDigit: coldest,
    evenCount,
    oddCount,
    evenPercent: Number(((evenCount / total) * 100).toFixed(1)),
    oddPercent: Number(((oddCount / total) * 100).toFixed(1)),
    underFivePercent: Number(((underFiveCount / total) * 100).toFixed(1)),
    overFourPercent: Number(((overFourCount / total) * 100).toFixed(1)),
    recentDigits: digits.slice(-30),
    repeatStreak,
  };
}
