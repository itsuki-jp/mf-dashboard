import type { Db } from "@mf-dashboard/db";
import {
  completeMarketDataRequest,
  EDINET_DB_DEFAULT_TIMEZONE,
  EDINET_DB_SOURCE,
  getBudgetWindowKey,
  getMarketDataSyncStatus,
  getStockMarketDataByCode,
  listHoldingSecurityCodes,
  reserveMarketDataRequest,
  upsertMarketDataSyncStatus,
  upsertStockDividendHistory,
  upsertStockMarketData,
} from "@mf-dashboard/db/repository/market-data";
import type { DividendPeriodBasis, StockMarketDataInput } from "@mf-dashboard/db/types";
import { error, info, warn } from "../logger.js";
import { EdinetDbApiError, type EdinetDbClient } from "./edinet-db-client.js";
import { normalizeSecurityCode, resolveSecurityCode } from "./security-code.js";

const HISTORY_YEARS = 6;
const STAGE_TTL_SECONDS = {
  mapping: 30 * 24 * 60 * 60,
  forecast: 24 * 60 * 60,
  history: 7 * 24 * 60 * 60,
} as const;

class EdinetBudgetExhaustedError extends Error {
  constructor() {
    super("EDINET DB request budget exhausted");
    this.name = "EdinetBudgetExhaustedError";
  }
}

class StopEdinetSyncError extends Error {
  constructor() {
    super("EDINET DB rate limit reached");
    this.name = "StopEdinetSyncError";
  }
}

function errorCode(value: unknown): string {
  if (value instanceof EdinetDbApiError) {
    if (value.status === 401 || value.status === 403) return "authentication_failed";
    if (value.status === 429) return "rate_limited";
    if (value.status && value.status >= 500) return "provider_server_error";
    return value.kind === "timeout" ? "timeout" : `provider_${value.kind}`;
  }
  if (value instanceof EdinetBudgetExhaustedError) return "budget_exhausted";
  return "sync_failed";
}

function isRetryable(value: unknown): boolean {
  return (
    value instanceof EdinetDbApiError &&
    (value.kind === "network" || value.kind === "timeout" || (value.status ?? 0) >= 500)
  );
}

async function requestWithBudget<T>(
  db: Db,
  budgetWindowKey: string,
  operation: () => Promise<T>,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const reserved = await reserveMarketDataRequest(db, {
      source: EDINET_DB_SOURCE,
      budgetWindowKey,
      providerTimezone: EDINET_DB_DEFAULT_TIMEZONE,
    });
    if (!reserved) throw new EdinetBudgetExhaustedError();

    try {
      return await operation();
    } catch (caught) {
      lastError = caught;
      if (caught instanceof EdinetDbApiError && caught.status === 429) {
        throw new StopEdinetSyncError();
      }
      if (!isRetryable(caught) || attempt === 1) throw caught;
      await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
    } finally {
      await completeMarketDataRequest(db, budgetWindowKey);
    }
  }
  throw lastError ?? new Error("EDINET DB request failed");
}

