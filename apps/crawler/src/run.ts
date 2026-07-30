import { closeDb, initDb } from "@mf-dashboard/db";
import { synchronizeMoneyForwardProfiles } from "@mf-dashboard/db/repository/profiles";
import { buildCleanupGroupIds } from "./cleanup-groups.js";
import {
  handleCrawlerFailure,
  runAnalyticsPhase,
  runAuthPhase,
  runCashFlowHistoryPhase,
  runInstitutionCategoryPhase,
  runLoadPhase,
  runNotificationPhase,
  runSavePhase,
  runScrapePhase,
  runSetupPhase,
  type CrawlerRuntime,
} from "./crawler-phases.js";
import {
  CRAWLER_STEPS,
  normalizeCrawlerError,
  runCrawlerStep,
  type CrawlerProgressReporter,
} from "./crawler-progress.js";
import { error, info, warn } from "./logger.js";
import { createGroupScope } from "./scrapers/group.js";
import { notifyWebRefresh } from "./web-refresh.js";

export async function runCrawler(progress: CrawlerProgressReporter): Promise<void> {
  const { crawler: config, profiles } = await runLoadPhase();
  const failures: unknown[] = [];

  try {
    const db = await initDb();
    await db.transaction((transaction) => synchronizeMoneyForwardProfiles(transaction, profiles));
  } finally {
    closeDb();
  }

  for (const profile of profiles.filter(({ enabled }) => enabled)) {
    const profileProgress = createProfileProgressReporter(progress, profile.id);
    try {
      await runProfileCrawler(config, profile, profileProgress);
    } catch (err) {
      failures.push(err);
      warn(`Money Forward profile ${profile.id} failed; continuing with the next profile.`);
    }
  }

  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    throw new AggregateError(failures, `${failures.length} Money Forward profiles failed`);
  }

  info("Completed all enabled Money Forward profiles!");
}

function createProfileProgressReporter(
  progress: CrawlerProgressReporter,
  profileId: string,
): CrawlerProgressReporter {
  return {
    ...progress,
    startStep: (step, metadata) =>
      progress.startStep({ ...step, label: `[${profileId}] ${step.label}` }, metadata),
  };
}

async function runProfileCrawler(
  config: Awaited<ReturnType<typeof runLoadPhase>>["crawler"],
  profile: Awaited<ReturnType<typeof runLoadPhase>>["profiles"][number],
  progress: CrawlerProgressReporter,
): Promise<void> {
  let runtime: CrawlerRuntime | null = null;

  info(`Starting Money Forward profile: ${profile.id}`);
  try {
    const activeRuntime = await runSetupPhase(config, profile);
    runtime = activeRuntime;
    await runCrawlerStep(
      progress,
      CRAWLER_STEPS.authentication,
      () => runAuthPhase(activeRuntime.page, activeRuntime.context, profile),
      { failureCode: "auth_failed" },
    );

    await using groupScope = await createGroupScope(activeRuntime.page);
    const scrapeResult = await runScrapePhase(activeRuntime.page, config, progress);
    const cleanupResult = config.cleanupGroups
      ? buildCleanupGroupIds(scrapeResult.groupDataList)
      : null;
    if (config.cleanupGroups && !cleanupResult) {
      warn(
        "Skipped group cleanup because no groups were scraped; group selector retrieval may have failed.",
      );
    }
    const institutionCategories = await runCrawlerStep(
      progress,
      CRAWLER_STEPS.institutionCategories,
      () => runInstitutionCategoryPhase(activeRuntime.page),
    );
    await runCrawlerStep(progress, CRAWLER_STEPS.databaseSave, () =>
      runCashFlowHistoryPhase(
        activeRuntime.db,
        profile.id,
        activeRuntime.page,
        config,
        activeRuntime.categoryDecision,
        progress,
        async (historyMonths) => {
          const savedCounts = await runSavePhase(
            activeRuntime.db,
            profile,
            activeRuntime.page,
            scrapeResult,
            activeRuntime.categoryDecision,
            historyMonths,
            cleanupResult?.ids,
            institutionCategories,
          );
          if (cleanupResult) info("Cleaned up groups not found in MoneyForward");
          return savedCounts;
        },
      ),
    );
    await runCrawlerStep(progress, CRAWLER_STEPS.analytics, () =>
      runAnalyticsPhase(activeRuntime.db, profile.id, scrapeResult.groupDataList),
    );
    const notificationStep = await progress.startStep(CRAWLER_STEPS.notification);
    const notificationFailure = await runNotificationPhase(
      scrapeResult.groupDataList,
      groupScope.originalGroup,
    );
    if (notificationFailure) {
      await progress.warnStep(
        notificationStep,
        normalizeCrawlerError(notificationFailure, "notification_failed"),
      );
    } else {
      await progress.completeStep(notificationStep);
    }

    const webRefreshStep = await progress.startStep(CRAWLER_STEPS.webCacheRefresh);
    try {
      await notifyWebRefresh();
      await progress.completeStep(webRefreshStep);
    } catch (err) {
      await progress.warnStep(
        webRefreshStep,
        normalizeCrawlerError(err, "web_cache_refresh_failed"),
      );
      error("Failed to refresh web cache:", err);
    }

    info(`Completed Money Forward profile: ${profile.id}`);
  } catch (err) {
    await handleCrawlerFailure(err, runtime?.page, config);
    throw err;
  } finally {
    try {
      if (runtime) {
        await runtime.browser.close();
      }
    } finally {
      closeDb();
    }
  }
}
