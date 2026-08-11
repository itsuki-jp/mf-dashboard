import { and, eq, inArray, like } from "drizzle-orm";
import { getDb, type Db } from "../index";
import * as schema from "../schema/schema";
import { getAccountIdsForGroups, resolveGroupIds } from "../shared/group-filter";
import { getHoldingsWithLatestValues } from "./holding";

export type DividendView = "security" | "timeline";
export type DividendGranularity = "month" | "year";

export interface DividendQueryOptions {
  year?: number;
  includeForecast?: boolean;
  view?: DividendView;
  granularity?: DividendGranularity;
}

export interface DividendReceipt {
  status: "matched" | "not_dividend" | "ambiguous" | "unavailable";
  transactionId: number;
  date: string | null;
  netAmount: number | null;
  amountBasis: "net" | "unknown";
  /** Transactions do not carry a trustworthy security identity in the current schema. */
  securityStatus: "security_unresolved" | "unavailable" | "not_applicable";
}

export interface DividendMarketDataSyncStatus {
  status: "never_synced" | "success" | "empty" | "unsupported" | "error" | "stale";
  lastSuccessAt: string | null;
  ttlSeconds: number | null;
  isFresh: boolean;
}

export interface DividendSecurityRow {
  code: string;
  name: string;
  industryName: string | null;
  marketValue: number;
  quantity: number | null;
  costValue: number | null;
  forecastDps: number | null;
  forecastAnnualGross: number | null;
  forecastYieldPct: number | null;
  yieldOnCostPct: number | null;
  forecastFiscalYear: number | null;
  periodBasis: "fiscal_year" | "calendar_year" | "event_sum" | null;
  mappingStatus: "resolved" | "unresolved" | "ambiguous_match" | "unsupported" | "unavailable";
  mappingSyncStatus: DividendMarketDataSyncStatus;
  forecastSyncStatus: DividendMarketDataSyncStatus;
  dataStatus: "covered" | "unavailable" | "stale" | "calculation_unavailable";
}

export interface DividendBreakdownRow {
  label: string;
  amount: number;
  ratioPct: number;
}

export interface DividendSeriesRow {
  key: string;
  label: string;
  actual: number;
  forecast: number;
  periodBasis: "calendar_year" | "fiscal_year";
}

export interface DividendDashboardData {
  year: number;
  forecastFiscalYears: number[];
  summary: {
    actualReceivedNet: number | null;
    forecastAnnualGross: number | null;
    forecastRemainingGross: number | null;
    unknownPaymentMonthGross: number | null;
    progressPct: number | null;
    calculationStatus:
      | "ok"
      | "data_unavailable"
      | "forecast_unavailable"
      | "forecast_fiscal_year_only";
    periodBasis: "fiscal_year" | "calendar_year" | "event_sum" | null;
    totalStockMarketValue: number;
    coveredMarketValue: number;
    coveragePct: number | null;
    coveredHoldingCount: number;
    totalHoldingCount: number;
  };
  securities: DividendSecurityRow[];
  receipts: DividendReceipt[];
  industries: DividendBreakdownRow[];
  yieldBuckets: DividendBreakdownRow[];
  monthlySeries: DividendSeriesRow[];
  yearlySeries: DividendSeriesRow[];
  sourceAsOf: string | null;
}

const MARKET_DATA_SOURCE = "edinetdb";

const NEVER_SYNCED: DividendMarketDataSyncStatus = {
  status: "never_synced",
  lastSuccessAt: null,
  ttlSeconds: null,
  isFresh: false,
};

export interface DividendSecurityDetail extends DividendSecurityRow {
  history: Array<{
    fiscalYear: number;
    period: string | null;
    status: string;
    dps: number | null;
    periodBasis: string;
    announcedAt: string | null;
    paymentDate: string | null;
  }>;
}

function normalizeCode(value: string): string {
  return value.trim().toUpperCase().replace(/\.T$/, "");
}

