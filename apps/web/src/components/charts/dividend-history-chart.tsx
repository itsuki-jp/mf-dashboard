import type { DividendSeriesRow } from "@mf-dashboard/db/queries/dividend";
import { BarChart3 } from "lucide-react";
import { formatCurrency } from "../../lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";

interface DividendHistoryChartProps {
  title: string;
  rows: DividendSeriesRow[];
}

export function DividendHistoryChart({ title, rows }: DividendHistoryChartProps) {
  const max = Math.max(...rows.flatMap((row) => [row.actual, row.forecast]), 1);
  return (
    <Card>
      <CardHeader>
        <CardTitle icon={BarChart3}>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3" aria-label={title}>
          {rows.map((row) => (
            <div
              key={row.key}
              className="grid grid-cols-[4rem_1fr_5rem] items-center gap-3 text-sm"
            >
              <span className="text-muted-foreground">{row.label}</span>
              <div className="space-y-1">
                <div className="h-2 rounded-full bg-muted" aria-hidden="true">
                  <div
                    className="h-full rounded-full bg-income"
                    style={{ width: `${(row.actual / max) * 100}%` }}
                  />
                </div>
                <div className="h-2 rounded-full bg-muted" aria-hidden="true">
                  <div
                    className="h-full rounded-full bg-primary/60"
                    style={{ width: `${(row.forecast / max) * 100}%` }}
                  />
                </div>
              </div>
              <span className="text-right tabular-nums">
                <span className="sr-only">実績 </span>
                {formatCurrency(row.actual)}
                <span className="sr-only">、予想 {formatCurrency(row.forecast)}</span>
              </span>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          実績（税引後）／予想（税引前・事業年度基準）
        </p>
      </CardContent>
    </Card>
  );
}
