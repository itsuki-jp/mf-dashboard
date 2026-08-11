import { schema } from "@mf-dashboard/db";
import { createTestDb, createTestProfile, closeTestDb } from "@mf-dashboard/db/test-helpers";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EdinetDbClient } from "./edinet-db-client.js";
import { syncStockMarketData } from "./sync-stock-market-data.js";

describe("syncStockMarketData", () => {
  let db: Awaited<ReturnType<typeof createTestDb>> | undefined;

  afterEach(() => {
    if (db) closeTestDb(db);
    db = undefined;
  });

  it("syncs one holding and does not refetch within stage TTLs", async () => {
    db = await createTestDb();
    await createTestProfile(db);
    const timestamp = new Date().toISOString();
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
    await db.insert(schema.holdings).values({
      profileId: "primary",
      mfId: "holding-a",
      accountId: 1,
      categoryId: null,
      name: "Company A",
      code: "7203",
      type: "asset",
      liabilityCategory: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      isActive: true,
    });

    const client = {
      findCompaniesBySecurityCode: vi.fn().mockResolvedValue([
        {
          edinet_code: "E00001",
          sec_code: "7203",
          name: "Company A",
          industry: "Transport",
          listing_status: "listed",
          is_delisted: false,
        },
      ]),
      getCompany: vi.fn().mockResolvedValue({
        edinet_code: "E00001",
        sec_code: "7203",
        name: "Company A",
        industry: "Transport",
        listing_status: "listed",
        forecast_doe: {
          forecast_dividend_per_share: 100,
          forecast_fiscal_year: 2099,
          source_disclosure_date: "2099-01-01",
          source_quarter: "Q3",
        },
      }),
      getFinancials: vi.fn().mockResolvedValue([
        {
          fiscal_year: 2098,
          dividend_per_share: 90,
          adjusted_dividend_per_share: null,
          submit_date: "2099-01-01",
        },
      ]),
    } as unknown as EdinetDbClient;

    await syncStockMarketData(db, client);
    await syncStockMarketData(db, client);

    expect(client.findCompaniesBySecurityCode).toHaveBeenCalledTimes(1);
    expect(client.getCompany).toHaveBeenCalledTimes(1);
    expect(client.getFinancials).toHaveBeenCalledTimes(1);
    expect((await db.select().from(schema.stockMarketData).all()).length).toBe(1);
    expect((await db.select().from(schema.stockDividendHistory).all()).length).toBe(1);
  });
});