function finite(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function roundYen(value: number): number {
  return Math.round(value);
}

function isForecastFiscalYear(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 2000 && value <= 2100;
}

function toDividendPeriodBasis(
  value: string | null | undefined,
): DividendSecurityRow["periodBasis"] {
  return value === "fiscal_year" || value === "calendar_year" || value === "event_sum"
    ? value
    : null;
}

function isSupportedForecastBasis(
  value: DividendSecurityRow["periodBasis"],
): value is "fiscal_year" {
  // Current stock_market_data forecasts are full-company fiscal-year forecasts. Other bases
  // require event-level reconciliation, which is deliberately outside this query's contract.
  return value === "fiscal_year";
}

function toSyncStatus(value: string): DividendMarketDataSyncStatus["status"] {
  switch (value) {
    case "success":
    case "empty":
    case "unsupported":
    case "error":
    case "stale":
    case "never_synced":
      return value;
    default:
      return "error";
  }
}

function makeSyncStatus(
  row: typeof schema.marketDataSyncStatuses.$inferSelect | undefined,
): DividendMarketDataSyncStatus {
  if (!row) return NEVER_SYNCED;
  const lastSuccessAt = row.lastSuccessAt;
  const ttlSeconds = row.ttlSeconds;
  const timestamp = lastSuccessAt ? Date.parse(lastSuccessAt) : Number.NaN;
  const isFresh =
    Number.isFinite(timestamp) &&
    typeof ttlSeconds === "number" &&
    ttlSeconds > 0 &&
    Date.now() - timestamp < ttlSeconds * 1000;
  return { status: toSyncStatus(row.status), lastSuccessAt, ttlSeconds, isFresh };
}

function isStaleSyncStatus(status: DividendMarketDataSyncStatus): boolean {
  return status.status === "stale" || (status.status === "success" && !status.isFresh);
}

function isCoveredSyncStatus(status: DividendMarketDataSyncStatus): boolean {
  return status.status === "success" && status.isFresh;
}

function selectForecastDps(
  market: typeof schema.stockMarketData.$inferSelect | undefined,
): number | null {
  if (!market) return null;
  switch (market.forecastShareBasis) {
    case "pre_split":
      return finite(market.forecastDpsAdjusted) ? market.forecastDpsAdjusted : null;
    case "post_split":
    case "reported":
      return finite(market.forecastDpsRaw) ? market.forecastDpsRaw : null;
    default:
      return null;
  }
}

export function classifyDividendTransaction(transaction: {
  id: number;
  date: string | null;
  accountId: number | null;
  amount: number | null;
  type: string;
  rawCategory: string | null;
  rawSubCategory: string | null;
  description?: string | null;
  isTransfer: boolean;
  isExcludedFromCalculation: boolean;
}): DividendReceipt {
  const rawText = `${transaction.rawCategory ?? ""} ${transaction.rawSubCategory ?? ""}`;
  if (
    transaction.isTransfer ||
    transaction.isExcludedFromCalculation ||
    transaction.type !== "income"
  ) {
    return {
      status: "not_dividend",
      transactionId: transaction.id,
      date: transaction.date,
      netAmount: null,
      amountBasis: "unknown",
      securityStatus: "not_applicable",
    };
  }
  if (
    transaction.amount === null ||
    transaction.amount <= 0 ||
    transaction.accountId === null ||
    transaction.date === null
  ) {
    return {
      status: "unavailable",
      transactionId: transaction.id,
      date: transaction.date,
      netAmount: null,
      amountBasis: "unknown",
      securityStatus: "unavailable",
    };
  }
  if (transaction.rawCategory === null && transaction.rawSubCategory === null) {
    return {
      status: "unavailable",
      transactionId: transaction.id,
      date: transaction.date,
      netAmount: null,
      amountBasis: "unknown",
      securityStatus: "unavailable",
    };
  }
  if (
    !rawText.includes("配当") &&
    !rawText.includes("分配") &&
    (transaction.description?.includes("配当") || transaction.description?.includes("分配"))
  ) {
    return {
      status: "ambiguous",
      transactionId: transaction.id,
      date: transaction.date,
      netAmount: null,
      amountBasis: "unknown",
      securityStatus: "security_unresolved",
    };
  }
  if (!rawText.includes("配当") && !rawText.includes("分配")) {
    return {
      status: "not_dividend",
      transactionId: transaction.id,
      date: transaction.date,
      netAmount: null,
      amountBasis: "unknown",
      securityStatus: "not_applicable",
    };
  }
  return {
    status: "matched",
    transactionId: transaction.id,
    date: transaction.date,
    netAmount: transaction.amount,
    amountBasis: "net",
    securityStatus: "security_unresolved",
  };
}

function buildBreakdown(
  rows: DividendSecurityRow[],
  getLabel: (row: DividendSecurityRow) => string | null,
) {
  const amounts = new Map<string, number>();
  for (const row of rows) {
    const label = getLabel(row) ?? "データなし";
    if (row.dataStatus !== "covered" || row.forecastAnnualGross === null) continue;
    amounts.set(label, (amounts.get(label) ?? 0) + row.forecastAnnualGross);
  }
  const total = [...amounts.values()].reduce((sum, amount) => sum + amount, 0);
  return [...amounts.entries()]
    .map(([label, amount]) => ({ label, amount, ratioPct: total > 0 ? (amount / total) * 100 : 0 }))
    .sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label));
}

