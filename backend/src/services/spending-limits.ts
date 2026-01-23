/**
 * Spending Limits Service
 *
 * Handles spending limit calculations for AI agents:
 * - Daily limit reset at midnight EST (America/Toronto)
 * - Monthly limit reset on first of month
 * - Per-transaction limit checks
 */

import { DateTime } from 'luxon';
import { Decimal } from '@prisma/client/runtime/library';
import { Agent } from '@prisma/client';
import { prisma } from '../config/database';
import { env } from '../config/env';

// =============================================================================
// TYPES
// =============================================================================

export interface SpendingLimitResult {
  allowed: boolean;
  reason?: string;
  triggerType?: 'per_transaction' | 'daily_limit' | 'monthly_limit';
}

export interface SpendingUsage {
  daily: Decimal;
  monthly: Decimal;
  dailyPeriodStart: Date;
  monthlyPeriodStart: Date;
}

// =============================================================================
// TIMEZONE UTILITIES
// =============================================================================

/**
 * Get the start of the current day in the configured timezone (EST/EDT)
 */
export function getDayStart(timezone: string = env.DAILY_LIMIT_RESET_TIMEZONE): Date {
  const now = DateTime.now().setZone(timezone);
  const startOfDay = now.startOf('day');
  return startOfDay.toJSDate();
}

/**
 * Get the start of the current month in UTC
 */
export function getMonthStart(): Date {
  const now = DateTime.now().setZone('UTC');
  const startOfMonth = now.startOf('month');
  return startOfMonth.toJSDate();
}

/**
 * Get the period boundaries for a transaction
 */
export function getPeriodBoundaries(): { dailyPeriodStart: Date; monthlyPeriodStart: Date } {
  return {
    dailyPeriodStart: getDayStart(),
    monthlyPeriodStart: getMonthStart(),
  };
}

// =============================================================================
// SPENDING CALCULATIONS
// =============================================================================

/**
 * Calculate total spending for an agent in the current day (EST timezone)
 */
export async function calculateDailyUsage(agentId: string): Promise<Decimal> {
  const dayStart = getDayStart();

  const result = await prisma.agentTransaction.aggregate({
    where: {
      agentId,
      status: 'completed',
      dailyPeriodStart: { gte: dayStart },
    },
    _sum: { amount: true },
  });

  return result._sum.amount || new Decimal(0);
}

/**
 * Calculate total spending for an agent in the current month
 */
export async function calculateMonthlyUsage(agentId: string): Promise<Decimal> {
  const monthStart = getMonthStart();

  const result = await prisma.agentTransaction.aggregate({
    where: {
      agentId,
      status: 'completed',
      monthlyPeriodStart: { gte: monthStart },
    },
    _sum: { amount: true },
  });

  return result._sum.amount || new Decimal(0);
}

/**
 * Get current spending usage for an agent
 */
export async function getSpendingUsage(agentId: string): Promise<SpendingUsage> {
  const [daily, monthly] = await Promise.all([
    calculateDailyUsage(agentId),
    calculateMonthlyUsage(agentId),
  ]);

  return {
    daily,
    monthly,
    ...getPeriodBoundaries(),
  };
}

// =============================================================================
// LIMIT CHECKING
// =============================================================================

/**
 * Format currency for display
 */
export function formatCurrency(amount: Decimal, currency: string): string {
  const formatter = new Intl.NumberFormat('en-CA', {
    style: 'currency',
    currency,
  });
  return formatter.format(amount.toNumber());
}

/**
 * Check if a transaction amount is within an agent's spending limits
 *
 * Returns:
 * - allowed: true if within all limits
 * - reason: human-readable explanation if not allowed
 * - triggerType: which limit was exceeded
 */
export async function checkSpendingLimits(
  agent: Pick<Agent, 'id' | 'perTransactionLimit' | 'dailyLimit' | 'monthlyLimit' | 'limitCurrency'>,
  amount: Decimal | number | string
): Promise<SpendingLimitResult> {
  const amountDecimal = amount instanceof Decimal ? amount : new Decimal(amount);
  const currency = agent.limitCurrency;

  // 1. Check per-transaction limit first (no DB call needed)
  if (amountDecimal.greaterThan(agent.perTransactionLimit)) {
    return {
      allowed: false,
      reason: `Amount ${formatCurrency(amountDecimal, currency)} exceeds per-transaction limit of ${formatCurrency(agent.perTransactionLimit, currency)}`,
      triggerType: 'per_transaction',
    };
  }

  // 2. Check daily limit
  const dailyUsage = await calculateDailyUsage(agent.id);
  const projectedDaily = dailyUsage.plus(amountDecimal);

  if (projectedDaily.greaterThan(agent.dailyLimit)) {
    const remaining = agent.dailyLimit.minus(dailyUsage);
    const remainingFormatted = remaining.lessThan(0) ? '$0.00' : formatCurrency(remaining, currency);

    return {
      allowed: false,
      reason: `Transaction would exceed daily limit of ${formatCurrency(agent.dailyLimit, currency)}. Remaining today: ${remainingFormatted}`,
      triggerType: 'daily_limit',
    };
  }

  // 3. Check monthly limit
  const monthlyUsage = await calculateMonthlyUsage(agent.id);
  const projectedMonthly = monthlyUsage.plus(amountDecimal);

  if (projectedMonthly.greaterThan(agent.monthlyLimit)) {
    const remaining = agent.monthlyLimit.minus(monthlyUsage);
    const remainingFormatted = remaining.lessThan(0) ? '$0.00' : formatCurrency(remaining, currency);

    return {
      allowed: false,
      reason: `Transaction would exceed monthly limit of ${formatCurrency(agent.monthlyLimit, currency)}. Remaining this month: ${remainingFormatted}`,
      triggerType: 'monthly_limit',
    };
  }

  // All limits passed
  return { allowed: true };
}

/**
 * Get remaining limits for an agent
 */
export async function getRemainingLimits(
  agent: Pick<Agent, 'id' | 'perTransactionLimit' | 'dailyLimit' | 'monthlyLimit' | 'limitCurrency'>
): Promise<{
  perTransaction: Decimal;
  dailyRemaining: Decimal;
  monthlyRemaining: Decimal;
  currency: string;
}> {
  const usage = await getSpendingUsage(agent.id);

  const dailyRemaining = agent.dailyLimit.minus(usage.daily);
  const monthlyRemaining = agent.monthlyLimit.minus(usage.monthly);

  return {
    perTransaction: agent.perTransactionLimit,
    dailyRemaining: dailyRemaining.lessThan(0) ? new Decimal(0) : dailyRemaining,
    monthlyRemaining: monthlyRemaining.lessThan(0) ? new Decimal(0) : monthlyRemaining,
    currency: agent.limitCurrency,
  };
}

/**
 * Get the maximum auto-approve amount for an agent
 * This is the minimum of: per-transaction limit, daily remaining, monthly remaining
 */
export async function getMaxAutoApproveAmount(
  agent: Pick<Agent, 'id' | 'perTransactionLimit' | 'dailyLimit' | 'monthlyLimit' | 'limitCurrency'>
): Promise<Decimal> {
  const remaining = await getRemainingLimits(agent);

  // Find the minimum of all limits
  let max = remaining.perTransaction;

  if (remaining.dailyRemaining.lessThan(max)) {
    max = remaining.dailyRemaining;
  }

  if (remaining.monthlyRemaining.lessThan(max)) {
    max = remaining.monthlyRemaining;
  }

  return max.lessThan(0) ? new Decimal(0) : max;
}
