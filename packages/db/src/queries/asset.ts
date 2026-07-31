import {
  addDaysToIsoDateKey,
  formatIsoDateKey,
  getEndOfPreviousMonthIsoDateKey,
  parseIsoDateKey,
} from "@mf-dashboard/date-utils";
import { inArray } from "drizzle-orm";
import { getDb, type Db, schema } from "../index";
import { resolveGroupIds } from "../shared/group-filter";
import { getHoldingsWithLatestValues } from "./holding";

/**
 * 日付文字列をパース
 */
export function parseDateString(dateStr: string): { year: number; month: number; day: number } {
  return parseIsoDateKey(dateStr);
}

/**
 * 日付文字列を生成
 */
export function toDateString(year: number, month: number, day: number): string {
  return formatIsoDateKey({ year, month, day });
}

interface AggregatedAssetHistoryEntry {
  date: string;
  totalAssets: number;
  categories: Record<string, number>;
}

/**
 * profileごとの履歴を日付単位で合算する。
 * 更新日がずれる場合は、各profileでその日以前の直近値を使用する。
 */
async function getAggregatedAssetHistory(
  scopeId: string | undefined,
  db: Db,
): Promise<AggregatedAssetHistoryEntry[]> {
  const groupIds = await resolveGroupIds(db, scopeId);
  if (groupIds.length === 0) return [];

  const historyRows = await db
    .select({
      id: schema.assetHistory.id,
      groupId: schema.assetHistory.groupId,
      date: schema.assetHistory.date,
      totalAssets: schema.assetHistory.totalAssets,
    })
    .from(schema.assetHistory)
    .where(inArray(schema.assetHistory.groupId, groupIds))
    .orderBy(schema.assetHistory.date)
    .all();
  if (historyRows.length === 0) return [];

  const categoryRows = await db
    .select({
      assetHistoryId: schema.assetHistoryCategories.assetHistoryId,
      categoryName: schema.assetHistoryCategories.categoryName,
      amount: schema.assetHistoryCategories.amount,
    })
    .from(schema.assetHistoryCategories)
    .where(
      inArray(
        schema.assetHistoryCategories.assetHistoryId,
        historyRows.map((row) => row.id),
      ),
    )
    .all();
  const categoriesByHistoryId = new Map<number, Record<string, number>>();
  for (const category of categoryRows) {
    const categories = categoriesByHistoryId.get(category.assetHistoryId) ?? {};
    categories[category.categoryName] = category.amount;
    categoriesByHistoryId.set(category.assetHistoryId, categories);
  }

  const rowsByGroup = new Map<string, typeof historyRows>();
  for (const groupId of groupIds) rowsByGroup.set(groupId, []);
  for (const row of historyRows) rowsByGroup.get(row.groupId)?.push(row);

  const dates = [...new Set(historyRows.map((row) => row.date))].sort();
  const latestByGroup = new Map<string, (typeof historyRows)[number]>();
  const offsets = new Map(groupIds.map((groupId) => [groupId, 0]));
  const aggregated: AggregatedAssetHistoryEntry[] = [];

  for (const date of dates) {
    for (const groupId of groupIds) {
      const rows = rowsByGroup.get(groupId) ?? [];
      let offset = offsets.get(groupId) ?? 0;
      while (offset < rows.length && rows[offset].date <= date) {
        latestByGroup.set(groupId, rows[offset]);
        offset += 1;
      }
      offsets.set(groupId, offset);
    }

    let totalAssets = 0;
    const categories: Record<string, number> = {};
    for (const row of latestByGroup.values()) {
      totalAssets += row.totalAssets;
      for (const [name, amount] of Object.entries(categoriesByHistoryId.get(row.id) ?? {})) {
        categories[name] = (categories[name] ?? 0) + amount;
      }
    }
    aggregated.push({ date, totalAssets, categories });
  }

  return aggregated.reverse();
}

/**
 * 比較対象の日付を計算
 */
export function calculateTargetDate(
  latestDate: string,
  period: "daily" | "weekly" | "monthly",
): string {
  if (period === "monthly") {
    return getEndOfPreviousMonthIsoDateKey(latestDate);
  }

  const daysAgo = period === "daily" ? 1 : 8;
  return addDaysToIsoDateKey(latestDate, -daysAgo);
}

/**
 * カテゴリ別資産内訳を取得
 * assetHistoryCategoriesから最新の値を取得
 */
export async function getAssetBreakdownByCategory(groupIdParam?: string, db: Db = getDb()) {
  const latest = (await getAggregatedAssetHistory(groupIdParam, db))[0];
  if (!latest) return [];
  return Object.entries(latest.categories)
    .filter(([, amount]) => amount > 0)
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);
}