function asFiniteNumber(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toFiscalYear(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function emptyStockInput(
  normalizedCode: string,
  candidate: {
    edinet_code: string;
    sec_code: string | number | null;
    name: string;
    industry?: string | null;
    listing_status?: string | null;
  },
  fetchedAt: string,
): StockMarketDataInput {
  return {
    source: EDINET_DB_SOURCE,
    externalSecurityId: candidate.edinet_code,
    normalizedCode,
    market: null,
    name: candidate.name,
    industryName: candidate.industry ?? null,
    listingStatus: candidate.listing_status ?? "unknown",
    mappingStatus: "resolved",
    forecastFiscalYear: null,
    forecastQuarter: null,
    forecastDpsRaw: null,
    forecastDpsAdjusted: null,
    forecastShareBasis: null,
    forecastPeriodBasis: null,
    forecastSourceDisclosureDate: null,
    forecastAsOf: null,
    lastMappedAt: fetchedAt,
    lastForecastFetchedAt: null,
    lastHistoryFetchedAt: null,
    lastErrorCode: null,
  };
}

function isFresh(lastSuccessAt: string | null | undefined, ttlSeconds: number): boolean {
  if (!lastSuccessAt) return false;
  const timestamp = Date.parse(lastSuccessAt);
  return Number.isFinite(timestamp) && Date.now() - timestamp < ttlSeconds * 1000;
}

function stockInputFromRow(
  row: NonNullable<Awaited<ReturnType<typeof getStockMarketDataByCode>>>,
): StockMarketDataInput {
  return {
    source: row.source,
    externalSecurityId: row.externalSecurityId,
    normalizedCode: row.normalizedCode,
    market: row.market,
    name: row.name,
    industryName: row.industryName,
    listingStatus: row.listingStatus,
    mappingStatus: row.mappingStatus as StockMarketDataInput["mappingStatus"],
    forecastFiscalYear: row.forecastFiscalYear,
    forecastQuarter: row.forecastQuarter,
    forecastDpsRaw: row.forecastDpsRaw,
    forecastDpsAdjusted: row.forecastDpsAdjusted,
    forecastShareBasis: row.forecastShareBasis,
    forecastPeriodBasis: row.forecastPeriodBasis as StockMarketDataInput["forecastPeriodBasis"],
    forecastSourceDisclosureDate: row.forecastSourceDisclosureDate,
    forecastAsOf: row.forecastAsOf,
    lastMappedAt: row.lastMappedAt,
    lastForecastFetchedAt: row.lastForecastFetchedAt,
    lastHistoryFetchedAt: row.lastHistoryFetchedAt,
    lastErrorCode: row.lastErrorCode,
  };
}

async function syncOneSecurity(
  db: Db,
  client: EdinetDbClient,
  rawCode: string,
  budgetWindowKey: string,
): Promise<"success" | "skipped"> {
  const normalizedCode = normalizeSecurityCode(rawCode);
  if (!normalizedCode) return "skipped";

  const existingRow = await getStockMarketDataByCode(normalizedCode, EDINET_DB_SOURCE, db);
  const existingMapping = await getMarketDataSyncStatus(
    normalizedCode,
    "mapping",
    EDINET_DB_SOURCE,
    db,
  );
  let stock: StockMarketDataInput;
  let externalSecurityId: string;
  let stockMarketDataId: number;
  if (existingRow && isFresh(existingMapping?.lastSuccessAt, STAGE_TTL_SECONDS.mapping)) {
    stock = stockInputFromRow(existingRow);
    externalSecurityId = stock.externalSecurityId;
    stockMarketDataId = existingRow.id;
  } else {
    const mappingFetchedAt = new Date().toISOString();
    let candidates;
    try {
      candidates = await requestWithBudget(db, budgetWindowKey, () =>
        client.findCompaniesBySecurityCode(normalizedCode),
      );
    } catch (caught) {
      await upsertMarketDataSyncStatus(db, {
        normalizedCode,
        stage: "mapping",
        status: "error",
        errorCode: errorCode(caught),
        ttlSeconds: STAGE_TTL_SECONDS.mapping,
      });
      throw caught;
    }

    const resolution = resolveSecurityCode(normalizedCode, candidates);
    if (resolution.status !== "resolved" || !resolution.candidate) {
      await upsertMarketDataSyncStatus(db, {
        normalizedCode,
        stage: "mapping",
        status: resolution.status === "unsupported" ? "unsupported" : "empty",
        errorCode: resolution.status,
        ttlSeconds: STAGE_TTL_SECONDS.mapping,
      });
      return "skipped";
    }

    stock = emptyStockInput(normalizedCode, resolution.candidate, mappingFetchedAt);
    externalSecurityId = resolution.candidate.edinet_code;
    stockMarketDataId = await upsertStockMarketData(db, stock);
    await upsertMarketDataSyncStatus(db, {
      normalizedCode,
      stage: "mapping",
      status: "success",
      lastSuccessAt: mappingFetchedAt,
      ttlSeconds: STAGE_TTL_SECONDS.mapping,
      asOf: mappingFetchedAt,
    });
  }

  const forecastStatus = await getMarketDataSyncStatus(
    normalizedCode,
    "forecast",
    EDINET_DB_SOURCE,
    db,
  );
  if (!isFresh(forecastStatus?.lastSuccessAt, STAGE_TTL_SECONDS.forecast)) {
    try {
      const company = await requestWithBudget(db, budgetWindowKey, () =>
        client.getCompany(externalSecurityId),
      );
      const forecast = company.forecast_doe ?? null;
      const forecastFetchedAt = new Date().toISOString();
      stock = {
        ...stock,
        name: company.name || stock.name,
        industryName: company.industry ?? stock.industryName,
        listingStatus: company.listing_status ?? stock.listingStatus,
        forecastFiscalYear: toFiscalYear(forecast?.forecast_fiscal_year),
        forecastQuarter: forecast?.source_quarter ?? null,
        forecastDpsRaw: asFiniteNumber(forecast?.forecast_dividend_per_share),
        forecastDpsAdjusted: null,
        forecastShareBasis: "reported",
        forecastPeriodBasis: "fiscal_year" satisfies DividendPeriodBasis,
        forecastSourceDisclosureDate: forecast?.source_disclosure_date ?? null,
        forecastAsOf: forecastFetchedAt,
        lastForecastFetchedAt: forecastFetchedAt,
      };
      await upsertStockMarketData(db, stock);
      await upsertMarketDataSyncStatus(db, {
        normalizedCode,
        stage: "forecast",
        status: forecast?.forecast_dividend_per_share == null ? "empty" : "success",
        lastSuccessAt: forecastFetchedAt,
        ttlSeconds: STAGE_TTL_SECONDS.forecast,
        asOf: forecastFetchedAt,
      });
    } catch (caught) {
      await upsertMarketDataSyncStatus(db, {
        normalizedCode,
        stage: "forecast",
        status: "error",
        errorCode: errorCode(caught),
        ttlSeconds: STAGE_TTL_SECONDS.forecast,
      });
      if (caught instanceof StopEdinetSyncError || caught instanceof EdinetBudgetExhaustedError) {
        throw caught;
      }
    }
  }

  const historyStatus = await getMarketDataSyncStatus(
    normalizedCode,
    "history",
    EDINET_DB_SOURCE,
    db,
  );
  if (!isFresh(historyStatus?.lastSuccessAt, STAGE_TTL_SECONDS.history)) {
    try {
      const financials = await requestWithBudget(db, budgetWindowKey, () =>
        client.getFinancials(externalSecurityId, HISTORY_YEARS),
      );
      const historyFetchedAt = new Date().toISOString();
      for (const financial of financials) {
        const fiscalYear = toFiscalYear(financial.fiscal_year);
        const dpsRaw = asFiniteNumber(financial.dividend_per_share);
        const dpsAdjusted = asFiniteNumber(financial.adjusted_dividend_per_share);
        if (fiscalYear === null || (dpsRaw === null && dpsAdjusted === null)) continue;
        await upsertStockDividendHistory(db, {
          stockMarketDataId,
          providerEventId: null,
          economicEventKey: `${externalSecurityId}:${fiscalYear}:annual`,
          eventVersionKey: `${externalSecurityId}:${fiscalYear}:annual:v1`,
          revision: 1,
          fiscalYear,
          paymentYear: null,
          period: "annual",
          status: "actual",
          dpsRaw,
          dpsAdjusted,
          periodBasis: "fiscal_year",
          announcedAt: financial.submit_date ?? null,
          recordDate: null,
          exDate: null,
          paymentDate: null,
          paymentDatePrecision: "unknown",
          source: EDINET_DB_SOURCE,
          asOf: historyFetchedAt,
        });
      }
      await upsertStockMarketData(db, { ...stock, lastHistoryFetchedAt: historyFetchedAt });
      await upsertMarketDataSyncStatus(db, {
        normalizedCode,
        stage: "history",
        status: financials.length === 0 ? "empty" : "success",
        lastSuccessAt: historyFetchedAt,
        ttlSeconds: STAGE_TTL_SECONDS.history,
        asOf: historyFetchedAt,
      });
    } catch (caught) {
      await upsertMarketDataSyncStatus(db, {
        normalizedCode,
        stage: "history",
        status: "error",
        errorCode: errorCode(caught),
        ttlSeconds: STAGE_TTL_SECONDS.history,
      });
      if (caught instanceof StopEdinetSyncError || caught instanceof EdinetBudgetExhaustedError) {
        throw caught;
      }
    }
  }

  return "success";
}

export async function syncStockMarketData(db: Db, client: EdinetDbClient): Promise<void> {
  const rawCodes = await listHoldingSecurityCodes(db);
  const budgetWindowKey = getBudgetWindowKey();
  let synced = 0;
  let skipped = 0;
  for (const rawCode of rawCodes) {
    try {
      if ((await syncOneSecurity(db, client, rawCode, budgetWindowKey)) === "success") synced += 1;
      else skipped += 1;
    } catch (caught) {
      if (caught instanceof StopEdinetSyncError || caught instanceof EdinetBudgetExhaustedError) {
        warn(`EDINET DB sync stopped (${errorCode(caught)}); remaining securities deferred.`);
        break;
      }
      skipped += 1;
      error(`EDINET DB security sync failed (${errorCode(caught)}).`);
    }
  }
  info(
    `EDINET DB sync completed: ${synced} synced, ${skipped} skipped, ${rawCodes.length} candidates.`,
  );
}
