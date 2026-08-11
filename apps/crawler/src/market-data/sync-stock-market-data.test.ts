import { schema } from "@mf-dashboard/db";
import { createTestDb, createTestProfile, closeTestDb } from "@mf-dashboard/db/test-helpers";
import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EdinetDbApiError, type EdinetCompany, type EdinetDbClient } from "./edinet-db-client.js";
import { syncStockMarketData } from "./sync-stock-market-data.js";

const company = {
  edinet_code: "E00001",
  sec_code: "7203",
  name: "Company A",
  industry: "Transport",
  listing_status: "listed",
  is_delisted: false,
};

async function createHolding(db: Awaited<ReturnType<typeof createTestDb>>): Promise<void> {
  await createTestProfile(db);
  const timestamp = new Date().toISOString();
  const stockCategory = await db
    .insert(schema.assetCategories)
    .values({ name: "株式(現物)", createdAt: timestamp, updatedAt: timestamp })
    .returning({ id: schema.assetCategories.id })
    .get();
  await db.insert(schema.groups).values({
    id: "primary:0",
    profileId: "primary",
    mfGroupId: "0",
    name: "All Accounts",
    isCurrent: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await db.insert(schema.accounts).values({
    profileId: "primary",
    mfId: "account-a",
    name: "Account A",
    type: "自動連携",
    institution: null,
    categoryId: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    isActive: true,
  });
  const holding = await db
    .insert(schema.holdings)
    .values({
      profileId: "primary",
      mfId: "holding-a",
      accountId: 1,
      categoryId: stockCategory.id,
      name: "Company A",
      code: "7203",
      type: "asset",
      liabilityCategory: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      isActive: true,
    })
    .returning({ id: schema.holdings.id })
    .get();
  const snapshot = await db
    .insert(schema.dailySnapshots)
    .values({
      groupId: "primary:0",
      date: "2099-01-01",
      refreshCompleted: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .returning({ id: schema.dailySnapshots.id })
    .get();
  await db.insert(schema.holdingValues).values({
    holdingId: holding.id,
    snapshotId: snapshot.id,
    amount: 100,
    quantity: 1,
    unitPrice: 100,
    avgCostPrice: 100,
    dailyChange: null,
    unrealizedGain: null,
    unrealizedGainPct: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

function createClient(forecast: EdinetCompany["forecast_doe"]) {
  const findCompaniesBySecurityCode = vi
    .fn<EdinetDbClient["findCompaniesBySecurityCode"]>()
    .mockResolvedValue([company]);
  const getCompany = vi.fn<EdinetDbClient["getCompany"]>().mockResolvedValue({
    ...company,
    forecast_doe: forecast,
  });
  const getFinancials = vi.fn<EdinetDbClient["getFinancials"]>().mockResolvedValue([
    {
      fiscal_year: 2098,
      dividend_per_share: 90,
      adjusted_dividend_per_share: null,
      submit_date: "2099-01-01",
    },
  ]);
  return {
    client: { findCompaniesBySecurityCode, getCompany, getFinancials } as unknown as EdinetDbClient,
    findCompaniesBySecurityCode,
    getCompany,
    getFinancials,
  };
}

describe("syncStockMarketData", () => {
  let db: Awaited<ReturnType<typeof createTestDb>> | undefined;

  afterEach(() => {
    if (db) closeTestDb(db);
    db = undefined;
  });

  it("syncs one holding and does not refetch within stage TTLs", async () => {
    db = await createTestDb();
    await createHolding(db);
    const { client, findCompaniesBySecurityCode, getCompany, getFinancials } = createClient({
      forecast_dividend_per_share: 100,
      forecast_fiscal_year: 2099,
      source_disclosure_date: "2099-01-01",
      source_quarter: "Q3",
    });

    await syncStockMarketData(db, client);
    await syncStockMarketData(db, client);

    expect(findCompaniesBySecurityCode).toHaveBeenCalledTimes(1);
    expect(getCompany).toHaveBeenCalledTimes(1);
    expect(getFinancials).toHaveBeenCalledTimes(1);
    expect((await db.select().from(schema.stockMarketData).all()).length).toBe(1);
    expect((await db.select().from(schema.stockDividendHistory).all()).length).toBe(1);
    expect(await db.select().from(schema.stockMarketData).get()).toMatchObject({
      forecastDpsRaw: 100,
      forecastDpsAdjusted: null,
      forecastShareBasis: "reported",
    });
  });

  it("uses the provider adjusted DPS only for a consistent pre_split forecast", async () => {
    db = await createTestDb();
    await createHolding(db);
    const { client } = createClient({
      forecast_dividend_per_share: 100,
      adjusted_forecast_dividend_per_share: 50,
      forecast_share_basis: "pre_split",
      forecast_split_adjustment_factor: 2,
    });

    await syncStockMarketData(db, client);

    expect(await db.select().from(schema.stockMarketData).get()).toMatchObject({
      forecastDpsRaw: 100,
      forecastDpsAdjusted: 50,
      forecastShareBasis: "pre_split",
    });
  });

  it.each([
    [
      "post_split",
      {
        forecast_dividend_per_share: 50,
        forecast_share_basis: "post_split" as const,
      },
      { forecastDpsRaw: 50, forecastDpsAdjusted: null, forecastShareBasis: "post_split" },
    ],
    [
      "indeterminate",
      {
        forecast_dividend_per_share: 100,
        adjusted_forecast_dividend_per_share: 50,
        forecast_share_basis: "indeterminate" as const,
        forecast_split_adjustment_factor: 2,
      },
      { forecastDpsRaw: 100, forecastDpsAdjusted: null, forecastShareBasis: "indeterminate" },
    ],
    [
      "inconsistent pre_split metadata",
      {
        forecast_dividend_per_share: 100,
        adjusted_forecast_dividend_per_share: 60,
        forecast_share_basis: "pre_split" as const,
        forecast_split_adjustment_factor: 2,
      },
      { forecastDpsRaw: 100, forecastDpsAdjusted: null, forecastShareBasis: "indeterminate" },
    ],
  ])(
    "stores %s forecast according to the split-basis decision table",
    async (_, forecast, expected) => {
      db = await createTestDb();
      await createHolding(db);
      const { client } = createClient(forecast);

      await syncStockMarketData(db, client);

      expect(await db.select().from(schema.stockMarketData).get()).toMatchObject(expected);
    },
  );

  it("retains the last successful forecast when a refreshed mapping is followed by a forecast error", async () => {
    db = await createTestDb();
    await createHolding(db);
    const { client, findCompaniesBySecurityCode, getCompany } = createClient({
      forecast_dividend_per_share: 100,
      forecast_fiscal_year: 2099,
    });
    await syncStockMarketData(db, client);
    await db
      .update(schema.marketDataSyncStatuses)
      .set({ lastSuccessAt: "2000-01-01T00:00:00.000Z" })
      .where(
        and(
          eq(schema.marketDataSyncStatuses.normalizedCode, "7203"),
          eq(schema.marketDataSyncStatuses.source, "edinetdb"),
          eq(schema.marketDataSyncStatuses.stage, "mapping"),
        ),
      );
    await db
      .update(schema.marketDataSyncStatuses)
      .set({ lastSuccessAt: "2000-01-01T00:00:00.000Z" })
      .where(
        and(
          eq(schema.marketDataSyncStatuses.normalizedCode, "7203"),
          eq(schema.marketDataSyncStatuses.source, "edinetdb"),
          eq(schema.marketDataSyncStatuses.stage, "forecast"),
        ),
      );
    getCompany.mockRejectedValueOnce(new EdinetDbApiError("unavailable", "http", 400));

    await syncStockMarketData(db, client);

    expect(findCompaniesBySecurityCode).toHaveBeenCalledTimes(2);
    expect(getCompany).toHaveBeenCalledTimes(2);
    expect(await db.select().from(schema.stockMarketData).get()).toMatchObject({
      forecastDpsRaw: 100,
      forecastDpsAdjusted: null,
      forecastShareBasis: "reported",
      forecastFiscalYear: 2099,
    });
  });

  it("clears old data and refetches the new EDINET identity after a mapping change", async () => {
    db = await createTestDb();
    await createHolding(db);
    const { client, findCompaniesBySecurityCode, getCompany, getFinancials } = createClient({
      forecast_dividend_per_share: 100,
      forecast_fiscal_year: 2099,
    });
    const replacement = { ...company, edinet_code: "E99999", name: "Company B" };
    findCompaniesBySecurityCode
      .mockResolvedValueOnce([company])
      .mockResolvedValueOnce([replacement]);
    await syncStockMarketData(db, client);
    await db
      .update(schema.marketDataSyncStatuses)
      .set({ lastSuccessAt: "2000-01-01T00:00:00.000Z" })
      .where(
        and(
          eq(schema.marketDataSyncStatuses.normalizedCode, "7203"),
          eq(schema.marketDataSyncStatuses.source, "edinetdb"),
          eq(schema.marketDataSyncStatuses.stage, "mapping"),
        ),
      );
    getCompany.mockRejectedValueOnce(new EdinetDbApiError("unavailable", "http", 400));
    getFinancials.mockRejectedValueOnce(new EdinetDbApiError("unavailable", "http", 400));
    const transaction = vi
      .spyOn(db, "transaction")
      .mockImplementation(async (callback) => callback(db as never));

    await syncStockMarketData(db, client);

    expect(findCompaniesBySecurityCode).toHaveBeenCalledTimes(2);
    expect(transaction).toHaveBeenCalledTimes(1);
    const marketRow = await db.select().from(schema.stockMarketData).get();
    expect(marketRow?.externalSecurityId).toBe("E99999");
    expect((await db.select().from(schema.stockDividendHistory).all()).length).toBe(0);
    expect(getCompany).toHaveBeenNthCalledWith(2, "E99999");
    expect(getFinancials).toHaveBeenNthCalledWith(2, "E99999", 6);
    expect(marketRow).toMatchObject({
      externalSecurityId: "E99999",
      forecastFiscalYear: null,
      forecastQuarter: null,
      forecastDpsRaw: null,
      forecastDpsAdjusted: null,
      forecastShareBasis: null,
      forecastPeriodBasis: null,
      forecastSourceDisclosureDate: null,
      forecastAsOf: null,
      lastForecastFetchedAt: null,
      lastHistoryFetchedAt: null,
    });
    const statuses = await db.select().from(schema.marketDataSyncStatuses).all();
    expect(statuses.filter((status) => status.stage !== "mapping")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stage: "forecast", status: "error", lastSuccessAt: null }),
        expect.objectContaining({ stage: "history", status: "error", lastSuccessAt: null }),
      ]),
    );
  });
});
