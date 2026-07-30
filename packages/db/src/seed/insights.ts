import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { scopeGroupId } from "../profile-scope";
import * as schema from "../schema/schema";
import { dateStr, type Now, type SeedDb } from "./shared";

interface SeedInsightsInput {
  db: SeedDb;
  now: Now;
  yearEnd: number;
  monthEnd: number;
  fixedDay: number;
  profileId: string;
}

export async function seedInsights({
  db,
  now,
  yearEnd,
  monthEnd,
  fixedDay,
  profileId,
}: SeedInsightsInput): Promise<number> {
  const insightsPath = join(import.meta.dirname, "..", "fixtures", "demo-insights.json");
  if (!existsSync(insightsPath)) return 0;

  const insights: Record<string, Record<string, string | null>> = JSON.parse(
    readFileSync(insightsPath, "utf-8"),
  );
  for (const [groupId, data] of Object.entries(insights)) {
    await db
      .insert(schema.analyticsReports)
      .values({
        groupId: scopeGroupId(profileId, groupId),
        date: dateStr(yearEnd, monthEnd, fixedDay),
        summary: data.summary,
        savingsInsight: data.savingsInsight,
        investmentInsight: data.investmentInsight,
        spendingInsight: data.spendingInsight,
        balanceInsight: data.balanceInsight,
        liabilityInsight: data.liabilityInsight,
        model: "demo",
        createdAt: now(),
        updatedAt: now(),
      })
      .run();
  }

  return Object.keys(insights).length;
}
