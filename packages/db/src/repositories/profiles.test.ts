import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../index";
import { schema } from "../index";
import { closeTestDb, createTestDb } from "../test-helpers";
import {
  activateMoneyForwardProfile,
  updateMoneyForwardProfileScrapeStatus,
  upsertMoneyForwardProfile,
} from "./profiles";

describe("Money Forward profile repository", () => {
  let db: Db;

  beforeEach(async () => {
    db = await createTestDb();
  });

  afterEach(() => {
    closeTestDb(db);
  });

  it("secretを扱わずprofile metadataをupsertする", async () => {
    await upsertMoneyForwardProfile(db, {
      id: "user-a",
      name: "User A",
      enabled: true,
    });

    const created = await db
      .select()
      .from(schema.moneyForwardProfiles)
      .where(eq(schema.moneyForwardProfiles.id, "user-a"))
      .get();
    expect(created).toMatchObject({
      id: "user-a",
      name: "User A",
      enabled: true,
      lastScrapedAt: null,
      lastStatus: null,
      lastError: null,
    });

    await updateMoneyForwardProfileScrapeStatus(db, "user-a", {
      lastScrapedAt: "2026-01-02T03:04:05.000Z",
      lastStatus: "success",
      lastError: null,
    });
    await upsertMoneyForwardProfile(db, {
      id: "user-a",
      name: "User A Updated",
      enabled: false,
    });

    const updated = await db
      .select()
      .from(schema.moneyForwardProfiles)
      .where(eq(schema.moneyForwardProfiles.id, "user-a"))
      .get();
    expect(updated).toMatchObject({
      id: "user-a",
      name: "User A Updated",
      enabled: false,
      lastScrapedAt: "2026-01-02T03:04:05.000Z",
      lastStatus: "success",
      lastError: null,
    });
    expect(updated?.createdAt).toBe(created?.createdAt);
  });

  it("profileごとの最終scrape状態を更新する", async () => {
    await upsertMoneyForwardProfile(db, {
      id: "user-a",
      name: "User A",
      enabled: true,
    });

    await updateMoneyForwardProfileScrapeStatus(db, "user-a", {
      lastScrapedAt: "2026-01-02T03:04:05.000Z",
      lastStatus: "error",
      lastError: "Anonymous test error",
    });

    const profile = await db
      .select()
      .from(schema.moneyForwardProfiles)
      .where(eq(schema.moneyForwardProfiles.id, "user-a"))
      .get();
    expect(profile).toMatchObject({
      lastScrapedAt: "2026-01-02T03:04:05.000Z",
      lastStatus: "error",
      lastError: "Anonymous test error",
    });
  });

  it("後からactivateしたprofileだけを有効にする", async () => {
    await activateMoneyForwardProfile(db, {
      id: "primary",
      name: "Primary",
      enabled: true,
    });
    await activateMoneyForwardProfile(db, {
      id: "secondary",
      name: "Secondary",
      enabled: true,
    });

    const profiles = await db
      .select({ id: schema.moneyForwardProfiles.id, enabled: schema.moneyForwardProfiles.enabled })
      .from(schema.moneyForwardProfiles)
      .all();
    expect(profiles.sort((a, b) => a.id.localeCompare(b.id))).toEqual([
      { id: "primary", enabled: false },
      { id: "secondary", enabled: true },
    ]);
  });

  it("fresh DBでprofile削除を従属データへcascadeする", async () => {
    const timestamp = "2026-01-01T00:00:00.000Z";

    await upsertMoneyForwardProfile(db, {
      id: "user-a",
      name: "User A",
      enabled: true,
    });
    await db
      .insert(schema.groups)
      .values({
        id: "user-a:group-001",
        profileId: "user-a",
        mfGroupId: "group-001",
        name: "Group A",
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();
    const account = await db
      .insert(schema.accounts)
      .values({
        profileId: "user-a",
        mfId: "account-001",
        name: "Account A",
        type: "test",
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .returning({ id: schema.accounts.id })
      .get();
    await db
      .insert(schema.holdings)
      .values({
        profileId: "user-a",
        mfId: "holding-001",
        accountId: account.id,
        name: "Holding A",
        type: "asset",
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();
    await db
      .insert(schema.transactions)
      .values({
        profileId: "user-a",
        mfId: "transaction-001",
        date: "2026-01-01",
        amount: 1,
        type: "expense",
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .run();

    await db
      .delete(schema.moneyForwardProfiles)
      .where(eq(schema.moneyForwardProfiles.id, "user-a"))
      .run();

    expect(await db.select().from(schema.groups).all()).toEqual([]);
    expect(await db.select().from(schema.accounts).all()).toEqual([]);
    expect(await db.select().from(schema.holdings).all()).toEqual([]);
    expect(await db.select().from(schema.transactions).all()).toEqual([]);
  });
});
