import type { MoneyForwardProfileScrapeStatus } from "@mf-dashboard/db/repository/profiles";
import { normalizeCrawlerError } from "./crawler-progress.js";
import type { CrawlerRunStateSnapshot } from "./crawler-run-state.js";

export function sliceProfileRunState(
  state: CrawlerRunStateSnapshot,
  timelineStartIndex: number,
): CrawlerRunStateSnapshot {
  return { ...state, timeline: state.timeline.slice(timelineStartIndex) };
}

export function createProfileRunningStatus(): MoneyForwardProfileScrapeStatus {
  return { lastStatus: "running", lastError: null };
}

export function createProfileCompletedStatus(
  state: CrawlerRunStateSnapshot,
  completedAt: string,
): MoneyForwardProfileScrapeStatus {
  const hasWarnings = state.timeline.some(({ status }) => status === "warning");
  return {
    lastScrapedAt: completedAt,
    lastStatus: hasWarnings ? "partial_success" : "success",
    lastError: null,
  };
}

export function createProfileFailedStatus(
  state: CrawlerRunStateSnapshot,
  failure: unknown,
): MoneyForwardProfileScrapeStatus {
  const recordedReason = state.timeline.findLast(({ status }) => status === "failed")?.reason;
  const reason = recordedReason ?? normalizeCrawlerError(failure, "scrape_failed");
  return {
    lastStatus: reason.code === "auth_failed" ? "auth_failed" : "scrape_failed",
    lastError: reason.message,
  };
}
