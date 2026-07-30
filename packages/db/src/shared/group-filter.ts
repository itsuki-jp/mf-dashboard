import { and, eq, or } from "drizzle-orm";
import type { Db } from "../index";
import { schema } from "../index";

/** 現在のグループID（isCurrent=true）を取得 */
export async function getDefaultGroupId(db: Db): Promise<string | null> {
  const currentGroup = await db
    .select({ id: schema.groups.id })
    .from(schema.groups)
    .innerJoin(
      schema.moneyForwardProfiles,
      eq(schema.moneyForwardProfiles.id, schema.groups.profileId),
    )
    .where(and(eq(schema.groups.isCurrent, true), eq(schema.moneyForwardProfiles.enabled, true)))
    .get();
  return currentGroup?.id ?? null;
}

/** グループIDを解決（指定がなければデフォルトを使用） */
export async function resolveGroupId(db: Db, groupId?: string): Promise<string | null> {
  if (!groupId) return getDefaultGroupId(db);

  const activeGroup = await db
    .select({ id: schema.groups.id })
    .from(schema.groups)
    .innerJoin(
      schema.moneyForwardProfiles,
      eq(schema.moneyForwardProfiles.id, schema.groups.profileId),
    )
    .where(
      and(
        or(eq(schema.groups.id, groupId), eq(schema.groups.mfGroupId, groupId)),
        eq(schema.moneyForwardProfiles.enabled, true),
      ),
    )
    .get();
  return activeGroup?.id ?? null;
}

/** グループに属するアカウントIDリストを取得 */
export async function getAccountIdsForGroup(db: Db, groupId: string): Promise<number[]> {
  const groupAccounts = await db
    .select({ accountId: schema.groupAccounts.accountId })
    .from(schema.groupAccounts)
    .where(eq(schema.groupAccounts.groupId, groupId))
    .all();
  return groupAccounts.map((ga) => ga.accountId);
}
