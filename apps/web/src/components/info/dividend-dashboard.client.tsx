"use client";

import type {
  DividendDashboardData,
  DividendGranularity,
  DividendSecurityDetail,
  DividendView,
} from "@mf-dashboard/db/queries/dividend";
import { Download, ExternalLink, Filter, TrendingUp, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { formatCurrency, formatDate, formatPercent } from "../../lib/format";
import { cn } from "../../lib/utils";
import { DividendCompositionChart } from "../charts/dividend-composition-chart";
import { DividendHistoryChart } from "../charts/dividend-history-chart";
import { AmountDisplay } from "../ui/amount-display";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";

export type DashboardView = DividendView | "industry" | "yield";

export interface DividendDashboardQuery {
  includeForecast: boolean;
  view: DashboardView;
  granularity: DividendGranularity;
  year: number;
  security?: string;
}

interface DividendDashboardClientProps {
  data: DividendDashboardData;
  detail: DividendSecurityDetail | null;
  prefetchedDetails: Record<string, DividendSecurityDetail | null>;
  staticDemo: boolean;
  csvWithForecast: string;
  csvActualOnly: string;
  queryString: string;
  initialIncludeForecast: boolean;
  initialView: DashboardView;
  initialGranularity: DividendGranularity;
}

const QUERY_ORDER = ["granularity", "includeForecast", "security", "view", "year"] as const;

function isDashboardView(value: string | null): value is DashboardView {
  return value === "security" || value === "timeline" || value === "industry" || value === "yield";
}

function isGranularity(value: string | null): value is DividendGranularity {
  return value === "month" || value === "year";
}

function parseYear(value: string | null, fallback: number): number {
  const year = Number(value);
  return Number.isInteger(year) && year >= 2000 && year <= 2100 ? year : fallback;
}

export function parseDividendDashboardQuery(
  queryString: string,
  fallback: Omit<DividendDashboardQuery, "security">,
): DividendDashboardQuery {
  const params = new URLSearchParams(
    queryString.startsWith("?") ? queryString.slice(1) : queryString,
  );
  const granularity = params.get("granularity");
  const view = params.get("view");
  const security = params.get("security")?.trim().toUpperCase();
  return {
    granularity: isGranularity(granularity) ? granularity : fallback.granularity,
    includeForecast: params.get("includeForecast") !== "0",
    security: security || undefined,
    view: isDashboardView(view) ? view : fallback.view,
    year: parseYear(params.get("year"), fallback.year),
  };
}

/** Serializes only dashboard state in a stable order, discarding unrelated query keys. */
export function serializeDividendDashboardQuery(query: DividendDashboardQuery): string {
  const values: Record<(typeof QUERY_ORDER)[number], string | undefined> = {
    granularity: query.granularity,
    includeForecast: query.includeForecast ? "1" : "0",
    security: query.security?.trim().toUpperCase() || undefined,
    view: query.view,
    year: String(query.year),
  };
  const params = new URLSearchParams();
  for (const key of QUERY_ORDER) {
    const value = values[key];
    if (value) params.set(key, value);
  }
  return params.toString();
}

function getDashboardUrl(query: DividendDashboardQuery): string {
  const suffix = serializeDividendDashboardQuery(query);
  return `${window.location.pathname}?${suffix}${query.security ? "#dividend-detail" : ""}`;
}

export function DividendDashboardClient({
  data,
  detail,
  prefetchedDetails,
  staticDemo,
  csvWithForecast,
  csvActualOnly,
  queryString,
  initialIncludeForecast,
  initialView,
  initialGranularity,
}: DividendDashboardClientProps) {
  const fallbackQuery = useMemo(
    () => ({
      includeForecast: initialIncludeForecast,
      view: initialView,
      granularity: initialGranularity,
      year: data.year,
    }),
    [data.year, initialGranularity, initialIncludeForecast, initialView],
  );
  const [query, setQuery] = useState<DividendDashboardQuery>(() => {
    const parsed = parseDividendDashboardQuery(queryString, fallbackQuery);
    return staticDemo ? { ...parsed, year: data.year } : parsed;
  });

  useEffect(() => {
    const syncFromLocation = () => {
      const parsed = parseDividendDashboardQuery(window.location.search, fallbackQuery);
      setQuery(staticDemo ? { ...parsed, year: data.year } : parsed);
    };
    syncFromLocation();
    window.addEventListener("popstate", syncFromLocation);
    return () => window.removeEventListener("popstate", syncFromLocation);
  }, [data.year, fallbackQuery, staticDemo]);

  const detailByCode = useMemo(
    () => ({ ...prefetchedDetails, ...(detail ? { [detail.code]: detail } : {}) }),
    [detail, prefetchedDetails],
  );
  const selectedDetail = query.security
    ? (detailByCode[query.security] ?? getFallbackDetail(data, query.security))
    : null;
  const series = query.granularity === "month" ? data.monthlySeries : data.yearlySeries;
  const breakdown = query.view === "industry" ? data.industries : data.yieldBuckets;
  const availableYears = staticDemo
    ? [data.year]
    : Array.from({ length: 3 }, (_, index) => data.year - index).reverse();

  function updateQuery(next: DividendDashboardQuery, navigate = false) {
    setQuery(next);
    const url = getDashboardUrl(next);
    if (navigate) {
      window.location.assign(url);
      return;
    }
    window.history.pushState({}, "", url);
  }

  function patchQuery(patch: Partial<DividendDashboardQuery>, navigate = false) {
    updateQuery({ ...query, ...patch }, navigate);
  }

  function downloadCsv() {
    const csv = query.includeForecast ? csvWithForecast : csvActualOnly;
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `dividends-${data.year}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label className="flex items-center gap-2 font-medium">
            実績
            <select
              aria-label="対象年"
              value={query.year}
              disabled={staticDemo}
              onChange={(event) => patchQuery({ year: Number(event.target.value) }, !staticDemo)}
              className="rounded-md border bg-background px-2 py-1"
            >
              {availableYears.map((year) => (
                <option key={year} value={year}>
                  {year}年
                </option>
              ))}
            </select>
          </label>
          {data.forecastFiscalYears.length > 0 && (
            <span className="text-muted-foreground">
              ／会社予想 FY{data.forecastFiscalYears.join(", FY")}
            </span>
          )}
          <button
            type="button"
            aria-pressed={query.includeForecast}
            onClick={() => patchQuery({ includeForecast: !query.includeForecast })}
            className={cn(
              "rounded-full border px-3 py-1.5 transition-colors",
              query.includeForecast ? "bg-primary text-primary-foreground" : "hover:bg-muted",
            )}
          >
            予想を含む
          </button>
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <Filter className="h-4 w-4" aria-hidden="true" />
            期間・口座・商品は現在のscopeで集計
          </span>
        </div>
        <button
          type="button"
          onClick={downloadCsv}
          className="inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          CSVダウンロード
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="今年の受取済み"
          value={data.summary.actualReceivedNet}
          suffix="税引後・Money Forward取引"
          actual
        />
        <MetricCard
          title="年間予想配当"
          value={query.includeForecast ? data.summary.forecastAnnualGross : null}
          suffix={
            data.summary.periodBasis === "fiscal_year"
              ? `税引前・会社予想・FY${data.forecastFiscalYears.join(", FY") || "未定"}`
              : "税引前・会社予想"
          }
        />
        <MetricCard
          title="受取進捗"
          value={data.summary.progressPct}
          suffix={data.summary.progressPct === null ? "金額・期間の基準が不一致" : "%"}
          percent
        />
        <MetricCard
          title="データカバレッジ"
          value={data.summary.coveragePct}
          suffix={`${data.summary.coveredHoldingCount}/${data.summary.totalHoldingCount}銘柄`}
          percent
        />
      </div>

      <Card>
        <CardContent className="grid gap-4 pt-4 sm:grid-cols-3">
          <DetailMetric
            label="残り予想額"
            value={formatNullableAmount(
              query.includeForecast ? data.summary.forecastRemainingGross : null,
            )}
          />
          <DetailMetric
            label="支払月不明の予想"
            value={formatNullableAmount(
              query.includeForecast ? data.summary.unknownPaymentMonthGross : null,
            )}
          />
          <DetailMetric label="計算状態" value={calculationLabel(data.summary.calculationStatus)} />
        </CardContent>
      </Card>

      <ReceiptAudit receipts={data.receipts} actualOnly={!query.includeForecast} />

      {selectedDetail && (
        <DividendDetailCard
          detail={selectedDetail}
          showForecast={query.includeForecast}
          onClose={() => patchQuery({ security: undefined })}
        />
      )}

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="配当表示軸">
        {(
          [
            ["security", "銘柄別"],
            ["industry", "業種別"],
            ["yield", "配当利回り別"],
            ["timeline", "時系列"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={query.view === value}
            onClick={() => patchQuery({ view: value })}
            className={cn(
              "rounded-md border px-3 py-2 text-sm",
              query.view === value ? "bg-primary text-primary-foreground" : "hover:bg-muted",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {query.view === "timeline" ? (
        <div className="space-y-3">
          <div className="flex justify-end gap-2">
            {(["month", "year"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={query.granularity === value}
                onClick={() => patchQuery({ granularity: value })}
                className={cn(
                  "rounded-md border px-3 py-1.5 text-sm",
                  query.granularity === value ? "bg-muted font-medium" : "hover:bg-muted",
                )}
              >
                {value === "month" ? "月次" : "年次"}
              </button>
            ))}
          </div>
          <DividendHistoryChart
            title={`${query.granularity === "month" ? "月別" : "年別"}の受取履歴`}
            rows={series}
          />
        </div>
      ) : !query.includeForecast ? (
        <ActualOnlyExplanation view={query.view} />
      ) : query.view === "security" ? (
        <SecurityTable
          rows={data.securities}
          showForecast={query.includeForecast}
          onSelectSecurity={(security) => patchQuery({ security }, !staticDemo)}
        />
      ) : query.includeForecast ? (
        <DividendCompositionChart
          title={
            query.view === "industry" ? "業種別内訳（会社予想）" : "配当利回り別内訳（会社予想）"
          }
          rows={breakdown}
        />
      ) : (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            予想を含めると、業種別・配当利回り別の内訳を表示できます。
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-muted-foreground">
        EDINET DB更新日時: {data.sourceAsOf ?? "未取得"}
        。会社予想は事業年度・税引前、受取実績はMoney Forward取引の税引後基準です。
      </p>
    </div>
  );
}

function MetricCard({
  title,
  value,
  suffix,
  percent = false,
  actual = false,
}: {
  title: string;
  value: number | null;
  suffix: string;
  percent?: boolean;
  actual?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle icon={TrendingUp} className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {value === null ? (
          <p className="text-lg font-semibold">算出不可</p>
        ) : percent ? (
          <p className="text-2xl font-bold tabular-nums">{formatPercent(value)}</p>
        ) : actual ? (
          <AmountDisplay amount={value} type="income" size="lg" weight="bold" />
        ) : (
          <p className="text-lg font-bold tabular-nums">{formatCurrency(value)}</p>
        )}
        <p className="mt-1 text-xs text-muted-foreground">{suffix}</p>
      </CardContent>
    </Card>
  );
}

function ReceiptAudit({
  receipts,
  actualOnly,
}: {
  receipts: DividendDashboardData["receipts"];
  actualOnly: boolean;
}) {
  const visible = receipts.filter((receipt) => receipt.status !== "not_dividend");
  return (
    <Card>
      <CardHeader>
        <CardTitle icon={TrendingUp}>受取実績{actualOnly ? "（予想を除外中）" : ""}</CardTitle>
      </CardHeader>
      <CardContent>
        {visible.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            配当・分配として判定できる受取実績はありません。未分類または金額・日付が不足した取引は実績合計を算出不可にします。
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="px-2 py-2">受取日</th>
                  <th className="px-2 py-2 text-right">税引後額</th>
                  <th className="px-2 py-2">amount basis</th>
                  <th className="px-2 py-2">銘柄紐付け</th>
                  <th className="px-2 py-2">判定</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((receipt) => (
                  <tr key={receipt.transactionId} className="border-b last:border-0">
                    <td className="px-2 py-2">
                      {receipt.date ? formatDate(receipt.date) : "受取日未取得"}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {receipt.netAmount === null ? (
                        "算出不可"
                      ) : (
                        <AmountDisplay amount={receipt.netAmount} type="income" weight="semibold" />
                      )}
                    </td>
                    <td className="px-2 py-2">
                      {receipt.amountBasis === "net" ? "税引後（net）" : "金額基準未確認"}
                    </td>
                    <td className="px-2 py-2">{receiptSecurityLabel(receipt.securityStatus)}</td>
                    <td className="px-2 py-2">{receiptStatusLabel(receipt.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SecurityTable({
  rows,
  showForecast,
  onSelectSecurity,
}: {
  rows: DividendDashboardData["securities"];
  showForecast: boolean;
  onSelectSecurity: (code: string) => void;
}) {
  if (rows.length === 0)
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          保有株式がありません。市場データが未同期の場合は、銘柄を取得後に予想を計算します。
        </CardContent>
      </Card>
    );
  return (
    <Card>
      <CardHeader>
        <CardTitle icon={TrendingUp}>銘柄別配当一覧</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="hidden overflow-x-auto sm:block">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="px-2 py-2 font-medium">銘柄</th>
                <th className="px-2 py-2 text-right font-medium">年間予想</th>
                <th className="px-2 py-2 text-right font-medium">予想利回り</th>
                <th className="px-2 py-2 text-right font-medium">YOC</th>
                <th className="px-2 py-2 text-right font-medium">評価額</th>
                <th className="px-2 py-2 font-medium">状態</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.code} className="border-b last:border-0">
                  <td className="px-2 py-3">
                    <button
                      type="button"
                      onClick={() => onSelectSecurity(row.code)}
                      className="font-medium text-primary hover:underline"
                      aria-label={`${row.name}の配当詳細を開く`}
                    >
                      {row.name}
                    </button>
                    <div className="text-xs text-muted-foreground">
                      {row.code} · {row.industryName ?? "業種未取得"}
                    </div>
                  </td>
                  <td className="px-2 py-3 text-right tabular-nums">
                    {showForecast ? formatNullableAmount(row.forecastAnnualGross) : "—"}
                  </td>
                  <td className="px-2 py-3 text-right tabular-nums">
                    {showForecast ? formatNullablePercent(row.forecastYieldPct) : "—"}
                  </td>
                  <td className="px-2 py-3 text-right tabular-nums">
                    {showForecast ? formatNullablePercent(row.yieldOnCostPct) : "—"}
                  </td>
                  <td className="px-2 py-3 text-right tabular-nums">
                    {formatCurrency(row.marketValue)}
                  </td>
                  <td className="px-2 py-3 text-xs">{securityStatusLabel(row)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="space-y-2 sm:hidden">
          {rows.map((row) => (
            <button
              key={row.code}
              type="button"
              onClick={() => onSelectSecurity(row.code)}
              className="block w-full rounded-lg border p-3 text-left hover:bg-muted/50"
              aria-label={`${row.name}の配当詳細を開く`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-medium text-primary">{row.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {row.code} · {row.industryName ?? "業種未取得"}
                  </div>
                </div>
                <div className="shrink-0 text-right text-xs">
                  <div>
                    {showForecast ? formatNullableAmount(row.forecastAnnualGross) : "予想非表示"}
                  </div>
                  <div className="text-muted-foreground">{securityStatusLabel(row)}</div>
                </div>
              </div>
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function ActualOnlyExplanation({ view }: { view: Exclude<DashboardView, "timeline"> }) {
  const label = view === "security" ? "銘柄別" : view === "industry" ? "業種別" : "配当利回り別";
  return (
    <Card>
      <CardContent className="py-8 text-center text-sm text-muted-foreground">
        予想を除外中のため、{label}
        の予想一覧は表示しません。受取実績または時系列表示を確認してください。
      </CardContent>
    </Card>
  );
}

function DividendDetailCard({
  detail,
  showForecast,
  onClose,
}: {
  detail: DividendSecurityDetail;
  showForecast: boolean;
  onClose: () => void;
}) {
  return (
    <section id="dividend-detail" tabIndex={-1} className="rounded-lg border bg-card">
      <CardHeader className="flex-row items-center justify-between gap-3">
        <CardTitle icon={ExternalLink}>{detail.name}の配当詳細</CardTitle>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border p-1.5 hover:bg-muted"
          aria-label="配当詳細を閉じる"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 text-sm sm:grid-cols-4">
          <DetailMetric
            label="年間予想"
            value={showForecast ? formatNullableAmount(detail.forecastAnnualGross) : "予想非表示"}
          />
          <DetailMetric
            label="予想利回り"
            value={showForecast ? formatNullablePercent(detail.forecastYieldPct) : "予想非表示"}
          />
          <DetailMetric
            label="Yield on Cost"
            value={showForecast ? formatNullablePercent(detail.yieldOnCostPct) : "予想非表示"}
          />
          <DetailMetric label="支払予定" value={showForecast ? "予定月未定" : "予想非表示"} />
        </div>
        {showForecast ? (
          detail.history.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[540px] text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="px-2 py-2">年度</th>
                    <th className="px-2 py-2">区分</th>
                    <th className="px-2 py-2 text-right">DPS</th>
                    <th className="px-2 py-2">開示日</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.history.map((event) => (
                    <tr
                      key={`${event.fiscalYear}-${event.period}`}
                      className="border-b last:border-0"
                    >
                      <td className="px-2 py-2">FY{event.fiscalYear}</td>
                      <td className="px-2 py-2">
                        {event.period ?? "不明"}・{event.status === "actual" ? "実績" : "予想"}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {event.dps === null ? "算出不可" : formatCurrency(event.dps)}
                      </td>
                      <td className="px-2 py-2">{event.announcedAt ?? "未取得"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              この銘柄の配当履歴はまだ取得されていません。
            </p>
          )
        ) : (
          <p className="text-sm text-muted-foreground">予想を含めると配当履歴を表示できます。</p>
        )}
      </CardContent>
    </section>
  );
}

function getFallbackDetail(
  data: DividendDashboardData,
  code: string,
): DividendSecurityDetail | null {
  const row = data.securities.find((security) => security.code === code);
  return row ? { ...row, history: [] } : null;
}
function DetailMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-muted-foreground">{label}</p>
      <p className="mt-1 font-semibold">{value}</p>
    </div>
  );
}
function formatNullableAmount(value: number | null): string {
  return value === null ? "算出不可" : formatCurrency(value);
}
function formatNullablePercent(value: number | null): string {
  return value === null ? "算出不可" : formatPercent(value);
}
function receiptStatusLabel(status: DividendDashboardData["receipts"][number]["status"]): string {
  return status === "matched"
    ? "配当・分配として一致"
    : status === "ambiguous"
      ? "配当候補（要確認）"
      : "取引情報不足";
}
function receiptSecurityLabel(
  status: DividendDashboardData["receipts"][number]["securityStatus"],
): string {
  return status === "security_unresolved"
    ? "security_unresolved（銘柄未紐付け）"
    : status === "unavailable"
      ? "銘柄状態を判定不可"
      : "紐付け対象外";
}
function securityStatusLabel(row: DividendDashboardData["securities"][number]): string {
  const labels = [
    dataStatusLabel(row.dataStatus),
    row.mappingStatus === "unresolved"
      ? "銘柄対応未解決"
      : row.mappingStatus === "ambiguous_match"
        ? "銘柄対応が曖昧"
        : row.mappingStatus === "unsupported"
          ? "銘柄対応は未対応"
          : row.mappingStatus === "unavailable"
            ? "銘柄対応未取得"
            : null,
    syncStatusLabel("対応表", row.mappingSyncStatus.status),
    syncStatusLabel("予想", row.forecastSyncStatus.status),
  ].filter(Boolean);
  return [...new Set(labels)].join("・");
}
function dataStatusLabel(
  status: DividendDashboardData["securities"][number]["dataStatus"],
): string {
  if (status === "covered") return "算出済み";
  if (status === "stale") return "市場データ期限切れ";
  if (status === "calculation_unavailable") return "計算条件不足で算出不可";
  return "市場データ未取得";
}
function syncStatusLabel(
  label: string,
  status: DividendDashboardData["securities"][number]["mappingSyncStatus"]["status"],
): string | null {
  if (status === "error") return `${label}の同期エラー`;
  if (status === "never_synced") return `${label}が未同期`;
  if (status === "stale") return `${label}が期限切れ`;
  if (status === "unsupported") return `${label}は未対応`;
  return null;
}
function calculationLabel(status: DividendDashboardData["summary"]["calculationStatus"]): string {
  switch (status) {
    case "ok":
      return "算出済み";
    case "forecast_fiscal_year_only":
      return "会社予想は事業年度基準";
    case "forecast_unavailable":
      return "予想データ未取得";
    default:
      return "配当データ未取得";
  }
}