/**
 * 負債を種類別に集計
 */
export function aggregateLiabilitiesByCategory(
  holdings: Array<{
    type: string;
    liabilityCategory: string | null;
    amount: number | null;
  }>,
) {
  const breakdown: Record<string, number> = {};

  for (const holding of holdings) {
    if (holding.type === "liability" && holding.amount) {
      const category = holding.liabilityCategory || "その他";
      breakdown[category] = (breakdown[category] || 0) + holding.amount;
    }
  }

  return Object.entries(breakdown)
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);
}

/**
 * カテゴリ別負債内訳を取得
 */
export async function getLiabilityBreakdownByCategory(groupIdParam?: string, db: Db = getDb()) {
  const holdings = await getHoldingsWithLatestValues(groupIdParam, db);
  return aggregateLiabilitiesByCategory(holdings);
}

/**
 * 資産履歴を取得
 */
export async function getAssetHistory(
  options?: { limit?: number; groupId?: string },
  db: Db = getDb(),
) {
  const history = await getAggregatedAssetHistory(options?.groupId, db);
  const result = history.map(({ date, totalAssets }, index) => ({
    date,
    totalAssets,
    change: totalAssets - (history[index + 1]?.totalAssets ?? totalAssets),
  }));
  return options?.limit ? result.slice(0, options.limit) : result;
}

/**
 * カテゴリ情報付き資産履歴を取得
 */
export async function getAssetHistoryWithCategories(
  options?: { limit?: number; groupId?: string },
  db: Db = getDb(),
) {
  const history = await getAggregatedAssetHistory(options?.groupId, db);
  return options?.limit ? history.slice(0, options.limit) : history;
}

/**
 * 最新の総資産を取得
 */
export async function getLatestTotalAssets(
  groupIdParam?: string,
  db: Db = getDb(),
): Promise<number | null> {
  const latest = (await getAggregatedAssetHistory(groupIdParam, db))[0];
  return latest?.totalAssets ?? null;
}

/**
 * 日次資産変動を取得（今日vs昨日）
 */
export async function getDailyAssetChange(groupIdParam?: string, db: Db = getDb()) {
  const latest = (await getAggregatedAssetHistory(groupIdParam, db)).slice(0, 2);

  if (latest.length < 2) {
    return null;
  }

  return {
    today: latest[0].totalAssets,
    yesterday: latest[1].totalAssets,
    change: latest[0].totalAssets - latest[1].totalAssets,
  };
}

/**
 * カテゴリ変動を計算
 */
export function calculateCategoryChanges(
  latestCategories: Array<{ categoryName: string; amount: number }>,
  previousCategories: Array<{ categoryName: string; amount: number }>,
) {
  const latestMap = new Map(latestCategories.map((c) => [c.categoryName, c.amount]));
  const previousMap = new Map(previousCategories.map((c) => [c.categoryName, c.amount]));

  const allCategoryNames = new Set([...latestMap.keys(), ...previousMap.keys()]);

  return [...allCategoryNames]
    .map((name) => ({
      name,
      current: latestMap.get(name) ?? 0,
      previous: previousMap.get(name) ?? 0,
      change: (latestMap.get(name) ?? 0) - (previousMap.get(name) ?? 0),
    }))
    .filter((cat) => cat.current > 0 || cat.previous > 0);
}

/**
 * 期間別カテゴリ変動を取得
 */
export async function getCategoryChangesForPeriod(
  period: "daily" | "weekly" | "monthly",
  groupIdParam?: string,
  db: Db = getDb(),
) {
  const history = await getAggregatedAssetHistory(groupIdParam, db);
  const latest = history[0];

  if (!latest) {
    return null;
  }

  const targetDateStr = calculateTargetDate(latest.date, period);

  const previous = history.find((entry) => entry.date <= targetDateStr);

  if (!previous || previous.date === latest.date) {
    return null;
  }

  const latestCategories = Object.entries(latest.categories).map(([categoryName, amount]) => ({
    categoryName,
    amount,
  }));
  const previousCategories = Object.entries(previous.categories).map(([categoryName, amount]) => ({
    categoryName,
    amount,
  }));

  const categoryChanges = calculateCategoryChanges(latestCategories, previousCategories);

  return {
    categories: categoryChanges,
    total: {
      current: latest.totalAssets,
      previous: previous.totalAssets,
      change: latest.totalAssets - previous.totalAssets,
    },
  };
}
