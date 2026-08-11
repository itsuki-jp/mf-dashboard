import { getDividendDashboardData } from "@mf-dashboard/db/queries/dividend";
import { Coins } from "lucide-react";
import { formatCurrency, formatPercent } from "../../lib/format";
import { AmountDisplay } from "../ui/amount-display";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";

export async function DividendSummaryCard({ groupId }: { groupId?: string }) {
  const data = await getDividendDashboardData(groupId);
  const href = groupId ? `/${encodeURIComponent(groupId)}/dividends` : "/dividends";
  const hasUnknownReceipts = data.summary.actualReceiptUnknownCount > 0;
  const displayedActual =
    data.summary.actualReceivedNet ??
    (hasUnknownReceipts &&
    data.summary.actualReceivedConfirmedNet !== null &&
    data.summary.actualReceivedConfirmedNet > 0
      ? data.summary.actualReceivedConfirmedNet
      : null);

  return (
    <Card href={href}>
      <CardHeader>
        <CardTitle icon={Coins}>配当・分配</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <p className="text-sm text-muted-foreground">
              {hasUnknownReceipts ? "今年の受取済み（確認済み）" : "今年の受取済み"}
            </p>
            <p className="mt-1">
              {displayedActual === null ? (
                <span className="font-semibold">算出不可</span>
              ) : (
                <AmountDisplay amount={displayedActual} type="income" size="sm" weight="bold" />
              )}
            </p>
            {hasUnknownReceipts && (
              <p className="mt-1 text-xs text-muted-foreground">
                未判定{data.summary.actualReceiptUnknownCount}件
              </p>
            )}
          </div>
          <div>
            <p className="text-sm text-muted-foreground">年間予想配当（会社予想・税引前）</p>
            <p className="mt-1 font-semibold tabular-nums">
              {data.summary.forecastAnnualGross === null
                ? "算出不可"
                : formatCurrency(data.summary.forecastAnnualGross)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {data.summary.periodBasis === "fiscal_year"
                ? `FY${data.forecastFiscalYears.join(", FY") || "未定"}`
                : "年度基準未取得"}
              ・{summaryCalculationLabel(data.summary.calculationStatus)}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">データカバレッジ</p>
            <p className="mt-1 font-semibold tabular-nums">
              {data.summary.coveragePct === null
                ? "算出不可"
                : formatPercent(data.summary.coveragePct)}
            </p>
          </div>
        </div>
        <div className="grid gap-3 border-t pt-3 sm:grid-cols-3">
          <div>
            <p className="text-sm text-muted-foreground">受取進捗</p>
            <p className="mt-1 font-semibold tabular-nums">
              {data.summary.progressPct === null
                ? "算出不可"
                : formatPercent(data.summary.progressPct)}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">残り予想額</p>
            <p className="mt-1 font-semibold tabular-nums">
              {data.summary.forecastRemainingGross === null
                ? "算出不可"
                : formatCurrency(data.summary.forecastRemainingGross)}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">次回の配当予想</p>
            <p className="mt-1 font-semibold">予定月未定</p>
          </div>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">配当・分配を詳しく見る</span>
          <span className="font-medium text-primary">銘柄別・業種別・時系列 →</span>
        </div>
      </CardContent>
    </Card>
  );
}

function summaryCalculationLabel(
  status: Awaited<ReturnType<typeof getDividendDashboardData>>["summary"]["calculationStatus"],
): string {
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
