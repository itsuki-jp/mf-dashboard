import { describe, expect, it } from "vitest";
import { schema } from "../index";
import { closeTestDb, createTestDb, createTestProfile } from "../test-helpers";
import { createHolding, saveHoldingValue } from "./holdings";
import {
  clearStockDividendHistory,
  completeMarketDataRequest,
  getBudgetWindowKey,
  getMarketDataSyncStatus,
  listHoldingSecurityCodes,
  reserveMarketDataRequest,
  upsertMarketDataSyncStatus,
  upsertStockDividendHistory,
  upsertStockMarketData,
} from "./market-data";
import { createSnapshot } from "./snapshots";

const timestamp = "2099-01-01T00:00:00.000Z";

async function createProfilePortfolio(
  db: Awaited<ReturnType<typeof createTestDb>>,
  profileId: string,
) {
  await createTestProfile(db, profileId);
  const groupId = `${profileId}:0`;
  await db
    .insert(schema.groups)
    .values({
      id: groupId,
      profileId,
      mfGroupId: "0",
      name: "All Accounts",
      isCurrent: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .run();
  const account = await db
    .insert(schema.accounts)
    .values({
      profileId,
      mfId: `${profileId}-account`,
      name: "Test Account",
      type: "manual",
      institution: null,
      categoryId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      isActive: true,
    })
    .returning({ id: schema.accounts.id })
    .get();
  return { groupId, accountId: account.id };
}

describe("market data repositories", () => {
  it("lists only normalized stock codes with values in each profile's latest dated snapshot", async () => {
    const db = await createTestDb();
    try {
      const stockCategory = await db
        .insert(schema.assetCategories)
        .values({ name: "株式(現物)", createdAt: timestamp, updatedAt: timestamp })
        .returning({ id: schema.assetCategories.id })
        .get();
      const fundCategory = await db
        .insert(schema.assetCategories)
        .values({ name: "投資信託", createdAt: timestamp, updatedAt: timestamp })
        .returning({ id: schema.assetCategories.id })
        .get();
      const primary = await createProfilePortfolio(db, "primary");
      const secondary = await createProfilePortfolio(db, "secondary");
      const emptied = await createProfilePortfolio(db, "emptied");

      const primaryPrevious = await createSnapshot(db, primary.groupId, "2099-01-01");
      const primaryCurrent = await createSnapshot(db, primary.groupId, "2099-01-02");
      const primaryBackfill = await createSnapshot(db, primary.groupId, "2099-01-01");
      const secondaryCurrent = await createSnapshot(db, secondary.groupId, "2099-01-02");
      const emptiedPrevious = await createSnapshot(db, emptied.groupId, "2099-01-01");
      await createSnapshot(db, emptied.groupId, "2099-01-02");

      const soldStock = await createHolding(
        db,
        "primary",
        primary.accountId,
        "Sold Stock",
        "asset",
        { categoryId: stockCategory.id, code: "1301" },
      );
      await saveHoldingValue(db, soldStock, primaryPrevious, { amount: 100 });

      const backfilledStock = await createHolding(
        db,
        "primary",
        primary.accountId,
        "Backfilled Stock",
        "asset",
        { categoryId: stockCategory.id, code: "9997" },
      );
      await saveHoldingValue(db, backfilledStock, primaryBackfill, { amount: 100 });

      const stockA = await createHolding(db, "primary", primary.accountId, "Stock A", "asset", {
        categoryId: stockCategory.id,
        code: " 7203.t ",
      });
      const stockB = await createHolding(db, "primary", primary.accountId, "Stock B", "asset", {
        categoryId: stockCategory.id,
        code: "7203",
      });
      const fund = await createHolding(db, "primary", primary.accountId, "Fund A", "asset", {
        categoryId: fundCategory.id,
        code: "9999",
      });
      await saveHoldingValue(db, stockA, primaryCurrent, { amount: 100 });
      await saveHoldingValue(db, stockB, primaryCurrent, { amount: 100 });
      await saveHoldingValue(db, fund, primaryCurrent, { amount: 100 });

      const secondaryStock = await createHolding(
        db,
        "secondary",
        secondary.accountId,
        "Stock C",
        "asset",
        { categoryId: stockCategory.id, code: "6758.T" },
      );
      await saveHoldingValue(db, secondaryStock, secondaryCurrent, { amount: 100 });

      const staleStock = await createHolding(
        db,
        "emptied",
        emptied.accountId,
        "Stale Stock",
        "asset",
        { categoryId: stockCategory.id, code: "9984" },
      );
      await saveHoldingValue(db, staleStock, emptiedPrevious, { amount: 100 });

      await expect(listHoldingSecurityCodes(db)).resolves.toEqual(["6758", "7203"]);
    } finally {
      closeTestDb(db);
    }
  });

  it("keeps the request budget persistent and caps reservations below the safety reserve", async () => {
    const db = await createTestDb();
    try {
      const options = { budgetWindowKey: "2099-01-01" };
      for (let i = 0; i < 90; i += 1) {
        await expect(reserveMarketDataRequest(db, options)).resolves.toBe(true);
      }
      await expect(reserveMarketDataRequest(db, options)).resolves.toBe(false);
      await completeMarketDataRequest(db, options.budgetWindowKey);
      const budget = await db.select().from(schema.marketDataRequestBudgets).get();
      expect(budget?.requestsReserved).toBe(90);
      expect(budget?.requestsCompleted).toBe(1);
    } finally {
      closeTestDb(db);
    }
  });

  it("upserts a security and dividend event without duplicating rows", async () => {
    const db = await createTestDb();
    try {
      const input = {
        source: "edinetdb",
        externalSecurityId: "E00001",
        normalizedCode: "7203",
        market: null,
        name: "Company A",
        industryName: "Transport",
        listingStatus: "listed",
        mappingStatus: "resolved" as const,
        forecastFiscalYear: 2099,
        forecastQuarter: null,
        forecastDpsRaw: 100,
        forecastDpsAdjusted: null,
        forecastShareBasis: "reported",
        forecastPeriodBasis: "fiscal_year" as const,
        forecastSourceDisclosureDate: "2099-01-01",
        forecastAsOf: "2099-01-01T00:00:00.000Z",
        lastMappedAt: "2099-01-01T00:00:00.000Z",
        lastForecastFetchedAt: "2099-01-01T00:00:00.000Z",
        lastHistoryFetchedAt: null,
        lastErrorCode: null,
      };
      const id = await upsertStockMarketData(db, input);
      await upsertStockMarketData(db, input);
      const event = {
        stockMarketDataId: id,
        providerEventId: null,
        economicEventKey: "E00001:2099:annual",
        eventVersionKey: "E00001:2099:annual:v1",
        revision: 1,
        fiscalYear: 2099,
        paymentYear: null,
        period: "annual",
        status: "actual" as const,
        dpsRaw: 100,
        dpsAdjusted: null,
        periodBasis: "fiscal_year" as const,
        announcedAt: "2099-01-01",
        recordDate: null,
        exDate: null,
        paymentDate: null,
        paymentDatePrecision: "unknown" as const,
        source: "edinetdb",
        asOf: "2099-01-01T00:00:00.000Z",
      };
      await upsertStockDividendHistory(db, event);
      await upsertStockDividendHistory(db, event);
      expect((await db.select().from(schema.stockMarketData).all()).length).toBe(1);
      expect((await db.select().from(schema.stockDividendHistory).all()).length).toBe(1);
      await clearStockDividendHistory(db, id);
      expect((await db.select().from(schema.stockDividendHistory).all()).length).toBe(0);
    } finally {
      closeTestDb(db);
    }
  });

  it("builds a provider-timezone budget key", () => {
    expect(getBudgetWindowKey(new Date("2099-01-01T15:00:00.000Z"), "Asia/Tokyo")).toBe(
      "2099-01-02",
    );
  });

  it("preserves the last successful snapshot when a later stage attempt fails", async () => {
    const db = await createTestDb();
    try {
      await upsertMarketDataSyncStatus(db, {
        normalizedCode: "7203",
        stage: "forecast",
        status: "success",
        lastSuccessAt: "2099-01-01T00:00:00.000Z",
        asOf: "2099-01-01T00:00:00.000Z",
      });
      await upsertMarketDataSyncStatus(db, {
        normalizedCode: "7203",
        stage: "forecast",
        status: "error",
        errorCode: "provider_unavailable",
      });

      const status = await getMarketDataSyncStatus("7203", "forecast", "edinetdb", db);
      expect(status?.status).toBe("error");
      expect(status?.errorCode).toBe("provider_unavailable");
      expect(status?.lastSuccessAt).toBe("2099-01-01T00:00:00.000Z");
      expect(status?.asOf).toBe("2099-01-01T00:00:00.000Z");
    } finally {
      closeTestDb(db);
    }
  });
});
