import { and, eq, inArray, like } from "drizzle-orm";
import { getDb, type Db, schema } from "../index";
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
  dataStatus: "covered" | "unavailable" | "calculation_unavailable";
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
  industries: DividendBreakdownRow[];
  yieldBuckets: DividendBreakdownRow[];
  monthlySeries: DividendSeriesRow[];
  yearlySeries: DividendSeriesRow[];
  sourceAsOf: string | null;
}

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

export function classifyDividendTransaction(transaction: {
  id: number;
  date: string | null;
  accountId: number | null;
  amount: number | null;
  type: string;
  rawCategory: string | null;
  rawSubCategory: string | null;
  isTransfer: boolean;
  isExcludedFromCalculation: boolean;
}): DividendReceipt {
  const rawText = `${transaction.rawCategory ?? ""} ${transaction.rawSubCategory ?? ""}`;
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
    };
  }
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
    };
  }
  if (transaction.rawCategory === null && transaction.rawSubCategory === null) {
    return {
      status: "unavailable",
      transactionId: transaction.id,
      date: transaction.date,
      netAmount: null,
      amountBasis: "unknown",
    };
  }
  if (!rawText.includes("配当") && !rawText.includes("分配")) {
    return {
      status: "not_dividend",
      transactionId: transaction.id,
      date: transaction.date,
      netAmount: null,
      amountBasis: "unknown",
    };
  }
  return {
    status: "matched",
    transactionId: transaction.id,
    date: transaction.date,
    netAmount: transaction.amount,
    amountBasis: "net",
  };
}

function buildBreakdown(
  rows: DividendSecurityRow[],
  getLabel: (row: DividendSecurityRow) => string | null,
) {
  const amounts = new Map<string, number>();
  for (const row of rows) {
    const label = getLabel(row) ?? "データなし";
    if (row.forecastAnnualGross === null) continue;
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
    if (row.forecastAnnualGross === null) continue;
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
  let marketRows: (typeof schema.stockMarketData.$inferSelect)[] = [];
  try {
    marketRows = await db.select().from(schema.stockMarketData).all();
  } catch {
    // An older database may not have the migration yet. Keep the existing dashboard usable.
  }
  const marketByCode = new Map(marketRows.map((row) => [normalizeCode(row.normalizedCode), row]));
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
    const dps = market ? (market.forecastDpsAdjusted ?? market.forecastDpsRaw) : null;
    const annual = finite(dps) && finite(quantity) ? roundYen(dps * quantity) : null;
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
      forecastFiscalYear: market?.forecastFiscalYear ?? null,
      periodBasis: (market?.forecastPeriodBasis as DividendSecurityRow["periodBasis"]) ?? null,
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
    next.dataStatus = !market
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
  const hasUnknownReceipts = receipts.some((receipt) => receipt.status === "unavailable");
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
      securities
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
  ];
  const escape = (value: string | number | null) => {
    const raw = value === null ? "" : String(value);
    const text = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return [
    header.map(escape).join(","),
    ...data.securities.map((row) =>
      [
        row.code,
        row.name,
        row.industryName,
        row.marketValue,
        row.quantity,
        includeForecast ? row.forecastAnnualGross : null,
        includeForecast ? row.forecastYieldPct : null,
        includeForecast ? row.yieldOnCostPct : null,
        includeForecast ? row.forecastFiscalYear : null,
        includeForecast ? row.periodBasis : null,
        row.dataStatus,
      ]
        .map(escape)
        .join(","),
    ),
  ].join("\n");
}
