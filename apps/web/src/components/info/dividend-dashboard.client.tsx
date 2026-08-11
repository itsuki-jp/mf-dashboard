"use client";

import type {
  DividendDashboardData,
  DividendSecurityDetail,
  DividendView,
  DividendGranularity,
} from "@mf-dashboard/db/queries/dividend";
import { Download, ExternalLink, Filter, TrendingUp } from "lucide-react";
import { useState } from "react";
import { formatCurrency, formatPercent } from "../../lib/format";
import { cn } from "../../lib/utils";
import { DividendCompositionChart } from "../charts/dividend-composition-chart";
import { DividendHistoryChart } from "../charts/dividend-history-chart";
import { AmountDisplay } from "../ui/amount-display";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";

interface DividendDashboardClientProps {
  data: DividendDashboardData;
  detail: DividendSecurityDetail | null;
  csv: string;
  initialIncludeForecast: boolean;
  initialView: DividendView;
  initialGranularity: DividendGranularity;
}

export function DividendDashboardClient({
  data,
  detail,
  csv,
  initialIncludeForecast,
  initialView,
  initialGranularity,
}: DividendDashboardClientProps) {
  const [includeForecast, setIncludeForecast] = useState(initialIncludeForecast);
  const [view, setView] = useState<DividendView | "industry" | "yield">(initialView);
  const [granularity, setGranularity] = useState<DividendGranularity>(initialGranularity);
  const series = granularity === "month" ? data.monthlySeries : data.yearlySeries;
  const breakdown = view === "industry" ? data.industries : data.yieldBuckets;
  const visibleSecurities = data.securities;

  function downloadCsv() {
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
          <span className="font-medium">{data.year}年</span>
          <button
            type="button"
            aria-pressed={includeForecast}
            onClick={() => setIncludeForecast((value) => !value)}
            className={cn(
              "rounded-full border px-3 py-1.5 transition-colors",
              includeForecast ? "bg-primary text-primary-foreground" : "hover:bg-muted",
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
        />
        <MetricCard
          title="年間予想配当"
          value={includeForecast ? data.summary.forecastAnnualGross : null}
          suffix={
            data.summary.periodBasis === "fiscal_year"
              ? `会社予想・FY${data.securities.find((row) => row.forecastFiscalYear)?.forecastFiscalYear ?? "未定"}`
              : "税引前"
          }
        />
        <MetricCard
          title="受取進捗"
          value={data.summary.progressPct}
          suffix={data.summary.progressPct === null ? "金額基準または期間基準が不一致" : "%"}
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
          <div>
            <p className="text-sm text-muted-foreground">残り予想額</p>
            <p className="mt-1 font-semibold">
              {formatNullableAmount(data.summary.forecastRemainingGross)}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">支払月不明の予想</p>
            <p className="mt-1 font-semibold">
              {formatNullableAmount(data.summary.unknownPaymentMonthGross)}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">計算状態</p>
            <p className="mt-1 font-semibold">{calculationLabel(data.summary.calculationStatus)}</p>
          </div>
        </CardContent>
      </Card>

      {detail && <DividendDetailCard detail={detail} />}

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
            aria-selected={view === value}
            onClick={() => setView(value)}
            className={cn(
              "rounded-md border px-3 py-2 text-sm",
              view === value ? "bg-primary text-primary-foreground" : "hover:bg-muted",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {view === "timeline" ? (
        <div className="space-y-3">
          <div className="flex justify-end gap-2">
            {(["month", "year"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={granularity === value}
                onClick={() => setGranularity(value)}
                className={cn(
                  "rounded-md border px-3 py-1.5 text-sm",
                  granularity === value ? "bg-muted font-medium" : "hover:bg-muted",
                )}
              >
                {value === "month" ? "月次" : "年次"}
              </button>
            ))}
          </div>
          <DividendHistoryChart
            title={`${granularity === "month" ? "月別" : "年別"}の受取履歴`}
            rows={series}
          />
        </div>
      ) : view === "security" ? (
        <SecurityTable rows={visibleSecurities} showForecast={includeForecast} year={data.year} />
      ) : (
        <DividendCompositionChart
          title={view === "industry" ? "業種別内訳" : "配当利回り別内訳"}
          rows={breakdown}
        />
      )}

      <p className="text-xs text-muted-foreground">
        EDINET DB更新日時: {data.sourceAsOf ?? "未取得"}。会社予想は事業年度基準、受取実績はMoney
        Forwardの税引後取引基準です。
      </p>
    </div>
  );
}

function MetricCard({
  title,
  value,
  suffix,
  percent = false,
}: {
  title: string;
  value: number | null;
  suffix: string;
  percent?: boolean;
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
        ) : (
          <AmountDisplay amount={value} type="income" size="lg" weight="bold" />
        )}
        <p className="mt-1 text-xs text-muted-foreground">{suffix}</p>
      </CardContent>
    </Card>
  );
}

function SecurityTable({
  rows,
  showForecast,
  year,
}: {
  rows: DividendDashboardData["securities"];
  showForecast: boolean;
  year: number;
}) {
  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          配当データがありません
        </CardContent>
      </Card>
    );
  }
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
                    <a
                      href={`?year=${year}&security=${encodeURIComponent(row.code)}#dividend-detail`}
                      className="font-medium text-primary hover:underline"
                      aria-label={`${row.name}の配当詳細を開く`}
                    >
                      {row.name}
                    </a>
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
                  <td className="px-2 py-3">{dataStatusLabel(row.dataStatus)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="space-y-2 sm:hidden">
          {rows.map((row) => (
            <a
              key={row.code}
              href={`?year=${year}&security=${encodeURIComponent(row.code)}#dividend-detail`}
              className="block rounded-lg border p-3 hover:bg-muted/50"
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
                  <div className="text-muted-foreground">{dataStatusLabel(row.dataStatus)}</div>
                </div>
              </div>
            </a>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function DividendDetailCard({ detail }: { detail: DividendSecurityDetail }) {
  return (
    <Card id="dividend-detail">
      <CardHeader>
        <CardTitle icon={ExternalLink}>{detail.name}の配当詳細</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 text-sm sm:grid-cols-4">
          <DetailMetric label="年間予想" value={formatNullableAmount(detail.forecastAnnualGross)} />
          <DetailMetric label="予想利回り" value={formatNullablePercent(detail.forecastYieldPct)} />
          <DetailMetric
            label="Yield on Cost"
            value={formatNullablePercent(detail.yieldOnCostPct)}
          />
          <DetailMetric label="支払予定" value="予定月未定" />
        </div>
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
                <tr key={`${event.fiscalYear}-${event.period}`} className="border-b last:border-0">
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
      </CardContent>
    </Card>
  );
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

function dataStatusLabel(
  status: DividendDashboardData["securities"][number]["dataStatus"],
): string {
  if (status === "covered") return "算出済み";
  if (status === "calculation_unavailable") return "数量・価格未取得";
  return "市場データ未取得";
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
