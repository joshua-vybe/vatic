import { getPrismaClient } from '../db';
import { getFundedAccountState, updateFundedAccountRules, FundedAccountRules } from '../utils/funded-account-state';
import { publishEvent } from '../utils/kafka';
import { createLogger } from '../utils/logger';

const logger = createLogger('funded-account-rules-worker');

let monitoringInterval: NodeJS.Timeout | null = null;
let isRunning = false;

export async function startFundedAccountRulesWorker(): Promise<void> {
  if (isRunning) {
    logger.warn('Funded account rules worker already running');
    return;
  }

  isRunning = true;
  logger.info('Starting funded account rules worker');

  monitoringInterval = setInterval(async () => {
    await monitorFundedAccountRules();
  }, 1500); // Run every 1.5 seconds
}

export async function stopFundedAccountRulesWorker(): Promise<void> {
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
    monitoringInterval = null;
  }
  isRunning = false;
  logger.info('Funded account rules worker stopped');
}

async function monitorFundedAccountRules(): Promise<void> {
  const correlationId = `monitor-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

  try {
    const prisma = getPrismaClient();

    // Query all active funded accounts
    const fundedAccounts = await prisma.fundedAccount.findMany({
      where: { status: 'active' },
      include: { tier: true },
    });

    logger.debug('Monitoring funded account rules', {
      correlationId,
      count: fundedAccounts.length,
    });

    let violationsDetected = 0;
    let errorsEncountered = 0;

    for (const fundedAccount of fundedAccounts) {
      try {
        // Fetch Redis state
        const accountState = await getFundedAccountState(fundedAccount.id);
        if (!accountState) {
          continue;
        }

        // Calculate drawdown: (peakBalance - currentBalance) / peakBalance
        const peakBalance = accountState.peakBalance || accountState.currentBalance;
        const currentBalance = accountState.currentBalance;
        const drawdown = peakBalance > 0 ? (peakBalance - currentBalance) / peakBalance : 0;

        // Calculate risk per trade (max position size / balance)
        let maxRiskPerTrade = 0;
        if (accountState.positions && accountState.positions.length > 0) {
          for (const position of accountState.positions) {
            const positionSize = position.quantity * position.entryPrice;
            const riskPerTrade = positionSize / currentBalance;
            if (riskPerTrade > maxRiskPerTrade) {
              maxRiskPerTrade = riskPerTrade;
            }
          }
        }

        // Determine rule status
        const drawdownStatus = calculateRuleStatus(drawdown, fundedAccount.tier.maxDrawdown);
        const riskPerTradeStatus = calculateRuleStatus(maxRiskPerTrade, fundedAccount.tier.maxRiskPerTrade);

        // Update rules in Redis
        const rules: FundedAccountRules = {
          drawdown: {
            value: drawdown,
            threshold: fundedAccount.tier.maxDrawdown,
            status: drawdownStatus,
          },
          riskPerTrade: {
            value: maxRiskPerTrade,
            threshold: fundedAccount.tier.maxRiskPerTrade,
            status: riskPerTradeStatus,
          },
        };

        await updateFundedAccountRules(fundedAccount.id, rules);

        // Check for violations
        if (drawdownStatus === 'violation' || riskPerTradeStatus === 'violation') {
          await handleFundedAccountViolation(
            fundedAccount.id,
            drawdownStatus === 'violation' ? 'drawdown' : 'risk_per_trade',
            drawdownStatus === 'violation' ? drawdown : maxRiskPerTrade,
            drawdownStatus === 'violation' ? fundedAccount.tier.maxDrawdown : fundedAccount.tier.maxRiskPerTrade,
            correlationId
          );
          violationsDetected++;
        }

        logger.debug('Funded account rules monitored', {
          fundedAccountId: fundedAccount.id,
          drawdownStatus,
          riskPerTradeStatus,
          drawdown: `${(drawdown * 100).toFixed(2)}%`,
          maxRiskPerTrade: `${(maxRiskPerTrade * 100).toFixed(2)}%`,
        });
      } catch (error) {
        logger.error('Failed to monitor funded account rules', {
          fundedAccountId: fundedAccount.id,
          error: String(error),
        });
        errorsEncountered++;
      }
    }

    logger.debug('Funded account rules monitoring cycle completed', {
      correlationId,
      fundedAccountsProcessed: fundedAccounts.length,
      violationsDetected,
      errors: errorsEncountered,
    });
  } catch (error) {
    logger.error('Funded account rules monitoring worker cycle failed', {
      correlationId,
      error: String(error),
    });
  }
}

function calculateRuleStatus(value: number, threshold: number): 'safe' | 'warning' | 'danger' | 'violation' {
  if (value < threshold * 0.8) {
    return 'safe';
  } else if (value >= threshold * 0.8 && value < threshold * 0.9) {
    return 'warning';
  } else if (value >= threshold * 0.9 && value < threshold) {
    return 'danger';
  } else {
    return 'violation';
  }
}

async function handleFundedAccountViolation(
  fundedAccountId: string,
  ruleType: string,
  value: number,
  threshold: number,
  correlationId: string
): Promise<void> {
  try {
    const prisma = getPrismaClient();

    logger.error('Funded account rule violation detected', {
      fundedAccountId,
      ruleType,
      value,
      threshold,
      correlationId,
    });

    // Update funded account status to 'closed'
    await prisma.fundedAccount.update({
      where: { id: fundedAccountId },
      data: {
        status: 'closed',
        closedAt: new Date(),
        closureReason: `Rule violation: ${ruleType}`,
      },
    });

    // Publish violation event
    await publishEvent('rules.violation-detected', {
      fundedAccountId,
      ruleType,
      value,
      threshold,
      correlationId,
      timestamp: new Date(),
    });

    logger.info('Funded account violation handled', {
      fundedAccountId,
      ruleType,
      correlationId,
    });
  } catch (error) {
    logger.error('Failed to handle funded account violation', {
      fundedAccountId,
      ruleType,
      error: String(error),
      correlationId,
    });
  }
}
