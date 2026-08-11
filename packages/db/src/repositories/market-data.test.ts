import { describe, expect, it } from "vitest";
import { schema } from "../index";
import { closeTestDb, createTestDb } from "../test-helpers";
import {
  completeMarketDataRequest,
  getBudgetWindowKey,
  reserveMarketDataRequest,
  upsertStockDividendHistory,
  upsertStockMarketData,
} from "./market-data";

describe("market data repositories", () => {
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
    } finally {
      closeTestDb(db);
    }
  });

  it("builds a provider-timezone budget key", () => {
    expect(getBudgetWindowKey(new Date("2099-01-01T15:00:00.000Z"), "Asia/Tokyo")).toBe(
      "2099-01-02",
    );
  });
});