function buildYieldBuckets(rows: DividendSecurityRow[]): DividendBreakdownRow[] {
  const buckets = [
    { label: "0–2%", min: 0, max: 2 },
    { label: "2–4%", min: 2, max: 4 },
    { label: "4–6%", min: 4, max: 6 },
    { label: "6–8%", min: 6, max: 8 },
    { label: "8%以上", min: 8, max: Number.POSITIVE_INFINITY },
    { label: "データなし", min: Number.NaN, max: Number.NaN },
  ];
  const amounts = buckets.map(() => 0);
  for (const row of rows) {
    const yieldPct = row.forecastYieldPct;
    if (row.dataStatus !== "covered" || row.forecastAnnualGross === null) continue;
    if (yieldPct === null || !Number.isFinite(yieldPct)) {
      amounts[amounts.length - 1] += row.forecastAnnualGross;
      continue;
    }
    const index = buckets.findIndex(({ min, max }) => yieldPct >= min && yieldPct < max);
    if (index >= 0) amounts[index] += row.forecastAnnualGross;
  }
  const total = amounts.reduce((sum, amount) => sum + amount, 0);
  return buckets.map(({ label }, index) => ({
    label,
    amount: amounts[index] ?? 0,
    ratioPct: total > 0 ? ((amounts[index] ?? 0) / total) * 100 : 0,
  }));
}

function buildActualSeries(
  year: number,
  receipts: DividendReceipt[],
): { monthly: DividendSeriesRow[]; yearly: DividendSeriesRow[] } {
  const monthly = new Map<string, number>();
  for (const receipt of receipts) {
    if (receipt.status !== "matched" || receipt.netAmount === null || !receipt.date) continue;
    const key = receipt.date.slice(0, 7);
    monthly.set(key, (monthly.get(key) ?? 0) + receipt.netAmount);
  }
  const monthlyRows = Array.from({ length: 12 }, (_, index) => {
    const month = String(index + 1).padStart(2, "0");
    const key = `${year}-${month}`;
    return {
      key,
      label: `${index + 1}月`,
      actual: monthly.get(key) ?? 0,
      forecast: 0,
      periodBasis: "calendar_year" as const,
    };
  });
  return {
    monthly: monthlyRows,
    yearly: [
      {
        key: String(year),
        label: `${year}年`,
        actual: receipts
          .filter((receipt) => receipt.status === "matched")
          .reduce((sum, receipt) => sum + (receipt.netAmount ?? 0), 0),
        forecast: 0,
        periodBasis: "calendar_year",
      },
    ],
  };
}

