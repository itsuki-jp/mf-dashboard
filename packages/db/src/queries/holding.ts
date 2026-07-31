import { desc, eq, and, isNotNull, inArray } from "drizzle-orm";
import { getDb, type Db, schema } from "../index";
import {
  getAccountIdsForGroup,
  getAccountIdsForGroups,
  resolveGroupIds,
} from "../shared/group-filter";

const INVESTMENT_CATEGORIES = ["株式(現物)", "投資信託"];
const GLOBAL_MF_GROUP_ID = "0";
const FALLBACK_ACCOUNT_MF_ID = "unknown";

export interface DashboardHolding {
  id: number;
  name: string;
  type: string;
  liabilityCategory: string | null;
  categoryId?: number | null;
  categoryName: string | null;
  accountId?: number | null;
  accountName: string | null;
  institution: string | null;
  profileId?: string | null;
  profileName?: string | null;
  amount: number;
  quantity: number | null;
  unitPrice: number | null;
  avgCostPrice: number | null;
  dailyChange: number | null;
  unrealizedGain: number | null;
  unrealizedGainPct: number | null;
}

async function getGroupContext(db: Db, groupId: string) {
  return db
    .select({
      profileId: schema.groups.profileId,
      profileName: schema.moneyForwardProfiles.name,
      mfGroupId: schema.groups.mfGroupId,
    })
    .from(schema.groups)
    .innerJoin(
      schema.moneyForwardProfiles,
      eq(schema.moneyForwardProfiles.id, schema.groups.profileId),
    )
    .where(eq(schema.groups.id, groupId))
    .get();
}

async function getGroupContexts(db: Db, scopeId?: string) {
  const groupIds = await resolveGroupIds(db, scopeId);
  const contexts = await Promise.all(
    groupIds.map(async (groupId) => {
      const context = await getGroupContext(db, groupId);
      return context ? { ...context, groupId } : null;
    }),
  );
  return contexts.filter((context): context is NonNullable<typeof context> => context !== null);
}

async function getHoldingAccountIdsForGroup(
  db: Db,
  groupId: string,
  profileId: string,
  mfGroupId: string,
): Promise<number[]> {
  const accountIds = await getAccountIdsForGroup(db, groupId);
  if (mfGroupId !== GLOBAL_MF_GROUP_ID) return accountIds;

  const fallbackAccount = await db
    .select({ id: schema.accounts.id })
    .from(schema.accounts)
    .where(
      and(
        eq(schema.accounts.profileId, profileId),
        eq(schema.accounts.mfId, FALLBACK_ACCOUNT_MF_ID),
      ),
    )
    .get();

  if (!fallbackAccount || accountIds.includes(fallbackAccount.id)) return accountIds;
  return [...accountIds, fallbackAccount.id];
}

/**
 * 最新のスナップショットを取得
 * スナップショットは全アカウント共通で1つ作成される
 */
export async function getLatestSnapshot(db: Db = getDb(), profileId?: string) {
  const globalGroup = profileId
    ? await db
        .select({ id: schema.groups.id })
        .from(schema.groups)
        .where(
          and(
            eq(schema.groups.profileId, profileId),
            eq(schema.groups.mfGroupId, GLOBAL_MF_GROUP_ID),
          ),
        )
        .get()
    : undefined;
  if (profileId && !globalGroup) return undefined;

  return await db
    .select()
    .from(schema.dailySnapshots)
    .where(globalGroup ? eq(schema.dailySnapshots.groupId, globalGroup.id) : undefined)
    .orderBy(desc(schema.dailySnapshots.id))
    .limit(1)
    .get();
}

/**
 * 保有資産を取得する共通のwhere条件を構築
 */
export function buildHoldingWhereCondition(
  snapshotId: number,
  accountIds: number[],
  additionalCondition?: ReturnType<typeof eq>,
) {
  return and(
    eq(schema.holdingValues.snapshotId, snapshotId),
    inArray(schema.holdings.accountId, accountIds),
    additionalCondition,
  );
}

/**
 * 保有資産の最新値を取得
 * snapshotIdで駆動し、グループでフィルタリング
 */
export async function getHoldingsWithLatestValues(
  groupIdParam?: string,
  db: Db = getDb(),
): Promise<DashboardHolding[]> {
  const groups = await getGroupContexts(db, groupIdParam);
  const results = await Promise.all(
    groups.map(async (group) => {
      const latestSnapshot = await getLatestSnapshot(db, group.profileId);
      if (!latestSnapshot) return [];
      const accountIds = await getHoldingAccountIdsForGroup(
        db,
        group.groupId,
        group.profileId,
        group.mfGroupId,
      );
      if (accountIds.length === 0) return [];

      const whereCondition = buildHoldingWhereCondition(latestSnapshot.id, accountIds);
      return await db
        .select({
          id: schema.holdings.id,
          name: schema.holdings.name,
          type: schema.holdings.type,
          liabilityCategory: schema.holdings.liabilityCategory,
          categoryId: schema.holdings.categoryId,
          categoryName: schema.assetCategories.name,
          accountId: schema.holdings.accountId,
          accountName: schema.accounts.name,
          institution: schema.accounts.institution,
          profileId: schema.accounts.profileId,
          profileName: schema.moneyForwardProfiles.name,
          amount: schema.holdingValues.amount,
          quantity: schema.holdingValues.quantity,
          unitPrice: schema.holdingValues.unitPrice,
          avgCostPrice: schema.holdingValues.avgCostPrice,
          dailyChange: schema.holdingValues.dailyChange,
          unrealizedGain: schema.holdingValues.unrealizedGain,
          unrealizedGainPct: schema.holdingValues.unrealizedGainPct,
        })
        .from(schema.holdingValues)
        .innerJoin(schema.holdings, eq(schema.holdings.id, schema.holdingValues.holdingId))
        .leftJoin(schema.assetCategories, eq(schema.assetCategories.id, schema.holdings.categoryId))
        .leftJoin(schema.accounts, eq(schema.accounts.id, schema.holdings.accountId))
        .leftJoin(
          schema.moneyForwardProfiles,
          eq(schema.moneyForwardProfiles.id, schema.accounts.profileId),
        )
        .where(whereCondition)
        .all();
    }),
  );
  return results.flat();
}

