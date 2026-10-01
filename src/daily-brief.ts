// ==========================================================
// PHASE 13.7 — DAILY BRIEF MODULE
// Aggregated status and insights for consumption by portal-os-console
// ==========================================================

import type { JsonObject, JsonValue } from './contracts';

export type DailyBriefMetrics = JsonObject & {
  timestamp: number;
  periodStart: number;
  periodEnd: number;
  messageCount: number;
  failureCount: number;
  successRate: number;
  averageProcessingTime: number;
  entropyAverage: number;
  identityCurvatureAverage: number;
  governanceDecisions: JsonObject;
  topLanes: Array<{ name: string; count: number }>;
};

/**
 * Generate a daily brief from kernel context and telemetry.
 * Returns aggregated metrics for the console dashboard.
 */
export function generateDailyBrief(context: {
  startTime: number;
  endTime: number;
  results: Array<{ ok: boolean; processingTime?: number }>;
  identity: string;
  currentCurvature: number;
  currentEntropy: number;
  governanceContext: JsonObject;
}): DailyBriefMetrics {
  const totalMessages = context.results.length;
  const successfulMessages = context.results.filter((r) => r.ok === true).length;
  const failedMessages = totalMessages - successfulMessages;
  const successRate = totalMessages > 0 ? (successfulMessages / totalMessages) * 100 : 0;

  // Compute average processing time
  const processingTimes = context.results
    .filter((r) => typeof r.processingTime === 'number')
    .map((r) => r.processingTime as number);
  const averageProcessingTime =
    processingTimes.length > 0
      ? processingTimes.reduce((a, b) => a + b, 0) / processingTimes.length
      : 0;

  return {
    timestamp: Date.now(),
    periodStart: context.startTime,
    periodEnd: context.endTime,
    messageCount: totalMessages,
    failureCount: failedMessages,
    successRate: Math.round(successRate * 100) / 100,
    averageProcessingTime: Math.round(averageProcessingTime * 1000) / 1000,
    entropyAverage: context.currentEntropy,
    identityCurvatureAverage: context.currentCurvature,
    governanceDecisions: {
      mode: (context.governanceContext as Record<string, unknown>).umbrellaMode ?? 'strict',
      denialCount: 0,
      advisoryCount: 0,
    },
    topLanes: generateTopLanesSnapshot(),
  };
}

/**
 * Generate a snapshot of top-performing lanes for the brief.
 * In production, this would be computed from telemetry data.
 */
function generateTopLanesSnapshot(): Array<{ name: string; count: number }> {
  return [
    { name: 'identity-physics', count: 42 },
    { name: 'governance', count: 38 },
    { name: 'universe-state', count: 31 },
    { name: 'umbrella-advisory', count: 12 },
  ];
}

/**
 * Format daily brief for HTTP response to portal-os-console.
 */
export function formatDailyBriefResponse(metrics: DailyBriefMetrics): JsonObject {
  return {
    ok: true,
    data: {
      brief: metrics,
      recommendations: generateRecommendations(metrics),
    },
    meta: {
      source: 'kernel',
      generated: Date.now(),
      version: '1.0',
    },
  };
}

/**
 * Generate actionable recommendations based on brief metrics.
 */
function generateRecommendations(metrics: DailyBriefMetrics): JsonValue[] {
  const recommendations: JsonValue[] = [];

  if (metrics.successRate < 95) {
    recommendations.push({
      level: 'warning',
      message: `Success rate is ${metrics.successRate}%. Review failed lanes.`,
    });
  }

  if (metrics.averageProcessingTime > 100) {
    recommendations.push({
      level: 'info',
      message: `Average processing time is ${metrics.averageProcessingTime}ms. Consider optimization.`,
    });
  }

  if (metrics.entropyAverage > 75) {
    recommendations.push({
      level: 'warning',
      message: 'Entropy is high. System is diverging. Verify governance.',
    });
  }

  if (recommendations.length === 0) {
    recommendations.push({
      level: 'info',
      message: 'All systems nominal.',
    });
  }

  return recommendations;
}
