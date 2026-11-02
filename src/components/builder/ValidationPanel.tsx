import React from 'react';
import { Strategy, ValidationIssue } from '../../types/trading';
import { AlertCircle, AlertTriangle, CheckCircle2 } from 'lucide-react';

export function validateStrategy(strategy: Strategy): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // 1. Check for Market Data block
  const hasMarket = strategy.blocks.some((b) => b.type === 'market_data');
  if (!hasMarket) {
    issues.push({
      id: 'missing_market',
      severity: 'error',
      message: 'Strategy must include a Market Data Feed block to source price updates.',
    });
  }

  // 2. Check for Action Trade block
  const actionBlocks = strategy.blocks.filter((b) => b.type === 'action_trade');
  if (actionBlocks.length === 0) {
    issues.push({
      id: 'missing_action',
      severity: 'error',
      message: 'Strategy must include at least one Execute Contract action block.',
    });
  } else {
    // Check if each action block has an incoming connection
    actionBlocks.forEach((act) => {
      const isConnected = strategy.connections.some((c) => c.toBlockId === act.id);
      if (!isConnected) {
        issues.push({
          id: `unconnected_action_${act.id}`,
          blockId: act.id,
          severity: 'warning',
          message: `Action block "${act.title}" has no incoming trigger condition.`,
        });
      }

      // Check stake limits
      const stake = act.params.stake || 0;
      if (stake <= 0) {
        issues.push({
          id: `invalid_stake_${act.id}`,
          blockId: act.id,
          severity: 'error',
          message: `Action block "${act.title}" has invalid stake amount ($${stake}).`,
        });
      } else if (stake > 5000) {
        issues.push({
          id: `excessive_stake_${act.id}`,
          blockId: act.id,
          severity: 'warning',
          message: `Stake ($${stake}) exceeds recommended maximum ($5,000).`,
        });
      }
    });
  }

  // 3. Check for indicators without input connection
  const indicatorBlocks = strategy.blocks.filter(
    (b) => b.category === 'indicator' && b.type !== 'last_digit'
  );
  indicatorBlocks.forEach((ind) => {
    const hasInput = strategy.connections.some((c) => c.toBlockId === ind.id);
    if (!hasInput) {
      issues.push({
        id: `unconnected_indicator_${ind.id}`,
        blockId: ind.id,
        severity: 'warning',
        message: `Indicator "${ind.title}" is missing price input feed.`,
      });
    }
  });

  // 4. Check risk management
  const hasRiskBlock = strategy.blocks.some((b) => b.type === 'risk_management');
  if (!hasRiskBlock && (!strategy.riskLimits.stopLossLimit || strategy.riskLimits.stopLossLimit <= 0)) {
    issues.push({
      id: 'missing_risk',
      severity: 'warning',
      message: 'No Stop Loss limit detected. Automated execution could sustain severe drawdowns.',
    });
  }

  return issues;
}

interface ValidationPanelProps {
  strategy: Strategy;
  onSelectBlock?: (blockId: string) => void;
}

export const ValidationPanel: React.FC<ValidationPanelProps> = ({
  strategy,
  onSelectBlock,
}) => {
  const issues = validateStrategy(strategy);
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');

  const isValid = errors.length === 0;

  return (
    <div className="bg-[#090D16] border border-slate-800 rounded-lg p-3 text-xs space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="font-semibold text-slate-300">Rule Validation Status</span>
        <div className="flex items-center gap-1.5 font-medium">
          {isValid ? (
            <span className="flex items-center gap-1 text-emerald-400">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Valid for Execution</span>
            </span>
          ) : (
            <span className="flex items-center gap-1 text-rose-400">
              <AlertCircle className="w-3.5 h-3.5" />
              <span>{errors.length} Block Error(s)</span>
            </span>
          )}
        </div>
      </div>

      {issues.length > 0 ? (
        <div className="space-y-1.5 max-h-40 overflow-y-auto">
          {issues.map((issue) => (
            <div
              key={issue.id}
              onClick={() => issue.blockId && onSelectBlock?.(issue.blockId)}
              className={`p-2 rounded border flex items-start gap-2 ${
                issue.blockId ? 'cursor-pointer hover:bg-slate-800/80 transition-colors' : ''
              } ${
                issue.severity === 'error'
                  ? 'bg-rose-950/20 border-rose-500/30 text-rose-300'
                  : 'bg-amber-950/20 border-amber-500/30 text-amber-300'
              }`}
            >
              {issue.severity === 'error' ? (
                <AlertCircle className="w-3.5 h-3.5 shrink-0 text-rose-400 mt-0.5" />
              ) : (
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-400 mt-0.5" />
              )}
              <span className="text-[11px] leading-tight">{issue.message}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[11px] text-slate-500">
          All logic connections, parameters, and risk limits meet institutional verification invariants.
        </p>
      )}
    </div>
  );
};
