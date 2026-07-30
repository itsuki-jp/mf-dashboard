import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { schema } from "../index";
import { activateMoneyForwardProfile } from "../repositories/profiles";
import { closeTestDb, createTestDb, createTestProfile, resetTestDb } from "../test-helpers";
import { getDefaultGroupId, resolveGroupId, getAccountIdsForGroup } from "./group-filter";

type Db = Awaited<ReturnType<typeof createTestDb>>;
let db: Db;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(() => {
  closeTestDb(db);
});

beforeEach(async () => {
  await resetTestDb(db);
});

describe("getDefaultGroupId", () => {
  it("isCurrent=trueのグループIDを返す", async () => {
    const now = new Date().toISOString();
    await db
      .insert(schema.groups)
      .values({
        profileId: "primary",
        mfGroupId: "group_001",
        id: "primary:group_001",
        name: "Test Group",
        isCurrent: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    expect(await getDefaultGroupId(db)).toBe("primary:group_001");
  });

  it("グループがない場合はnullを返す", async () => {
    expect(await getDefaultGroupId(db)).toBeNull();
  });
});

describe("resolveGroupId", () => {
  it("active profileのgroupIdが指定されていればそのまま返す", async () => {
    const now = new Date().toISOString();
    await db.insert(schema.groups).values({
      id: "primary:explicit-group",
      profileId: "primary",
      mfGroupId: "explicit-group",
      name: "Explicit Group",
      isCurrent: false,
      createdAt: now,
      updatedAt: now,
    });

    expect(await resolveGroupId(db, "primary:explicit-group")).toBe("primary:explicit-group");
  });

  it("groupIdが未指定の場合はデフォルトを返す", async () => {
    const now = new Date().toISOString();
    await db
      .insert(schema.groups)
      .values({
        profileId: "primary",
        mfGroupId: "default_group",
        id: "primary:default_group",
        name: "Default",
        isCurrent: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    expect(await resolveGroupId(db)).toBe("primary:default_group");
  });

  it("active profile切替後は旧profileのdefaultと明示groupIdを公開しない", async () => {
    const now = new Date().toISOString();
    await createTestProfile(db, "secondary");
    await db.insert(schema.groups).values([
      {
        id: "primary:shared",
        profileId: "primary",
        mfGroupId: "shared",
        name: "Primary Group",
        isCurrent: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "secondary:shared",
        profileId: "secondary",
        mfGroupId: "shared",
        name: "Secondary Group",
        isCurrent: true,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    await activateMoneyForwardProfile(db, {
      id: "secondary",
      name: "Secondary",
      enabled: true,
    });

    await expect(getDefaultGroupId(db)).resolves.toBe("secondary:shared");
    await expect(resolveGroupId(db, "primary:shared")).resolves.toBeNull();
    await expect(resolveGroupId(db, "secondary:shared")).resolves.toBe("secondary:shared");
  });
});

describe("getAccountIdsForGroup", () => {
  it("グループに属するアカウントIDリストを返す", async () => {
    const now = new Date().toISOString();
    await db
      .insert(schema.groups)
      .values({
        profileId: "primary",
        mfGroupId: "group_001",
        id: "primary:group_001",
        name: "Test",
        isCurrent: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const acc1 = await db
      .insert(schema.accounts)
      .values({
        profileId: "primary",
        mfId: "acc1",
        name: "Account 1",
        type: "bank",
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();

    const acc2 = await db
      .insert(schema.accounts)
      .values({
        profileId: "primary",
        mfId: "acc2",
        name: "Account 2",
        type: "bank",
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();

    await db
      .insert(schema.groupAccounts)
      .values([
        {
          profileId: "primary",
          groupId: "primary:group_001",
          accountId: acc1.id,
          createdAt: now,
          updatedAt: now,
        },
        {
          profileId: "primary",
          groupId: "primary:group_001",
          accountId: acc2.id,
          createdAt: now,
          updatedAt: now,
        },
      ])
      .run();

    const result = await getAccountIdsForGroup(db, "primary:group_001");
    expect(result).toEqual([acc1.id, acc2.id]);
  });

  it("グループにアカウントがない場合は空配列を返す", async () => {
    expect(await getAccountIdsForGroup(db, "nonexistent")).toEqual([]);
  });
});
