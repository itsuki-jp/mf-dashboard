import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../schema/schema";
import {
  closeTestDb,
  createTestDb,
  createTestGlobalGroup,
  createTestGroup,
  resetTestDb,
  TEST_GLOBAL_GROUP_ID,
  TEST_GROUP_ID,
} from "../test-helpers";
import {
  classifyDividendTransaction,
  getDividendDashboardData,
  toDividendCsv,
  type DividendDashboardData,
} from "./dividend";

const baseTransaction = {
  id: 1,
  date: "2026-06-30",
  accountId: 1,
  amount: 12000,
  type: "income",
  rawCategory: "配当所得",
  rawSubCategory: "国内株式",
  isTransfer: false,
  isExcludedFromCalculation: false,
};

type Db = Awaited<ReturnType<typeof createTestDb>>;
let db: Db;
let stockSnapshotId: number;
let stockCategoryId: number;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(() => {
  closeTestDb(db);
});

beforeEach(async () => {
  await resetTestDb(db);
  await createTestGroup(db);
  await createTestGlobalGroup(db);
  const now = new Date().toISOString();
  const snapshot = await db
    .insert(schema.dailySnapshots)
    .values({ groupId: TEST_GLOBAL_GROUP_ID, date: "2026-01-01", createdAt: now, updatedAt: now })
    .returning()
    .get();
  stockSnapshotId = snapshot.id;
  const category = await db
    .insert(schema.assetCategories)
    .values({ name: "株式(現物)", createdAt: now, updatedAt: now })
    .returning()
    .get();
  stockCategoryId = category.id;
});

