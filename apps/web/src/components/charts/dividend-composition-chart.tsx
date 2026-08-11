import type { DividendBreakdownRow } from "@mf-dashboard/db/queries/dividend";
import { PieChart } from "lucide-react";
import { formatCurrency, formatPercent } from "../../lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";

interface DividendCompositionChartProps {
  title: string;
  rows: DividendBreakdownRow[];
}

export function DividendCompositionChart({ title, rows }: DividendCompositionChartProps) {
  const visibleRows = rows.filter((row) => row.amount > 0);
  const total = visibleRows.reduce((sum, row) => sum + row.amount, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle icon={PieChart}>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {visibleRows.length === 0 ? (
          <p className="py-6 text-sm text-muted-foreground">算出可能な配当データがありません</p>
        ) : (
          <div className="space-y-3">
            {visibleRows.map((row) => (
              <div key={row.label} className="space-y-1">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate">{row.label}</span>
                  <span className="shrink-0 tabular-nums">
                    {formatCurrency(row.amount)} · {formatPercent(row.ratioPct)}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${total > 0 ? (row.amount / total) * 100 : 0}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
