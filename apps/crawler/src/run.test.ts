import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { closeDb, initDb } from "@mf-dashboard/db";
import { getAccountMfIds } from "@mf-dashboard/db/repository/accounts";
import {
  synchronizeMoneyForwardProfiles,
  updateMoneyForwardProfileScrapeStatus,
} from "@mf-dashboard/db/repository/profiles";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
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
} from "./crawler-phases.js";
import { CRAWLER_STEPS, createCrawlerProgressReporter } from "./crawler-progress.js";
import { runCrawler } from "./run.js";
import { createGroupScope } from "./scrapers/group.js";
import { notifyWebRefresh } from "./web-refresh.js";

vi.mock("@mf-dashboard/db", () => ({
  closeDb: vi.fn<() => void>(),
  initDb: vi.fn<() => void>(),
}));
vi.mock("@mf-dashboard/db/repository/profiles", () => ({
  synchronizeMoneyForwardProfiles: vi.fn<() => void>(),
  updateMoneyForwardProfileScrapeStatus: vi.fn<() => void>(),
}));
vi.mock("@mf-dashboard/db/repository/accounts", () => ({
  getAccountMfIds: vi.fn<() => Promise<Set<string>>>(),
}));
vi.mock("./crawler-phases.js", () => ({
  handleCrawlerFailure: vi.fn<() => void>(),
  runAnalyticsPhase: vi.fn<() => void>(),
  runAuthPhase: vi.fn<() => void>(),
  runCashFlowHistoryPhase: vi.fn<() => void>(),
  runInstitutionCategoryPhase: vi.fn<() => Map<string, string>>(),
  runLoadPhase: vi.fn<() => void>(),
  runNotificationPhase: vi.fn<() => void>(),
  runSavePhase: vi.fn<() => void>(),
  runScrapePhase: vi.fn<() => void>(),
  runSetupPhase: vi.fn<() => void>(),
}));
vi.mock("./scrapers/group.js", () => ({ createGroupScope: vi.fn<() => void>() }));
vi.mock("./web-refresh.js", () => ({ notifyWebRefresh: vi.fn<() => void>() }));

let tempDir: string;