export async function getDividendDashboardData(
  groupId: string | undefined,
  options: DividendQueryOptions = {},
  db: Db = getDb(),
): Promise<DividendDashboardData> {
  const year = options.year ?? new Date().getFullYear();
  const holdings = (await getHoldingsWithLatestValues(groupId, db)).filter(
    (holding) => holding.type === "asset" && holding.categoryName === "株式(現物)" && holding.code,
  );
  const scopedCodes = new Set(
    holdings.map((holding) => normalizeCode(holding.code ?? "")).filter(Boolean),
  );
  let marketRows: (typeof schema.stockMarketData.$inferSelect)[] = [];
  try {
    marketRows = (await db.select().from(schema.stockMarketData).all()).filter(
      (row) =>
        row.source === MARKET_DATA_SOURCE && scopedCodes.has(normalizeCode(row.normalizedCode)),
    );
  } catch {
    // An older database may not have the migration yet. Keep the existing dashboard usable.
  }
  let syncRows: (typeof schema.marketDataSyncStatuses.$inferSelect)[] = [];
  try {
    syncRows = (await db.select().from(schema.marketDataSyncStatuses).all()).filter(
      (row) =>
        row.source === MARKET_DATA_SOURCE && scopedCodes.has(normalizeCode(row.normalizedCode)),
    );
  } catch {
    // An older database may have market rows but not sync statuses. Treat forecasts as unavailable.
  }
  const marketByCode = new Map(marketRows.map((row) => [normalizeCode(row.normalizedCode), row]));
  const syncBySourceCodeStage = new Map(
    syncRows.map((row) => [
      `${row.source}\u0000${normalizeCode(row.normalizedCode)}\u0000${row.stage}`,
      row,
    ]),
  );
  const aggregate = new Map<string, DividendSecurityRow & { costValueTotal: number | null }>();

  for (const holding of holdings) {
    const code = normalizeCode(holding.code ?? "");
    if (!code) continue;
    const market = marketByCode.get(code);
    const current = aggregate.get(code);
    const marketValue = holding.amount ?? 0;
    const quantity = holding.quantity;
    const costValue =
      finite(holding.avgCostPrice) && finite(quantity) ? holding.avgCostPrice * quantity : null;
    const dps = selectForecastDps(market);
    const forecastFiscalYear =
      market && isForecastFiscalYear(market.forecastFiscalYear) ? market.forecastFiscalYear : null;
    const periodBasis = toDividendPeriodBasis(market?.forecastPeriodBasis);
    const mappingStatus =
      market?.mappingStatus === "resolved" ||
      market?.mappingStatus === "unresolved" ||
      market?.mappingStatus === "ambiguous_match" ||
      market?.mappingStatus === "unsupported"
        ? market.mappingStatus
        : "unavailable";
    const mappingSyncStatus = market
      ? makeSyncStatus(
          syncBySourceCodeStage.get(
            `${market.source}\u0000${normalizeCode(market.normalizedCode)}\u0000mapping`,
          ),
        )
      : NEVER_SYNCED;
    const forecastSyncStatus = market
      ? makeSyncStatus(
          syncBySourceCodeStage.get(
            `${market.source}\u0000${normalizeCode(market.normalizedCode)}\u0000forecast`,
          ),
        )
      : NEVER_SYNCED;
    const forecastInputsValid =
      finite(dps) &&
      finite(quantity) &&
      forecastFiscalYear !== null &&
      isSupportedForecastBasis(periodBasis);
    const annual = forecastInputsValid ? roundYen(dps * quantity) : null;
    const next: DividendSecurityRow & { costValueTotal: number | null } = current ?? {
      code,
      name: holding.name,
      industryName: market?.industryName ?? null,
      marketValue: 0,
      quantity: 0,
      costValue: 0,
      forecastDps: dps,
      forecastAnnualGross: 0,
      forecastYieldPct: null,
      yieldOnCostPct: null,
      forecastFiscalYear,
      periodBasis,
      mappingStatus,
      mappingSyncStatus,
      forecastSyncStatus,
      dataStatus: "unavailable",
      costValueTotal: 0,
    };
    next.marketValue += marketValue;
    next.quantity = finite(next.quantity) && finite(quantity) ? next.quantity + quantity : null;
    next.costValueTotal =
      next.costValueTotal === null || costValue === null ? null : next.costValueTotal + costValue;
    next.costValue = next.costValueTotal;
    next.forecastDps = dps ?? next.forecastDps;
    next.forecastAnnualGross =
      next.forecastAnnualGross === null || annual === null
        ? null
        : next.forecastAnnualGross + annual;
    if (next.forecastAnnualGross !== null && next.marketValue > 0) {
      next.forecastYieldPct = (next.forecastAnnualGross / next.marketValue) * 100;
    }
    if (next.forecastAnnualGross !== null && next.costValue && next.costValue > 0) {
      next.yieldOnCostPct = (next.forecastAnnualGross / next.costValue) * 100;
    }
    next.dataStatus =
      !market || mappingStatus !== "resolved"
        ? "unavailable"
        : isStaleSyncStatus(mappingSyncStatus) || isStaleSyncStatus(forecastSyncStatus)
          ? "stale"
          : !isCoveredSyncStatus(mappingSyncStatus) || !isCoveredSyncStatus(forecastSyncStatus)
            ? "unavailable"
            : next.forecastAnnualGross === null
              ? "calculation_unavailable"
              : "covered";
    aggregate.set(code, next);
  }

  const securities = [...aggregate.values()].map(
    ({ costValueTotal: _costValueTotal, ...row }) => row,
  );
  const groupIds = await resolveGroupIds(db, groupId);
  const accountIds = await getAccountIdsForGroups(db, groupIds);
  let transactionRows: (typeof schema.transactions.$inferSelect)[] = [];
  try {
    transactionRows =
      accountIds.length === 0
        ? []
        : await db
            .select()
            .from(schema.transactions)
            .where(
              and(
                inArray(schema.transactions.accountId, accountIds),
                like(schema.transactions.date, `${year}-%`),
              ),
            )
            .all();
  } catch {
    // Raw category columns are added by the migration. Missing columns mean actuals are unavailable.
  }
  const receipts = transactionRows.map((transaction) => classifyDividendTransaction(transaction));
  const matched = receipts.filter((receipt) => receipt.status === "matched");
  const hasUnknownReceipts = receipts.some(
    (receipt) => receipt.status === "unavailable" || receipt.status === "ambiguous",
  );
  const actualReceivedNet =
    transactionRows.length === 0 || hasUnknownReceipts
      ? null
      : matched.reduce((sum, receipt) => sum + (receipt.netAmount ?? 0), 0);
  const coveredRows = securities.filter((row) => row.dataStatus === "covered");
  const totalStockMarketValue = securities.reduce((sum, row) => sum + row.marketValue, 0);
  const coveredMarketValue = coveredRows.reduce((sum, row) => sum + row.marketValue, 0);
  const forecastAnnualGross =
    coveredRows.length === 0
      ? null
      : coveredRows.reduce((sum, row) => sum + (row.forecastAnnualGross ?? 0), 0);
  const periodBasis = forecastAnnualGross === null ? null : "fiscal_year";
  const actualAndForecastComparable = false;
  const actualSeries = buildActualSeries(year, receipts);
  const sourceAsOf = marketRows.reduce<string | null>(
    (latest, row) =>
      row.forecastAsOf && (!latest || row.forecastAsOf > latest) ? row.forecastAsOf : latest,
    null,
  );
  const forecastFiscalYears = [
    ...new Set(
      coveredRows
        .map((row) => row.forecastFiscalYear)
        .filter((value): value is number => value !== null),
    ),
  ].sort((a, b) => a - b);

  return {
    year,
    forecastFiscalYears,
    summary: {
      actualReceivedNet,
      forecastAnnualGross,
      forecastRemainingGross: actualAndForecastComparable ? forecastAnnualGross : null,
      unknownPaymentMonthGross: forecastAnnualGross,
      progressPct:
        actualAndForecastComparable && actualReceivedNet !== null && forecastAnnualGross
          ? (actualReceivedNet / forecastAnnualGross) * 100
          : null,
      calculationStatus:
        securities.length === 0
          ? "data_unavailable"
          : forecastAnnualGross === null
            ? "forecast_unavailable"
            : "forecast_fiscal_year_only",
      periodBasis,
      totalStockMarketValue,
      coveredMarketValue,
      coveragePct:
        totalStockMarketValue > 0 ? (coveredMarketValue / totalStockMarketValue) * 100 : null,
      coveredHoldingCount: coveredRows.length,
      totalHoldingCount: securities.length,
    },
    securities: securities.sort(
      (a, b) => b.marketValue - a.marketValue || a.name.localeCompare(b.name),
    ),
    receipts,
    industries: buildBreakdown(securities, (row) => row.industryName ?? "業種データなし"),
    yieldBuckets: buildYieldBuckets(securities),
    monthlySeries: actualSeries.monthly,
    yearlySeries: actualSeries.yearly,
    sourceAsOf,
  };
}

