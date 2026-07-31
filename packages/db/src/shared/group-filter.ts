import { and, asc, eq, inArray, or } from "drizzle-orm";
import type { Db } from "../index";
import { schema } from "../index";
import { parseProfileScopeId } from "../profile-scope";
export { createProfileScopeId, parseProfileScopeId, PROFILE_SCOPE_PREFIX } from "../profile-scope";

function decodeScopeId(scopeId: string): string {
  try {
    return decodeURIComponent(scopeId);
  } catch {
    return scopeId;
  }
}

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
  const groupIds = await resolveGroupIds(db, groupId);
  return groupIds.length === 1 ? groupIds[0] : null;
}

/**
 * 画面の表示対象を内部group IDへ解決する。
 *
 * 未指定はenabledな全profile、profile scopeは対象profile、通常のIDは単一groupを表す。
 * mfGroupIdだけの指定が複数profileへ一致する場合は、混線を避けるためfail closedする。
 */
export async function resolveGroupIds(db: Db, scopeId?: string): Promise<string[]> {
  const normalizedScopeId = scopeId ? decodeScopeId(scopeId) : undefined;
  const profileId = normalizedScopeId ? parseProfileScopeId(normalizedScopeId) : null;

  if (!normalizedScopeId || profileId) {
    const currentGroups = await db
      .select({ id: schema.groups.id })
      .from(schema.groups)
      .innerJoin(
        schema.moneyForwardProfiles,
        eq(schema.moneyForwardProfiles.id, schema.groups.profileId),
      )
      .where(
        and(
          eq(schema.groups.isCurrent, true),
          eq(schema.moneyForwardProfiles.enabled, true),
          profileId ? eq(schema.groups.profileId, profileId) : undefined,
        ),
      )
      .orderBy(asc(schema.groups.profileId))
      .all();
    return currentGroups.map((group) => group.id);
  }

  const activeGroups = await db
    .select({ id: schema.groups.id })
    .from(schema.groups)
    .innerJoin(
      schema.moneyForwardProfiles,
      eq(schema.moneyForwardProfiles.id, schema.groups.profileId),
    )
    .where(
      and(
        or(eq(schema.groups.id, normalizedScopeId), eq(schema.groups.mfGroupId, normalizedScopeId)),
        eq(schema.moneyForwardProfiles.enabled, true),
      ),
    )
    .all();
  return activeGroups.length === 1 ? [activeGroups[0].id] : [];
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

/** 複数groupに属するアカウントIDを重複なく取得する。 */
export async function getAccountIdsForGroups(db: Db, groupIds: string[]): Promise<number[]> {
  if (groupIds.length === 0) return [];
  const groupAccounts = await db
    .select({ accountId: schema.groupAccounts.accountId })
    .from(schema.groupAccounts)
    .where(inArray(schema.groupAccounts.groupId, groupIds))
    .orderBy(asc(schema.groupAccounts.accountId))
    .all();
  return [...new Set(groupAccounts.map((row) => row.accountId))];
}