beforeEach(async () => {
  vi.clearAllMocks();
  tempDir = await mkdtemp(path.join(os.tmpdir(), "crawler-run-progress-"));
  vi.mocked(initDb).mockResolvedValue({
    transaction: vi.fn<(callback: (transaction: never) => Promise<void>) => Promise<void>>(
      async (callback) => callback({} as never),
    ),
  } as never);
  vi.mocked(synchronizeMoneyForwardProfiles).mockResolvedValue(undefined);
  vi.mocked(getAccountMfIds).mockResolvedValue(new Set());
  vi.mocked(updateMoneyForwardProfileScrapeStatus).mockResolvedValue(undefined);
  vi.mocked(runLoadPhase).mockResolvedValue({
    crawler: {
      skipRefresh: false,
      cleanupGroups: false,
      dbPath: "/tmp/demo.db",
      dbExists: true,
      scrapeMode: "month",
      isHistoryMode: false,
      historyMaxMonths: 360,
      isDebug: false,
      isHeaded: false,
    },
    profiles: [
      {
        id: "primary",
        name: "Primary",
        enabled: true,
        usernameSecretId: "username-id",
        passwordSecretId: "password-id",
        totpSecretId: "totp-id",
      },
    ],
  });
  vi.mocked(runSetupPhase).mockResolvedValue({
    db: {} as never,
    browser: { close: vi.fn<() => Promise<void>>() } as never,
    context: {} as never,
    page: {} as never,
    categoryDecision: { config: null, usage: { llmCallsUsed: 0 } },
  });
  vi.mocked(createGroupScope).mockResolvedValue({
    originalGroup: null,
    [Symbol.asyncDispose]: vi.fn<() => Promise<void>>(),
  });
  vi.mocked(runNotificationPhase).mockResolvedValue(null);
  vi.mocked(notifyWebRefresh).mockResolvedValue(undefined);
  vi.mocked(runSavePhase).mockResolvedValue([]);
  vi.mocked(runInstitutionCategoryPhase).mockResolvedValue(new Map([["account-a", "銀行"]]));
  vi.mocked(runCashFlowHistoryPhase).mockImplementation(
    async (_db, _profileId, _page, _config, _categoryDecision, _progress, publishHistory) => {
      if (!publishHistory) throw new Error("publishHistory is required");
      await publishHistory([]);
    },
  );
  vi.mocked(runScrapePhase).mockImplementation(async (_page, _config, progress) => {
    for (const [step, metadata] of [
      [CRAWLER_STEPS.groupList],
      [CRAWLER_STEPS.refresh],
      [CRAWLER_STEPS.registeredAccounts],
      [CRAWLER_STEPS.portfolio],
      [CRAWLER_STEPS.liabilities],
      [CRAWLER_STEPS.monthlyCashFlow, { month: "2026-07" }],
      [CRAWLER_STEPS.groupData, { groupName: "Group A" }],
    ] as const) {
      const stepId = await progress.startStep(step, metadata);
      await progress.completeStep(stepId);
    }
    return {
      defaultGroup: null,
      globalData: {
        registeredAccounts: { accounts: [] },
        portfolio: { items: [], totalAssets: 0 },
        liabilities: { items: [], totalLiabilities: 0 },
        cashFlow: {
          month: "2026-07",
          totalIncome: 0,
          totalExpense: 0,
          balance: 0,
          items: [],
        },
        refreshResult: { completed: true, incompleteAccounts: [] },
      },
      groupDataList: [],
    };
  });
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("runCrawler progress", () => {
  test("profile config load failure stops before browser and database setup", async () => {
    const progress = await createCrawlerProgressReporter(path.join(tempDir, "state.json"), {
      id: "run-a",
      source: "test",
      startedAt: "2026-07-01T00:00:00.000Z",
    });
    vi.mocked(runLoadPhase).mockRejectedValueOnce(new Error("invalid profile config"));

    await expect(runCrawler(progress)).rejects.toThrow("invalid profile config");

    expect(runSetupPhase).not.toHaveBeenCalled();
    expect(runAuthPhase).not.toHaveBeenCalled();
  });

  test("全profile metadataを同期し、enabledなprofileだけを実行する", async () => {
    const profiles = [
      {
        id: "primary",
        name: "Primary",
        enabled: true,
        usernameSecretId: "username-id",
        passwordSecretId: "password-id",
        totpSecretId: "totp-id",
      },
      {
        id: "paused",
        name: "Paused",
        enabled: false,
        usernameSecretId: "paused-username-id",
        passwordSecretId: "paused-password-id",
        totpSecretId: "paused-totp-id",
      },
    ];
    vi.mocked(runLoadPhase).mockResolvedValue({
      crawler: {
        skipRefresh: false,
        cleanupGroups: false,
        dbPath: "/tmp/demo.db",
        dbExists: true,
        scrapeMode: "month",
        isHistoryMode: false,
        historyMaxMonths: 360,
        isDebug: false,
        isHeaded: false,
      },
      profiles,
    });
    const progress = await createCrawlerProgressReporter(path.join(tempDir, "state.json"), {
      id: "run-a",
      source: "test",
      startedAt: "2026-07-01T00:00:00.000Z",
    });

    await runCrawler(progress);

    expect(synchronizeMoneyForwardProfiles).toHaveBeenCalledWith(expect.anything(), profiles);
    expect(vi.mocked(runSetupPhase).mock.calls.map(([, profile]) => profile.id)).toEqual([
      "primary",
    ]);
  });

  test("atomic database save失敗を database save step に記録する", async () => {
    const progress = await createCrawlerProgressReporter(path.join(tempDir, "state.json"), {
      id: "run-a",
      source: "test",
      startedAt: "2026-07-01T00:00:00.000Z",
    });
    vi.mocked(runSavePhase).mockRejectedValueOnce(new Error("database cleanup failed"));

    await expect(runCrawler(progress)).rejects.toThrow("database cleanup failed");

    expect(progress.getState().timeline).toContainEqual(
      expect.objectContaining({ step: "database_save", status: "failed" }),
    );
  });

  test("通常成功でユーザー向けの全 step を順に記録する", async () => {
    const progress = await createCrawlerProgressReporter(path.join(tempDir, "state.json"), {
      id: "run-a",
      source: "test",
      startedAt: "2026-07-01T00:00:00.000Z",
    });

    await runCrawler(progress);
    await progress.finish("success");

    expect(progress.getState().runStatus).toBe("success");
    expect(progress.getState().timeline.map(({ step, status }) => ({ step, status }))).toEqual([
      { step: "authentication", status: "done" },
      { step: "group_list", status: "done" },
      { step: "moneyforward_refresh", status: "done" },
      { step: "registered_accounts", status: "done" },
      { step: "portfolio", status: "done" },
      { step: "liabilities", status: "done" },
      { step: "cash_flow_history", status: "done" },
      { step: "group_data", status: "done" },
      { step: "institution_categories", status: "done" },
      { step: "database_save", status: "done" },
      { step: "analytics", status: "done" },
      { step: "notification", status: "done" },
      { step: "web_cache_refresh", status: "done" },
    ]);
    expect(runAuthPhase).toHaveBeenCalledOnce();
    expect(runAuthPhase).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ id: "primary" }),
    );
    expect(runSetupPhase).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: "primary" }),
    );
    expect(runSavePhase).toHaveBeenCalledOnce();
    expect(runInstitutionCategoryPhase).toHaveBeenCalledOnce();
    expect(runCashFlowHistoryPhase).toHaveBeenCalledOnce();
    expect(runAnalyticsPhase).toHaveBeenCalledOnce();
    expect(updateMoneyForwardProfileScrapeStatus).toHaveBeenCalledWith(
      expect.anything(),
      "primary",
      { lastStatus: "running", lastError: null },
    );
    expect(updateMoneyForwardProfileScrapeStatus).toHaveBeenLastCalledWith(
      expect.anything(),
      "primary",
      expect.objectContaining({ lastStatus: "success", lastError: null }),
    );
  });

  test("有効profileを設定順に実行し、progress labelで実行単位を区別する", async () => {
    vi.mocked(runLoadPhase).mockResolvedValue({
      crawler: {
        skipRefresh: false,
        cleanupGroups: false,
        dbPath: "/tmp/demo.db",
        dbExists: true,
        scrapeMode: "month",
        isHistoryMode: false,
        historyMaxMonths: 360,
        isDebug: false,
        isHeaded: false,
      },
      profiles: [
        {
          id: "primary",
          name: "Primary",
          enabled: true,
          usernameSecretId: "username-id",
          passwordSecretId: "password-id",
          totpSecretId: "totp-id",
        },
        {
          id: "secondary",
          name: "Secondary",
          enabled: true,
          usernameSecretId: "secondary-username-id",
          passwordSecretId: "secondary-password-id",
          totpSecretId: "secondary-totp-id",
        },
      ],
    });
    const progress = await createCrawlerProgressReporter(path.join(tempDir, "state.json"), {
      id: "run-a",
      source: "test",
      startedAt: "2026-07-01T00:00:00.000Z",
    });

    await runCrawler(progress);

    expect(vi.mocked(runSetupPhase).mock.calls.map(([, profile]) => profile.id)).toEqual([
      "primary",
      "secondary",
    ]);
    expect(runSavePhase).toHaveBeenCalledTimes(2);
    expect(runAnalyticsPhase).toHaveBeenCalledTimes(2);
    expect(closeDb).toHaveBeenCalledTimes(3);
    const labels = progress.getState().timeline.map(({ label }) => label);
    expect(labels).toContain("[primary] MoneyForward に認証");
    expect(labels).toContain("[secondary] MoneyForward に認証");
  });

  test("指定したenabled profileだけを実行し、全profile metadataは同期する", async () => {
    const profiles = [
      {
        id: "primary",
        name: "Primary",
        enabled: true,
        usernameSecretId: "username-id",
        passwordSecretId: "password-id",
        totpSecretId: "totp-id",
      },
      {
        id: "secondary",
        name: "Secondary",
        enabled: true,
        usernameSecretId: "secondary-username-id",
        passwordSecretId: "secondary-password-id",
        totpSecretId: "secondary-totp-id",
      },
    ];
    vi.mocked(runLoadPhase).mockResolvedValue({
      crawler: {
        skipRefresh: false,
        cleanupGroups: false,
        dbPath: "/tmp/demo.db",
        dbExists: true,
        scrapeMode: "month",
        isHistoryMode: false,
        historyMaxMonths: 360,
        isDebug: false,
        isHeaded: false,
      },
      profiles,
    });
    const progress = await createCrawlerProgressReporter(path.join(tempDir, "state.json"), {
      id: "run-a",
      source: "test",
      startedAt: "2026-07-01T00:00:00.000Z",
    });

    await runCrawler(progress, { profileId: "secondary" });

    expect(synchronizeMoneyForwardProfiles).toHaveBeenCalledWith(expect.anything(), profiles);
    expect(vi.mocked(runSetupPhase).mock.calls.map(([, profile]) => profile.id)).toEqual([
      "secondary",
    ]);
    expect(progress.getState().timeline.map(({ label }) => label)).toContain(
      "[secondary] MoneyForward に認証",
    );
  });

  test("存在しないprofile指定はbrowser setup前に拒否する", async () => {
    const progress = await createCrawlerProgressReporter(path.join(tempDir, "state.json"), {
      id: "run-a",
      source: "test",
      startedAt: "2026-07-01T00:00:00.000Z",
    });

    await expect(runCrawler(progress, { profileId: "missing" })).rejects.toThrow(
      "Requested Money Forward profile is not enabled",
    );

    expect(runSetupPhase).not.toHaveBeenCalled();
  });

  test("先行profileが失敗しても後続profileを完了してから失敗を返す", async () => {
    const primaryFailure = new Error("primary database save failed");
    vi.mocked(runLoadPhase).mockResolvedValue({
      crawler: {
        skipRefresh: false,
        cleanupGroups: false,
        dbPath: "/tmp/demo.db",
        dbExists: true,
        scrapeMode: "month",
        isHistoryMode: false,
        historyMaxMonths: 360,
        isDebug: false,
        isHeaded: false,
      },
      profiles: [
        {
          id: "primary",
          name: "Primary",
          enabled: true,
          usernameSecretId: "username-id",
          passwordSecretId: "password-id",
          totpSecretId: "totp-id",
        },
        {
          id: "secondary",
          name: "Secondary",
          enabled: true,
          usernameSecretId: "secondary-username-id",
          passwordSecretId: "secondary-password-id",
          totpSecretId: "secondary-totp-id",
        },
      ],
    });
    vi.mocked(runSavePhase).mockRejectedValueOnce(primaryFailure).mockResolvedValueOnce([]);
    const progress = await createCrawlerProgressReporter(path.join(tempDir, "state.json"), {
      id: "run-a",
      source: "test",
      startedAt: "2026-07-01T00:00:00.000Z",
    });

    await expect(runCrawler(progress)).rejects.toBe(primaryFailure);

    expect(vi.mocked(runSetupPhase).mock.calls.map(([, profile]) => profile.id)).toEqual([
      "primary",
      "secondary",
    ]);
    expect(runSavePhase).toHaveBeenCalledTimes(2);
    expect(runAnalyticsPhase).toHaveBeenCalledOnce();
    expect(handleCrawlerFailure).toHaveBeenCalledOnce();
    expect(closeDb).toHaveBeenCalledTimes(3);
    expect(progress.getState().timeline).toContainEqual(
      expect.objectContaining({
        label: "[primary] データベースに保存",
        status: "failed",
      }),
    );
    expect(updateMoneyForwardProfileScrapeStatus).toHaveBeenCalledWith(
      expect.anything(),
      "primary",
      expect.objectContaining({
        lastStatus: "scrape_failed",
        lastError: "処理中にエラーが発生しました",
      }),
    );
    expect(progress.getState().timeline).toContainEqual(
      expect.objectContaining({
        label: "[secondary] データベースに保存",
        status: "done",
      }),
    );
  });

  test("複数profileの失敗を全件試行後に集約する", async () => {
    vi.mocked(runLoadPhase).mockResolvedValue({
      crawler: {
        skipRefresh: false,
        cleanupGroups: false,
        dbPath: "/tmp/demo.db",
        dbExists: true,
        scrapeMode: "month",
        isHistoryMode: false,
        historyMaxMonths: 360,
        isDebug: false,
        isHeaded: false,
      },
      profiles: [
        {
          id: "primary",
          name: "Primary",
          enabled: true,
          usernameSecretId: "username-id",
          passwordSecretId: "password-id",
          totpSecretId: "totp-id",
        },
        {
          id: "secondary",
          name: "Secondary",
          enabled: true,
          usernameSecretId: "secondary-username-id",
          passwordSecretId: "secondary-password-id",
          totpSecretId: "secondary-totp-id",
        },
      ],
    });
    vi.mocked(runSetupPhase)
      .mockRejectedValueOnce(new Error("primary setup failed"))
      .mockRejectedValueOnce(new Error("secondary setup failed"));
    const progress = await createCrawlerProgressReporter(path.join(tempDir, "state.json"), {
      id: "run-a",
      source: "test",
      startedAt: "2026-07-01T00:00:00.000Z",
    });

    const error = await runCrawler(progress).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toHaveLength(2);
    expect(runSetupPhase).toHaveBeenCalledTimes(2);
    expect(handleCrawlerFailure).toHaveBeenCalledTimes(2);
    expect(closeDb).toHaveBeenCalledTimes(3);
  });

  test("history replacementsをcurrent dataと同じsave phaseへ渡す", async () => {
    vi.mocked(runLoadPhase).mockResolvedValue({
      crawler: {
        skipRefresh: false,
        cleanupGroups: false,
        dbPath: "/tmp/demo.db",
        dbExists: true,
        scrapeMode: "history",
        isHistoryMode: true,
        historyMaxMonths: 360,
        isDebug: false,
        isHeaded: false,
      },
      profiles: [
        {
          id: "primary",
          name: "Primary",
          enabled: true,
          usernameSecretId: "username-id",
          passwordSecretId: "password-id",
          totpSecretId: "totp-id",
        },
      ],
    });
    const historyMonths = [{ items: [], month: "2026-06" }];
    vi.mocked(runCashFlowHistoryPhase).mockImplementation(
      async (_db, _profileId, _page, _config, _categoryDecision, _progress, publishHistory) => {
        if (!publishHistory) throw new Error("publishHistory is required");
        await publishHistory(historyMonths);
      },
    );
    const progress = await createCrawlerProgressReporter(path.join(tempDir, "state.json"), {
      id: "run-a",
      source: "test",
      startedAt: "2026-07-01T00:00:00.000Z",
    });

    await runCrawler(progress);

    expect(runSavePhase).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      historyMonths,
      undefined,
      new Map([["account-a", "銀行"]]),
    );
  });

  test("新規口座を検出したら通常更新でも全期間取得へ切り替える", async () => {
    vi.mocked(getAccountMfIds).mockResolvedValue(new Set(["account-a"]));
    vi.mocked(runScrapePhase).mockResolvedValue({
      defaultGroup: null,
      globalData: {
        registeredAccounts: {
          accounts: [
            {
              mfId: "account-a",
              name: "Account A",
              type: "自動連携",
              status: "ok",
              lastUpdated: "2026-07-01",
              url: "",
              totalAssets: 0,
            },
            {
              mfId: "account-b",
              name: "Account B",
              type: "自動連携",
              status: "ok",
              lastUpdated: "2026-07-01",
              url: "",
              totalAssets: 0,
            },
          ],
        },
        portfolio: { items: [], totalAssets: 0 },
        liabilities: { items: [], totalLiabilities: 0 },
        cashFlow: {
          month: "2026-07",
          totalIncome: 0,
          totalExpense: 0,
          balance: 0,
          items: [],
        },
        refreshResult: { completed: true, incompleteAccounts: [] },
      },
      groupDataList: [],
    });
    const progress = await createCrawlerProgressReporter(path.join(tempDir, "state.json"), {
      id: "run-a",
      source: "test",
      startedAt: "2026-07-01T00:00:00.000Z",
    });

    await runCrawler(progress);

    expect(runCashFlowHistoryPhase).toHaveBeenCalledWith(
      expect.anything(),
      "primary",
      expect.anything(),
      expect.objectContaining({ isHistoryMode: true }),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  test("手動指定で既存口座だけでも全期間を再取得できる", async () => {
    vi.mocked(getAccountMfIds).mockResolvedValue(new Set());
    const progress = await createCrawlerProgressReporter(path.join(tempDir, "state.json"), {
      id: "run-a",
      source: "test",
      startedAt: "2026-07-01T00:00:00.000Z",
    });

    await runCrawler(progress, { history: true });

    expect(runCashFlowHistoryPhase).toHaveBeenCalledWith(
      expect.anything(),
      "primary",
      expect.anything(),
      expect.objectContaining({ isHistoryMode: true }),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });
});
