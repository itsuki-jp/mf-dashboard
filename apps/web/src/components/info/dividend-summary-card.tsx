import { getDividendDashboardData } from "@mf-dashboard/db/queries/dividend";
import { Coins } from "lucide-react";
import { formatCurrency, formatPercent } from "../../lib/format";
import { AmountDisplay } from "../ui/amount-display";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";

export async function DividendSummaryCard({ groupId }: { groupId?: string }) {
  const data = await getDividendDashboardData(groupId);
  const href = groupId ? `/${encodeURIComponent(groupId)}/dividends` : "/dividends";

  return (
    <Card href={href}>
      <CardHeader>
        <CardTitle icon={Coins}>配当・分配</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <p className="text-sm text-muted-foreground">今年の受取済み</p>
            <p className="mt-1">
              {data.summary.actualReceivedNet === null ? (
                <span className="font-semibold">算出不可</span>
              ) : (
                <AmountDisplay
                  amount={data.summary.actualReceivedNet}
                  type="income"
                  size="sm"
                  weight="bold"
                />
              )}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground">年間予想配当</p>
            <p className="mt-1 font-semibold tabular-nums">
              {data.summary.forecastAnnualGross === null
                ? "算出不可"
                : formatCurrency(data.summary.forecastAnnualGross)}
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
