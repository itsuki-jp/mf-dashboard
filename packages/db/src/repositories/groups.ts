import { and, eq, notInArray } from "drizzle-orm";
import type { Db, DbExecutor } from "../index";
import { schema } from "../index";
import { scopeGroupId } from "../profile-scope";
import type { Group } from "../types";
import { now, upsertById } from "../utils";

export async function getCurrentGroupId(db: Db, profileId: string): Promise<string | null> {
  const group = await db
    .select({ id: schema.groups.id })
    .from(schema.groups)
    .where(and(eq(schema.groups.profileId, profileId), eq(schema.groups.isCurrent, true)))
    .get();
  return group?.id ?? null;
}

export async function clearGroupAccountLinks(db: DbExecutor, groupId: string): Promise<void> {
  await db.delete(schema.groupAccounts).where(eq(schema.groupAccounts.groupId, groupId)).run();
}

export async function linkAccountToGroup(
  db: Db,
  profileId: string,
  groupId: string,
  accountId: number,
): Promise<void> {
  await db
    .insert(schema.groupAccounts)
    .values({
      profileId,
      groupId,
      accountId,
      createdAt: now(),
      updatedAt: now(),
    })
    .onConflictDoNothing()
    .run();
}

export async function upsertGroup(
  db: DbExecutor,
  profileId: string,
  group: Group,
): Promise<string> {
  const scopedGroupId = scopeGroupId(profileId, group.id);
  // isCurrent=trueの場合のみ、他のグループをfalseにする
  if (group.isCurrent) {
    await db
      .update(schema.groups)
      .set({ isCurrent: false, updatedAt: now() })
      .where(eq(schema.groups.profileId, profileId))
      .run();
  }

  // グループをupsert
  await upsertById(
    db,
    schema.groups,
    eq(schema.groups.id, scopedGroupId),
    {
      id: scopedGroupId,
      profileId,
      mfGroupId: group.id,
      name: group.name,
      isCurrent: group.isCurrent,
    },
    {
      name: group.name,
      isCurrent: group.isCurrent,
    },
  );
  return scopedGroupId;
}

export async function updateGroupLastScrapedAt(
  db: DbExecutor,
  groupId: string,
  timestamp: string,
): Promise<void> {
  await db
    .update(schema.groups)
    .set({ lastScrapedAt: timestamp, updatedAt: now() })
    .where(eq(schema.groups.id, groupId))
    .run();
}

export async function deleteGroupsNotIn(
  db: DbExecutor,
  profileId: string,
  groupIds: string[],
): Promise<void> {
  if (groupIds.length === 0) return;
  const scopedGroupIds = groupIds.map((groupId) => scopeGroupId(profileId, groupId));
  await db
    .delete(schema.groups)
    .where(
      and(eq(schema.groups.profileId, profileId), notInArray(schema.groups.id, scopedGroupIds)),
    )
    .run();
}

/**
 * 複数アカウントリンクの一括insert
 */
export async function linkAccountsToGroup(
  db: DbExecutor,
  profileId: string,
  groupId: string,
  accountIds: number[],
): Promise<void> {
  if (accountIds.length === 0) return;

  const timestamp = now();
  const records = accountIds.map((accountId) => ({
    profileId,
    groupId,
    accountId,
    createdAt: timestamp,
    updatedAt: timestamp,
  }));

  await db.insert(schema.groupAccounts).values(records).onConflictDoNothing().run();
}