async function createScopedStock(code: string, name = `Company ${code}`) {
  const now = new Date().toISOString();
  const account = await db
    .insert(schema.accounts)
    .values({
      profileId: "primary",
      mfId: `account-${code}`,
      name: `Account ${code}`,
      type: "broker",
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  await db
    .insert(schema.groupAccounts)
    .values({
      profileId: "primary",
      groupId: TEST_GROUP_ID,
      accountId: account.id,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  const holding = await db
    .insert(schema.holdings)
    .values({
      profileId: "primary",
      accountId: account.id,
      name,
      code,
      type: "asset",
      categoryId: stockCategoryId,
      liabilityCategory: null,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  await db
    .insert(schema.holdingValues)
    .values({
      holdingId: holding.id,
      snapshotId: stockSnapshotId,
      amount: 100000,
      quantity: 100,
      unitPrice: 1000,
      avgCostPrice: 900,
      dailyChange: null,
      unrealizedGain: null,
      unrealizedGainPct: null,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return account.id;
}

async function createMarketRow(
  code: string,
  options: {
    mappingStatus?: string;
    forecastFiscalYear?: number | null;
    forecastPeriodBasis?: string | null;
    forecastShareBasis?: string | null;
    forecastDpsRaw?: number | null;
    forecastDpsAdjusted?: number | null;
  } = {},
) {
  const now = new Date().toISOString();
  await db
    .insert(schema.stockMarketData)
    .values({
      source: "edinetdb",
      externalSecurityId: `E${code}`,
      normalizedCode: code,
      market: null,
      name: `Provider ${code}`,
      industryName: "Industry A",
      listingStatus: "listed",
      mappingStatus: options.mappingStatus ?? "resolved",
      forecastFiscalYear:
        options.forecastFiscalYear === undefined ? 2026 : options.forecastFiscalYear,
      forecastQuarter: null,
      forecastDpsRaw: options.forecastDpsRaw === undefined ? 10 : options.forecastDpsRaw,
      forecastDpsAdjusted:
        options.forecastDpsAdjusted === undefined ? null : options.forecastDpsAdjusted,
      forecastShareBasis:
        options.forecastShareBasis === undefined ? "reported" : options.forecastShareBasis,
      forecastPeriodBasis:
        options.forecastPeriodBasis === undefined ? "fiscal_year" : options.forecastPeriodBasis,
      forecastSourceDisclosureDate: "2026-01-01",
      forecastAsOf: now,
      lastMappedAt: now,
      lastForecastFetchedAt: now,
      lastHistoryFetchedAt: null,
      lastErrorCode: null,
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

async function createSyncStatus(
  code: string,
  stage: "mapping" | "forecast",
  status: "success" | "error" | "stale",
  options: { lastSuccessAt?: string | null; ttlSeconds?: number | null } = {},
) {
  const now = new Date().toISOString();
  await db
    .insert(schema.marketDataSyncStatuses)
    .values({
      source: "edinetdb",
      normalizedCode: code,
      stage,
      status,
      errorCode: status === "error" ? "provider_unavailable" : null,
      lastAttemptedAt: now,
      lastSuccessAt: options.lastSuccessAt === undefined ? now : options.lastSuccessAt,
      nextAllowedAt: null,
      ttlSeconds: options.ttlSeconds === undefined ? 3600 : options.ttlSeconds,
      asOf: now,
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

async function createDividendTransaction(accountId: number, profileId = "primary") {
  const now = new Date().toISOString();
  await db
    .insert(schema.transactions)
    .values({
      profileId,
      mfId: `receipt-${profileId}-${accountId}`,
      date: "2026-06-30",
      accountId,
      category: "配当所得",
      subCategory: "国内株式",
      rawCategory: "配当所得",
      rawSubCategory: "国内株式",
      description: "Dividend receipt",
      amount: 12000,
      type: "income",
      isTransfer: false,
      isExcludedFromCalculation: false,
      transferTarget: null,
      transferTargetAccountId: null,
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

async function createOrdinaryExpenseAndTransfer(accountId: number) {
  const now = new Date().toISOString();
  await db
    .insert(schema.transactions)
    .values([
      {
        profileId: "primary",
        mfId: `expense-${accountId}`,
        date: "2026-06-30",
        accountId,
        category: "食費",
        subCategory: "その他",
        rawCategory: "食費",
        rawSubCategory: "その他",
        description: "Ordinary expense",
        amount: -4000,
        type: "expense",
        isTransfer: false,
        isExcludedFromCalculation: false,
        transferTarget: null,
        transferTargetAccountId: null,
        createdAt: now,
        updatedAt: now,
      },
      {
        profileId: "primary",
        mfId: `transfer-${accountId}`,
        date: "2026-06-30",
        accountId,
        category: null,
        subCategory: null,
        rawCategory: null,
        rawSubCategory: null,
        description: "Ordinary transfer",
        amount: -1000,
        type: "transfer",
        isTransfer: true,
        isExcludedFromCalculation: true,
        transferTarget: null,
        transferTargetAccountId: null,
        createdAt: now,
        updatedAt: now,
      },
    ])
    .run();
}

describe("dividend query helpers", () => {
  it("classifies receipt states fail-closed and retains the unresolved security state", () => {
    expect(classifyDividendTransaction(baseTransaction)).toEqual({
      status: "matched",
      transactionId: 1,
      date: "2026-06-30",
      netAmount: 12000,
      amountBasis: "net",
      securityStatus: "security_unresolved",
    });
    expect(
      classifyDividendTransaction({
        ...baseTransaction,
        rawCategory: null,
        rawSubCategory: null,
      }),
    ).toMatchObject({ status: "unavailable", netAmount: null, securityStatus: "unavailable" });
    expect(
      classifyDividendTransaction({
        ...baseTransaction,
        rawCategory: "収入",
        rawSubCategory: "その他",
        description: "配当らしき入金",
      }),
    ).toMatchObject({
      status: "ambiguous",
      netAmount: null,
      securityStatus: "security_unresolved",
    });
    expect(classifyDividendTransaction({ ...baseTransaction, isTransfer: true })).toMatchObject({
      status: "not_dividend",
      securityStatus: "not_applicable",
    });
  });

  it("applies the market mapping, stage status, TTL, fiscal year, and basis decision table", async () => {
    for (const code of ["1111", "2222", "3333", "4444", "5555", "6666", "7777", "8888", "9999"]) {
      await createScopedStock(code);
      await createMarketRow(code, {
        mappingStatus: code === "1111" ? "unresolved" : "resolved",
        forecastFiscalYear: code === "5555" ? null : 2026,
        forecastPeriodBasis: code === "6666" ? "unknown_basis" : "fiscal_year",
        forecastShareBasis:
          code === "8888" ? "pre_split" : code === "9999" ? "indeterminate" : "reported",
        forecastDpsAdjusted: code === "8888" ? 8 : null,
      });
    }
    const stale = new Date(Date.now() - 10_000).toISOString();
    for (const code of ["1111", "3333", "4444", "5555", "6666", "7777", "8888", "9999"]) {
      await createSyncStatus(code, "mapping", "success");
    }
    await createSyncStatus("1111", "forecast", "success");
    await createSyncStatus("3333", "forecast", "error");
    await createSyncStatus("4444", "forecast", "success", { lastSuccessAt: stale, ttlSeconds: 1 });
    await createSyncStatus("5555", "forecast", "success");
    await createSyncStatus("6666", "forecast", "success");
    await createSyncStatus("7777", "forecast", "success");
    await createSyncStatus("8888", "forecast", "success");
    await createSyncStatus("9999", "forecast", "success");

    const data = await getDividendDashboardData(TEST_GROUP_ID, { year: 2026 }, db);
    const byCode = new Map(data.securities.map((row) => [row.code, row]));

    expect(byCode.get("1111")?.dataStatus).toBe("unavailable");
    expect(byCode.get("2222")?.forecastSyncStatus.status).toBe("never_synced");
    expect(byCode.get("2222")?.dataStatus).toBe("unavailable");
    expect(byCode.get("3333")?.dataStatus).toBe("unavailable");
    expect(byCode.get("4444")?.dataStatus).toBe("stale");
    expect(byCode.get("5555")?.dataStatus).toBe("calculation_unavailable");
    expect(byCode.get("6666")?.dataStatus).toBe("calculation_unavailable");
    expect(byCode.get("8888")).toMatchObject({
      dataStatus: "covered",
      forecastDps: 8,
      forecastAnnualGross: 800,
    });
    expect(byCode.get("9999")).toMatchObject({
      dataStatus: "calculation_unavailable",
      forecastDps: null,
      forecastAnnualGross: null,
    });
    expect(byCode.get("7777")).toMatchObject({
      dataStatus: "covered",
      forecastAnnualGross: 1000,
      forecastFiscalYear: 2026,
      periodBasis: "fiscal_year",
    });
    expect(data.summary).toMatchObject({
      forecastAnnualGross: 1800,
      coveredMarketValue: 200000,
      coveredHoldingCount: 2,
    });
    expect(data.forecastFiscalYears).toEqual([2026]);
  });

  it("keeps actual receipts in the resolved group and profile scope", async () => {
    const primaryAccountId = await createScopedStock("7203");
    await createDividendTransaction(primaryAccountId);
    await createOrdinaryExpenseAndTransfer(primaryAccountId);
    const now = new Date().toISOString();
    await db
      .insert(schema.moneyForwardProfiles)
      .values({
        id: "secondary",
        name: "Secondary",
        enabled: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    await db
      .insert(schema.groups)
      .values({
        id: "secondary:group",
        profileId: "secondary",
        mfGroupId: "group",
        name: "Secondary Group",
        isCurrent: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    const secondaryAccount = await db
      .insert(schema.accounts)
      .values({
        profileId: "secondary",
        mfId: "secondary-account",
        name: "Secondary Account",
        type: "broker",
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    await db
      .insert(schema.groupAccounts)
      .values({
        profileId: "secondary",
        groupId: "secondary:group",
        accountId: secondaryAccount.id,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    await createDividendTransaction(secondaryAccount.id, "secondary");

    const data = await getDividendDashboardData(TEST_GROUP_ID, { year: 2026 }, db);

    expect(data.summary.actualReceivedNet).toBe(12000);
    expect(data.receipts.filter((receipt) => receipt.status === "matched")).toEqual([
      expect.objectContaining({
        transactionId: expect.any(Number),
        date: "2026-06-30",
        netAmount: 12000,
        amountBasis: "net",
        securityStatus: "security_unresolved",
      }),
    ]);
    expect(data.receipts.filter((receipt) => receipt.status === "not_dividend")).toHaveLength(2);
  });

  it("exports actual receipt rows with a net basis even when forecasts are excluded", () => {
    const data: DividendDashboardData = {
      year: 2026,
      forecastFiscalYears: [],
      summary: {
        actualReceivedNet: 12000,
        forecastAnnualGross: null,
        forecastRemainingGross: null,
        unknownPaymentMonthGross: null,
        progressPct: null,
        calculationStatus: "data_unavailable",
        periodBasis: null,
        totalStockMarketValue: 0,
        coveredMarketValue: 0,
        coveragePct: null,
        coveredHoldingCount: 0,
        totalHoldingCount: 0,
      },
      securities: [
        {
          code: "7203",
          name: '=Company "A"',
          industryName: null,
          marketValue: 100000,
          quantity: 10,
          costValue: 90000,
          forecastDps: null,
          forecastAnnualGross: null,
          forecastYieldPct: null,
          yieldOnCostPct: null,
          forecastFiscalYear: null,
          periodBasis: null,
          mappingStatus: "unavailable",
          mappingSyncStatus: {
            status: "never_synced",
            lastSuccessAt: null,
            ttlSeconds: null,
            isFresh: false,
          },
          forecastSyncStatus: {
            status: "never_synced",
            lastSuccessAt: null,
            ttlSeconds: null,
            isFresh: false,
          },
          dataStatus: "unavailable",
        },
      ],
      receipts: [
        {
          status: "matched",
          transactionId: 3,
          date: "2026-06-30",
          netAmount: 12000,
          amountBasis: "net",
          securityStatus: "security_unresolved",
        },
      ],
      industries: [],
      yieldBuckets: [],
      monthlySeries: [],
      yearlySeries: [],
      sourceAsOf: null,
    };

    const csv = toDividendCsv(data, false);
    expect(toDividendCsv(data)).toContain('"\'=Company ""A"""');
    expect(csv).not.toContain('"forecast"');
    expect(csv).not.toContain('"7203"');
    expect(csv).toContain(
      '"actual","","","","","","","","","","","2026-06-30","12000","net","matched","security_unresolved","3"',
    );
  });
});