export async function getDividendSecurityDetail(
  code: string,
  groupId: string | undefined,
  options: DividendQueryOptions = {},
  db: Db = getDb(),
): Promise<DividendSecurityDetail | null> {
  const data = await getDividendDashboardData(groupId, options, db);
  const row = data.securities.find((security) => security.code === normalizeCode(code));
  if (!row) return null;
  let market: { id: number } | undefined;
  try {
    market = await db
      .select({ id: schema.stockMarketData.id })
      .from(schema.stockMarketData)
      .where(
        and(
          eq(schema.stockMarketData.source, "edinetdb"),
          eq(schema.stockMarketData.normalizedCode, row.code),
        ),
      )
      .get();
  } catch {
    // An older database may not have the market-data migration yet.
    return { ...row, history: [] };
  }
  if (!market) return { ...row, history: [] };
  let history: (typeof schema.stockDividendHistory.$inferSelect)[] = [];
  try {
    history = await db
      .select()
      .from(schema.stockDividendHistory)
      .where(eq(schema.stockDividendHistory.stockMarketDataId, market.id))
      .all();
  } catch {
    // An older database may not have the dividend-history migration yet.
  }
  return {
    ...row,
    history: history
      .sort((a, b) => b.fiscalYear - a.fiscalYear)
      .map((event) => ({
        fiscalYear: event.fiscalYear,
        period: event.period,
        status: event.status,
        dps: event.dpsAdjusted ?? event.dpsRaw,
        periodBasis: event.periodBasis,
        announcedAt: event.announcedAt,
        paymentDate: event.paymentDate,
      })),
  };
}

