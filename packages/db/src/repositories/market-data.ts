import { and, eq, isNotNull, lt, sql } from "drizzle-orm";
import { getDb, type Db, type DbExecutor, schema } from "../index";
import type {
  MarketDataStage,
  MarketDataSyncStatus,
  StockDividendHistoryInput,
  StockMarketDataInput,
} from "../types";
import { now } from "../utils";

export const EDINET_DB_SOURCE = "edinetdb";
export const EDINET_DB_DEFAULT_TIMEZONE = "Asia/Tokyo";
export const EDINET_DB_DAILY_LIMIT = 100;
export const EDINET_DB_SOFT_LIMIT = 90;
export const EDINET_DB_SAFETY_RESERVE = 5;

export async function listHoldingSecurityCodes(db: Db = getDb()): Promise<string[]> {
  const rows = await db
    .selectDistinct({ code: schema.holdings.code })
    .from(schema.holdings)
    .where(and(eq(schema.holdings.type, "asset"), isNotNull(schema.holdings.code)))
    .all();
  return rows
    .map(({ code }) => code)
    .filter((code): code is string => typeof code === "string" && code.trim().length > 0);
}

export async function upsertStockMarketData(
  db: DbExecutor,
  input: StockMarketDataInput,
): Promise<number> {
  const timestamp = now();
  const values = {
    ...input,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await db
    .insert(schema.stockMarketData)
    .values(values)
    .onConflictDoUpdate({
      target: [schema.stockMarketData.source, schema.stockMarketData.normalizedCode],
      set: {
        externalSecurityId: sql`excluded.external_security_id`,
        market: sql`excluded.market`,
        name: sql`excluded.name`,
        industryName: sql`excluded.industry_name`,
        listingStatus: sql`excluded.listing_status`,
        mappingStatus: sql`excluded.mapping_status`,
        forecastFiscalYear: sql`excluded.forecast_fiscal_year`,
        forecastQuarter: sql`excluded.forecast_quarter`,
        forecastDpsRaw: sql`excluded.forecast_dps_raw`,
        forecastDpsAdjusted: sql`excluded.forecast_dps_adjusted`,
        forecastShareBasis: sql`excluded.forecast_share_basis`,
        forecastPeriodBasis: sql`excluded.forecast_period_basis`,
        forecastSourceDisclosureDate: sql`excluded.forecast_source_disclosure_date`,
        forecastAsOf: sql`excluded.forecast_as_of`,
        lastMappedAt: sql`excluded.last_mapped_at`,
        lastForecastFetchedAt: sql`excluded.last_forecast_fetched_at`,
        lastHistoryFetchedAt: sql`excluded.last_history_fetched_at`,
        lastErrorCode: sql`excluded.last_error_code`,
        updatedAt: timestamp,
      },
    })
    .run();

  const row = await db
    .select({ id: schema.stockMarketData.id })
    .from(schema.stockMarketData)
    .where(
      and(
        eq(schema.stockMarketData.source, input.source),
        eq(schema.stockMarketData.normalizedCode, input.normalizedCode),
      ),
    )
    .get();
  if (!row) throw new Error("Market data upsert did not return a row");
  return row.id;
}

export async function getStockMarketDataByCode(
  normalizedCode: string,
  source = EDINET_DB_SOURCE,
  db: Db = getDb(),
) {
  return db
    .select()
    .from(schema.stockMarketData)
    .where(
      and(
        eq(schema.stockMarketData.source, source),
        eq(schema.stockMarketData.normalizedCode, normalizedCode),
      ),
    )
    .get();
}

export async function upsertStockDividendHistory(
  db: DbExecutor,
  input: StockDividendHistoryInput,
): Promise<void> {
  const timestamp = now();
  await db
    .insert(schema.stockDividendHistory)
    .values({ ...input, createdAt: timestamp, updatedAt: timestamp })
    .onConflictDoUpdate({
      target: [schema.stockDividendHistory.source, schema.stockDividendHistory.eventVersionKey],
      set: {
        stockMarketDataId: input.stockMarketDataId,
        providerEventId: input.providerEventId,
        economicEventKey: input.economicEventKey,
        revision: input.revision,
        fiscalYear: input.fiscalYear,
        paymentYear: input.paymentYear,
        period: input.period,
        status: input.status,
        dpsRaw: input.dpsRaw,
        dpsAdjusted: input.dpsAdjusted,
        periodBasis: input.periodBasis,
        announcedAt: input.announcedAt,
        recordDate: input.recordDate,
        exDate: input.exDate,
        paymentDate: input.paymentDate,
        paymentDatePrecision: input.paymentDatePrecision,
        asOf: input.asOf,
        updatedAt: timestamp,
      },
    })
    .run();
}

export async function upsertMarketDataSyncStatus(
  db: DbExecutor,
  input: {
    normalizedCode: string;
    stage: MarketDataStage;
    status: MarketDataSyncStatus;
    errorCode?: string | null;
    lastSuccessAt?: string | null;
    nextAllowedAt?: string | null;
    ttlSeconds?: number | null;
    asOf?: string | null;
    source?: string;
  },
): Promise<void> {
  const timestamp = now();
  const source = input.source ?? EDINET_DB_SOURCE;
  await db
    .insert(schema.marketDataSyncStatuses)
    .values({
      source,
      normalizedCode: input.normalizedCode,
      stage: input.stage,
      status: input.status,
      errorCode: input.errorCode ?? null,
      lastAttemptedAt: timestamp,
      lastSuccessAt: input.lastSuccessAt ?? null,
      nextAllowedAt: input.nextAllowedAt ?? null,
      ttlSeconds: input.ttlSeconds ?? null,
      asOf: input.asOf ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .onConflictDoUpdate({
      target: [
        schema.marketDataSyncStatuses.source,
        schema.marketDataSyncStatuses.normalizedCode,
        schema.marketDataSyncStatuses.stage,
      ],
      set: {
        status: input.status,
        errorCode: input.errorCode ?? null,
        lastAttemptedAt: timestamp,
        lastSuccessAt:
          input.lastSuccessAt === undefined
            ? sql`${schema.marketDataSyncStatuses.lastSuccessAt}`
            : input.lastSuccessAt,
        nextAllowedAt: input.nextAllowedAt ?? null,
        ttlSeconds: input.ttlSeconds ?? null,
        asOf: input.asOf === undefined ? sql`${schema.marketDataSyncStatuses.asOf}` : input.asOf,
        updatedAt: timestamp,
      },
    })
    .run();
}

export async function getMarketDataSyncStatus(
  normalizedCode: string,
  stage: MarketDataStage,
  source = EDINET_DB_SOURCE,
  db: Db = getDb(),
) {
  return db
    .select()
    .from(schema.marketDataSyncStatuses)
    .where(
      and(
        eq(schema.marketDataSyncStatuses.source, source),
        eq(schema.marketDataSyncStatuses.normalizedCode, normalizedCode),
        eq(schema.marketDataSyncStatuses.stage, stage),
      ),
    )
    .get();
}

export function getBudgetWindowKey(
  date = new Date(),
  timezone = EDINET_DB_DEFAULT_TIMEZONE,
): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export async function reserveMarketDataRequest(
  db: Db,
  options: {
    source?: string;
    budgetWindowKey: string;
    providerTimezone?: string;
    dailyLimit?: number;
    softLimit?: number;
    safetyReserve?: number;
    windowResetAt?: string | null;
  },
): Promise<boolean> {
  const source = options.source ?? EDINET_DB_SOURCE;
  const providerTimezone = options.providerTimezone ?? EDINET_DB_DEFAULT_TIMEZONE;
  const dailyLimit = options.dailyLimit ?? EDINET_DB_DAILY_LIMIT;
  const softLimit = options.softLimit ?? EDINET_DB_SOFT_LIMIT;
  const safetyReserve = options.safetyReserve ?? EDINET_DB_SAFETY_RESERVE;
  const timestamp = now();

  await db
    .insert(schema.marketDataRequestBudgets)
    .values({
      source,
      budgetWindowKey: options.budgetWindowKey,
      providerTimezone,
      dailyLimit,
      softLimit,
      safetyReserve,
      requestsReserved: 0,
      requestsCompleted: 0,
      windowResetAt: options.windowResetAt ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .onConflictDoNothing()
    .run();

  const cap = Math.min(softLimit, Math.max(0, dailyLimit - safetyReserve));
  const result = await db
    .update(schema.marketDataRequestBudgets)
    .set({
      requestsReserved: sql`${schema.marketDataRequestBudgets.requestsReserved} + 1`,
      updatedAt: timestamp,
    })
    .where(
      and(
        eq(schema.marketDataRequestBudgets.source, source),
        eq(schema.marketDataRequestBudgets.budgetWindowKey, options.budgetWindowKey),
        lt(schema.marketDataRequestBudgets.requestsReserved, cap),
      ),
    )
    .run();
  return result.rowsAffected === 1;
}

export async function completeMarketDataRequest(
  db: DbExecutor,
  budgetWindowKey: string,
  source = EDINET_DB_SOURCE,
): Promise<void> {
  await db
    .update(schema.marketDataRequestBudgets)
    .set({
      requestsCompleted: sql`${schema.marketDataRequestBudgets.requestsCompleted} + 1`,
      updatedAt: now(),
    })
    .where(
      and(
        eq(schema.marketDataRequestBudgets.source, source),
        eq(schema.marketDataRequestBudgets.budgetWindowKey, budgetWindowKey),
      ),
    )
    .run();
}
