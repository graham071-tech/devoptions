import {
  BacktestResult,
  BacktestSettings,
  SimulatedBacktestTrade,
  Strategy,
} from '../types/trading';
import { calculateEMA, calculateRSI, extractLastDigit } from './indicators';

export function runBacktestSimulation(
  strategy: Strategy,
  settings: BacktestSettings,
  quotes: number[],
  decimals: number
): BacktestResult {
  const { initialBalance, stake, payoutRate, durationTicks, applyMartingale, martingaleMultiplier } =
    settings;

  const trades: SimulatedBacktestTrade[] = [];
  const balanceCurve: { index: number; balance: number; tradePnl: number; isWin: boolean }[] = [
    { index: 0, balance: initialBalance, tradePnl: 0, isWin: true },
  ];

  let currentBalance = initialBalance;
  let currentStake = stake;
  let wins = 0;
  let losses = 0;
  let maxDrawdown = 0;
  let maxDrawdownPercent = 0;
  let peakBalance = initialBalance;
  let currentConsecWins = 0;
  let maxConsecWins = 0;
  let currentConsecLosses = 0;
  let maxConsecLosses = 0;
  let grossProfit = 0;
  let grossLoss = 0;

  // Pre-calculate indicators on quotes
  const rsiValues = calculateRSI(quotes, 14);
  const emaFastValues = calculateEMA(quotes, 9);
  const emaSlowValues = calculateEMA(quotes, 21);

  // Determine strategy intent from blocks or default to RSI / Trend
  const isRsiStrat = strategy.blocks.some((b) => b.type === 'indicator_rsi');
  const isEmaStrat = strategy.blocks.some((b) => b.type === 'indicator_ema');
  const isDigitStrat = strategy.blocks.some((b) => b.type === 'last_digit');

  const startIndex = Math.max(30, durationTicks);
  const step = Math.max(1, Math.floor(durationTicks / 2)); // trade spacing

  let i = startIndex;
  while (i < quotes.length - durationTicks) {
    if (currentBalance < currentStake) {
      break; // Account margin exhausted
    }

    let shouldTrade = false;
    let contractType = settings.contractType;
    let reason = '';

    if (isRsiStrat) {
      const rsi = rsiValues[i];
      if (rsi !== null) {
        if (rsi < 32) {
          shouldTrade = true;
          contractType = 'CALL';
          reason = `RSI oversold (${rsi.toFixed(1)} < 32)`;
        } else if (rsi > 68) {
          shouldTrade = true;
          contractType = 'PUT';
          reason = `RSI overbought (${rsi.toFixed(1)} > 68)`;
        }
      }
    } else if (isEmaStrat) {
      const fast = emaFastValues[i];
      const slow = emaSlowValues[i];
      const prevFast = emaFastValues[i - 1];
      const prevSlow = emaSlowValues[i - 1];

      if (fast && slow && prevFast && prevSlow) {
        if (prevFast <= prevSlow && fast > slow) {
          shouldTrade = true;
          contractType = 'CALL';
          reason = 'Fast EMA crossed above Slow EMA';
        } else if (prevFast >= prevSlow && fast < slow) {
          shouldTrade = true;
          contractType = 'PUT';
          reason = 'Fast EMA crossed below Slow EMA';
        }
      }
    } else if (isDigitStrat) {
      const prevDigit = extractLastDigit(quotes[i], decimals);
      shouldTrade = true;
      contractType = prevDigit % 2 === 0 ? 'ODD' : 'EVEN';
      reason = `Last digit was ${prevDigit}, expecting parity change`;
    } else {
      // Default price momentum trigger
      const change = quotes[i] - quotes[i - 2];
      if (Math.abs(change) > 0.001) {
        shouldTrade = true;
        contractType = change > 0 ? 'CALL' : 'PUT';
        reason = change > 0 ? 'Short-term upward momentum' : 'Short-term downward momentum';
      }
    }

    if (shouldTrade) {
      const entryPrice = quotes[i];
      const exitIndex = i + durationTicks;
      const exitPrice = quotes[exitIndex];

      let isWin = false;
      const entryDigit = extractLastDigit(entryPrice, decimals);
      const exitDigit = extractLastDigit(exitPrice, decimals);

      if (contractType === 'CALL') {
        isWin = exitPrice > entryPrice;
      } else if (contractType === 'PUT') {
        isWin = exitPrice < entryPrice;
      } else if (contractType === 'EVEN') {
        isWin = exitDigit % 2 === 0;
      } else if (contractType === 'ODD') {
        isWin = exitDigit % 2 !== 0;
      } else if (contractType === 'MATCHES') {
        isWin = exitDigit === entryDigit;
      } else if (contractType === 'DIFFERS') {
        isWin = exitDigit !== entryDigit;
      }

      const pnl = isWin
        ? Number((currentStake * payoutRate).toFixed(2))
        : -Number(currentStake.toFixed(2));

      currentBalance = Number((currentBalance + pnl).toFixed(2));

      if (isWin) {
        wins++;
        grossProfit += pnl;
        currentConsecWins++;
        currentConsecLosses = 0;
        if (currentConsecWins > maxConsecWins) maxConsecWins = currentConsecWins;
        if (applyMartingale) {
          currentStake = stake; // reset on win
        }
      } else {
        losses++;
        grossLoss += Math.abs(pnl);
        currentConsecLosses++;
        currentConsecWins = 0;
        if (currentConsecLosses > maxConsecLosses) maxConsecLosses = currentConsecLosses;
        if (applyMartingale) {
          currentStake = Math.min(
            strategy.riskLimits.maxStake || 500,
            Number((currentStake * martingaleMultiplier).toFixed(2))
          );
        }
      }

      if (currentBalance > peakBalance) {
        peakBalance = currentBalance;
      }
      const dd = peakBalance - currentBalance;
      if (dd > maxDrawdown) {
        maxDrawdown = dd;
        maxDrawdownPercent = peakBalance > 0 ? (dd / peakBalance) * 100 : 0;
      }

      trades.push({
        id: `bt_${trades.length + 1}`,
        tradeIndex: trades.length + 1,
        timestamp: Date.now() - (quotes.length - i) * 2000,
        entryPrice,
        exitPrice,
        contractType,
        stake: currentStake,
        payout: isWin ? currentStake + pnl : 0,
        pnl,
        balanceAfter: currentBalance,
        isWin,
        reason,
      });

      balanceCurve.push({
        index: trades.length,
        balance: currentBalance,
        tradePnl: pnl,
        isWin,
      });

      i = exitIndex + (strategy.riskLimits.cooldownSeconds || 2);
    } else {
      i += step;
    }
  }

  const totalTrades = wins + losses;
  const winRate = totalTrades > 0 ? Number(((wins / totalTrades) * 100).toFixed(1)) : 0;
  const netProfit = Number((currentBalance - initialBalance).toFixed(2));
  const returnPercentage = Number(((netProfit / initialBalance) * 100).toFixed(1));
  const profitFactor = grossLoss > 0 ? Number((grossProfit / grossLoss).toFixed(2)) : grossProfit > 0 ? 99.9 : 0;

  // Run Monte Carlo simulation if trades exist
  const monteCarloPaths = runMonteCarlo(initialBalance, stake, payoutRate, winRate / 100, 100, 300);

  return {
    totalTrades,
    wins,
    losses,
    winRate,
    initialBalance,
    finalBalance: currentBalance,
    netProfit,
    returnPercentage,
    profitFactor,
    maxDrawdown: Number(maxDrawdown.toFixed(2)),
    maxDrawdownPercent: Number(maxDrawdownPercent.toFixed(1)),
    maxConsecutiveWins: maxConsecWins,
    maxConsecutiveLosses: maxConsecLosses,
    trades,
    balanceCurve,
    monteCarloPaths,
  };
}

export function runMonteCarlo(
  initialBalance: number,
  stake: number,
  payoutRate: number,
  winProb: number,
  numTrades: number = 80,
  numSimulations: number = 200
): number[][] {
  const paths: number[][] = [];

  for (let s = 0; s < numSimulations; s++) {
    const path: number[] = [initialBalance];
    let bal = initialBalance;

    for (let t = 0; t < numTrades; t++) {
      if (bal <= 0) {
        path.push(0);
        continue;
      }
      const isWin = Math.random() < winProb;
      const pnl = isWin ? stake * payoutRate : -stake;
      bal = Math.max(0, bal + pnl);
      path.push(Math.round(bal));
    }
    paths.push(path);
  }

  return paths;
}