export function toDividendCsv(data: DividendDashboardData, includeForecast = true): string {
  const header = [
    "行種別",
    "銘柄コード",
    "銘柄名",
    "業種",
    "評価額",
    "数量",
    "年間予想配当",
    "予想配当利回り(%)",
    "Yield on Cost(%)",
    "予想対象年度",
    "期間基準",
    "データ状態",
    "受取日",
    "受取額",
    "金額基準",
    "受取状態",
    "銘柄状態",
    "取引ID",
  ];
  const escape = (value: string | number | null) => {
    const raw = value === null ? "" : String(value);
    const text = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return [
    header.map(escape).join(","),
    ...(includeForecast
      ? data.securities.map((row) =>
          [
            "forecast",
            row.code,
            row.name,
            row.industryName,
            row.marketValue,
            row.quantity,
            row.forecastAnnualGross,
            row.forecastYieldPct,
            row.yieldOnCostPct,
            row.forecastFiscalYear,
            row.periodBasis,
            row.dataStatus,
            null,
            null,
            null,
            null,
            null,
            null,
          ]
            .map(escape)
            .join(","),
        )
      : []),
    ...data.receipts
      .filter((receipt) => receipt.status !== "not_dividend")
      .map((receipt) =>
        [
          "actual",
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          receipt.date,
          receipt.netAmount,
          receipt.amountBasis,
          receipt.status,
          receipt.securityStatus,
          receipt.transactionId,
        ]
          .map(escape)
          .join(","),
      ),
  ].join("\n");
}
