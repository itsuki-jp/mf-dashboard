import { and, asc, desc, eq, getTableColumns, sql } from "drizzle-orm";
import { getDb, type Db, schema } from "../index";

export async function getCurrentGroup(db: Db = getDb()) {
  return await db
    .select(getTableColumns(schema.groups))
    .from(schema.groups)
    .innerJoin(
      schema.moneyForwardProfiles,
      eq(schema.moneyForwardProfiles.id, schema.groups.profileId),
    )
    .where(and(eq(schema.groups.isCurrent, true), eq(schema.moneyForwardProfiles.enabled, true)))
    .get();
}

export async function getAllGroups(db: Db = getDb()) {
  return await db
    .select(getTableColumns(schema.groups))
    .from(schema.groups)
    .innerJoin(
      schema.moneyForwardProfiles,
      eq(schema.moneyForwardProfiles.id, schema.groups.profileId),
    )
    .where(eq(schema.moneyForwardProfiles.enabled, true))
    .orderBy(
      desc(sql`CASE WHEN ${schema.groups.isCurrent} = 1 THEN 1 ELSE 0 END`),
      desc(schema.groups.lastScrapedAt),
    )
    .all();
}

export interface DashboardProfile {
  id: string;
  name: string;
  lastScrapedAt: string | null;
  lastStatus: string | null;
  currentGroupId: string | null;
}

/** Dashboardへ公開してよいenabled profileのmetadataを返す。 */
export async function getDashboardProfiles(db: Db = getDb()): Promise<DashboardProfile[]> {
  const profiles = await db
    .select({
      id: schema.moneyForwardProfiles.id,
      name: schema.moneyForwardProfiles.name,
      lastScrapedAt: schema.moneyForwardProfiles.lastScrapedAt,
      lastStatus: schema.moneyForwardProfiles.lastStatus,
    })
    .from(schema.moneyForwardProfiles)
    .where(eq(schema.moneyForwardProfiles.enabled, true))
    .orderBy(asc(schema.moneyForwardProfiles.id))
    .all();

  return await Promise.all(
    profiles.map(async (profile) => {
      const currentGroup = await db
        .select({ id: schema.groups.id })
        .from(schema.groups)
        .where(and(eq(schema.groups.profileId, profile.id), eq(schema.groups.isCurrent, true)))
        .get();
      return { ...profile, currentGroupId: currentGroup?.id ?? null };
    }),
  );
}
