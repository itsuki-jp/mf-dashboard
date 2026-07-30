import { and, desc, eq, getTableColumns, sql } from "drizzle-orm";
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