/**
 * 特定アカウントの保有資産を取得
 * アカウントがグループに所属しない場合は空配列を返す
 */
export async function getHoldingsByAccountId(
  accountId: number,
  groupIdParam?: string,
  db: Db = getDb(),
): Promise<DashboardHolding[]> {
  const groupIds = await resolveGroupIds(db, groupIdParam);
  const accountIds = await getAccountIdsForGroups(db, groupIds);
  if (accountIds.length === 0 || !accountIds.includes(accountId)) return [];

  const account = await db
    .select({ profileId: schema.accounts.profileId })
    .from(schema.accounts)
    .where(eq(schema.accounts.id, accountId))
    .get();
  if (!account) return [];

  const latestSnapshot = await getLatestSnapshot(db, account.profileId);

  if (!latestSnapshot) {
    return [];
  }

  return await db
    .select({
      id: schema.holdings.id,
      name: schema.holdings.name,
      type: schema.holdings.type,
      liabilityCategory: schema.holdings.liabilityCategory,
      categoryName: schema.assetCategories.name,
      accountName: schema.accounts.name,
      institution: schema.accounts.institution,
      profileId: schema.accounts.profileId,
      profileName: schema.moneyForwardProfiles.name,
      amount: schema.holdingValues.amount,
      quantity: schema.holdingValues.quantity,
      unitPrice: schema.holdingValues.unitPrice,
      avgCostPrice: schema.holdingValues.avgCostPrice,
      dailyChange: schema.holdingValues.dailyChange,
      unrealizedGain: schema.holdingValues.unrealizedGain,
      unrealizedGainPct: schema.holdingValues.unrealizedGainPct,
    })
    .from(schema.holdingValues)
    .innerJoin(schema.holdings, eq(schema.holdings.id, schema.holdingValues.holdingId))
    .leftJoin(schema.assetCategories, eq(schema.assetCategories.id, schema.holdings.categoryId))
    .leftJoin(schema.accounts, eq(schema.accounts.id, schema.holdings.accountId))
    .leftJoin(
      schema.moneyForwardProfiles,
      eq(schema.moneyForwardProfiles.id, schema.accounts.profileId),
    )
    .where(
      and(
        eq(schema.holdingValues.snapshotId, latestSnapshot.id),
        eq(schema.holdings.accountId, accountId),
      ),
    )
    .all();
}

export interface HoldingWithDailyChange {
  id: number;
  name: string;
  code: string | null;
  categoryName: string | null;
  accountName: string | null;
  profileId?: string | null;
  profileName?: string | null;
  dailyChange: number;
}

/**
 * 日次変動がある保有資産を取得
 * daily_changeがnullでないもののみ返す
 */
export async function getHoldingsWithDailyChange(
  groupIdParam?: string,
  db: Db = getDb(),
): Promise<HoldingWithDailyChange[]> {
  const groups = await getGroupContexts(db, groupIdParam);
  const results = await Promise.all(
    groups.map(async (group) => {
      const latestSnapshot = await getLatestSnapshot(db, group.profileId);
      if (!latestSnapshot) return [];
      const accountIds = await getHoldingAccountIdsForGroup(
        db,
        group.groupId,
        group.profileId,
        group.mfGroupId,
      );
      if (accountIds.length === 0) return [];
      const whereCondition = buildHoldingWhereCondition(
        latestSnapshot.id,
        accountIds,
        isNotNull(schema.holdingValues.dailyChange),
      );

      return (await db
        .select({
          id: schema.holdings.id,
          name: schema.holdings.name,
          code: schema.holdings.code,
          categoryName: schema.assetCategories.name,
          accountName: schema.accounts.name,
          profileId: schema.accounts.profileId,
          profileName: schema.moneyForwardProfiles.name,
          dailyChange: schema.holdingValues.dailyChange,
        })
        .from(schema.holdingValues)
        .innerJoin(schema.holdings, eq(schema.holdings.id, schema.holdingValues.holdingId))
        .leftJoin(schema.assetCategories, eq(schema.assetCategories.id, schema.holdings.categoryId))
        .leftJoin(schema.accounts, eq(schema.accounts.id, schema.holdings.accountId))
        .leftJoin(
          schema.moneyForwardProfiles,
          eq(schema.moneyForwardProfiles.id, schema.accounts.profileId),
        )
        .where(whereCondition)
        .all()) as HoldingWithDailyChange[];
    }),
  );
  return results.flat();
}

/**
 * 投資銘柄を保有しているかチェック
 */
export async function hasInvestmentHoldings(groupIdParam?: string, db: Db = getDb()) {
  const holdings = await getHoldingsWithLatestValues(groupIdParam, db);
  return holdings.some(
    (h) => h.categoryName !== null && INVESTMENT_CATEGORIES.includes(h.categoryName),
  );
}
