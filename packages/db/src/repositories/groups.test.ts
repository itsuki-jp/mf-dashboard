import { eq } from "drizzle-orm";
import { describe, test, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from "vitest";
import * as schema from "../schema/schema";
import { closeTestDb, createTestDb, createTestProfile, resetTestDb } from "../test-helpers";
import type { Group } from "../types";
import { upsertAccount } from "./accounts";
import {
  upsertGroup,
  updateGroupLastScrapedAt,
  getCurrentGroupId,
  linkAccountToGroup,
  clearGroupAccountLinks,
  deleteGroupsNotIn,
} from "./groups";

type Db = Awaited<ReturnType<typeof createTestDb>>;

let db: Db;
const scopedGroupId = (mfGroupId: string): string => `primary:${mfGroupId}`;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(() => {
  closeTestDb(db);
});

beforeEach(async () => {
  await resetTestDb(db);
});

describe("upsertGroup", () => {
  const group: Group = { id: "g1", name: "テストグループ", isCurrent: true };

  test("新規グループを作成できる", async () => {
    await upsertGroup(db, "primary", group);
    const result = await db.select().from(schema.groups).all();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("テストグループ");
    expect(result[0].isCurrent).toBe(true);
  });

  test("既存グループを更新できる", async () => {
    await upsertGroup(db, "primary", group);
    await upsertGroup(db, "primary", { ...group, name: "更新後" });
    const result = await db.select().from(schema.groups).all();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("更新後");
  });

  test("新しいグループをupsertすると古いグループのisCurrentがfalseになる", async () => {
    await upsertGroup(db, "primary", group);
    await upsertGroup(db, "primary", { id: "g2", name: "別のグループ", isCurrent: true });
    const g1 = await db
      .select()
      .from(schema.groups)
      .where(eq(schema.groups.id, scopedGroupId("g1")))
      .get();
    expect(g1?.isCurrent).toBe(false);
  });

  test("isCurrent=falseのグループをupsertしても他のグループのisCurrentは変わらない", async () => {
    await upsertGroup(db, "primary", { id: "g1", name: "グループ1", isCurrent: true });
    await upsertGroup(db, "primary", { id: "g2", name: "グループ2", isCurrent: false });

    const g1 = await db
      .select()
      .from(schema.groups)
      .where(eq(schema.groups.id, scopedGroupId("g1")))
      .get();
    const g2 = await db
      .select()
      .from(schema.groups)
      .where(eq(schema.groups.id, scopedGroupId("g2")))
      .get();

    expect(g1?.isCurrent).toBe(true);
    expect(g2?.isCurrent).toBe(false);
  });

  test("複数のisCurrent=falseグループをupsertしても最初のisCurrent=trueグループは維持される", async () => {
    await upsertGroup(db, "primary", { id: "g1", name: "デフォルト", isCurrent: true });
    await upsertGroup(db, "primary", { id: "g2", name: "グループ2", isCurrent: false });
    await upsertGroup(db, "primary", { id: "g3", name: "グループ3", isCurrent: false });
    await upsertGroup(db, "primary", { id: "g4", name: "グループ4", isCurrent: false });

    const groups = await db.select().from(schema.groups).all();
    const currentGroups = groups.filter((g) => g.isCurrent);

    expect(currentGroups).toHaveLength(1);
    expect(currentGroups[0].id).toBe(scopedGroupId("g1"));
  });
});

describe("updateGroupLastScrapedAt", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-04-29T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("lastScrapedAt を更新できる", async () => {
    await upsertGroup(db, "primary", { id: "g1", name: "テストグループ", isCurrent: true });
    const timestamp = "2025-04-29T14:00:00.000Z";

    await updateGroupLastScrapedAt(db, scopedGroupId("g1"), timestamp);

    const result = await db
      .select()
      .from(schema.groups)
      .where(eq(schema.groups.id, scopedGroupId("g1")))
      .get();
    expect(result?.lastScrapedAt).toBe(timestamp);
  });

  test("updatedAt も更新される", async () => {
    await upsertGroup(db, "primary", { id: "g1", name: "テストグループ", isCurrent: true });
    const before = await db
      .select()
      .from(schema.groups)
      .where(eq(schema.groups.id, scopedGroupId("g1")))
      .get();

    // 時間を1秒進める
    vi.advanceTimersByTime(1000);

    await updateGroupLastScrapedAt(db, scopedGroupId("g1"), "2025-04-29T14:00:00.000Z");

    const after = await db
      .select()
      .from(schema.groups)
      .where(eq(schema.groups.id, scopedGroupId("g1")))
      .get();
    expect(after?.updatedAt).not.toBe(before?.updatedAt);
    expect(after?.updatedAt).toBe("2025-04-29T12:00:01.000Z");
  });
});

describe("getCurrentGroupId", () => {
  test("現在のグループIDを取得できる", async () => {
    await upsertGroup(db, "primary", { id: "g1", name: "テストグループ", isCurrent: true });

    const result = await getCurrentGroupId(db, "primary");

    expect(result).toBe(scopedGroupId("g1"));
  });

  test("現在のグループがない場合はnullを返す", async () => {
    // グループを作成してからisCurrent=falseに更新
    await upsertGroup(db, "primary", { id: "g1", name: "テストグループ", isCurrent: true });
    await db.update(schema.groups).set({ isCurrent: false }).run();

    const result = await getCurrentGroupId(db, "primary");

    expect(result).toBeNull();
  });

  test("グループが存在しない場合はnullを返す", async () => {
    const result = await getCurrentGroupId(db, "primary");

    expect(result).toBeNull();
  });

  test("複数のグループがある場合、isCurrentがtrueのグループIDを返す", async () => {
    await upsertGroup(db, "primary", { id: "g1", name: "グループ1", isCurrent: true });
    await upsertGroup(db, "primary", { id: "g2", name: "グループ2", isCurrent: true });

    const result = await getCurrentGroupId(db, "primary");

    expect(result).toBe(scopedGroupId("g2"));
  });

  test("同じraw group IDとcurrent groupをprofileごとに分離する", async () => {
    await createTestProfile(db, "secondary");

    const primaryGroupId = await upsertGroup(db, "primary", {
      id: "0",
      name: "All Accounts",
      isCurrent: true,
    });
    const secondaryGroupId = await upsertGroup(db, "secondary", {
      id: "0",
      name: "All Accounts",
      isCurrent: true,
    });

    expect(primaryGroupId).toBe("primary:0");
    expect(secondaryGroupId).toBe("secondary:0");
    await expect(getCurrentGroupId(db, "primary")).resolves.toBe("primary:0");
    await expect(getCurrentGroupId(db, "secondary")).resolves.toBe("secondary:0");
  });
});

// Helper to create test account
async function createTestAccount(mfId: string, name: string): Promise<number> {
  return await upsertAccount(db, "primary", {
    mfId,
    name,
    type: "bank",
    status: "ok",
    lastUpdated: "2025-04-01",
    url: `/accounts/show/${mfId}`,
    totalAssets: 100000,
  });
}

describe("clearGroupAccountLinks", () => {
  test("指定グループのリンクをすべて削除できる", async () => {
    await upsertGroup(db, "primary", { id: "g1", name: "テストグループ", isCurrent: true });
    const account1 = await createTestAccount("mf1", "銀行1");
    const account2 = await createTestAccount("mf2", "銀行2");

    await linkAccountToGroup(db, "primary", scopedGroupId("g1"), account1);
    await linkAccountToGroup(db, "primary", scopedGroupId("g1"), account2);

    expect(await db.select().from(schema.groupAccounts).all()).toHaveLength(2);

    await clearGroupAccountLinks(db, scopedGroupId("g1"));

    expect(await db.select().from(schema.groupAccounts).all()).toHaveLength(0);
  });

  test("他のグループのリンクには影響しない", async () => {
    await upsertGroup(db, "primary", { id: "g1", name: "グループ1", isCurrent: true });
    await upsertGroup(db, "primary", { id: "g2", name: "グループ2", isCurrent: false });
    const account1 = await createTestAccount("mf1", "銀行1");
    const account2 = await createTestAccount("mf2", "銀行2");

    await linkAccountToGroup(db, "primary", scopedGroupId("g1"), account1);
    await linkAccountToGroup(db, "primary", scopedGroupId("g2"), account2);

    await clearGroupAccountLinks(db, scopedGroupId("g1"));

    const remaining = await db.select().from(schema.groupAccounts).all();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].groupId).toBe(scopedGroupId("g2"));
  });

  test("存在しないグループIDでもエラーにならない", async () => {
    await expect(clearGroupAccountLinks(db, "nonexistent")).resolves.not.toThrow();
  });

  test("リンクがない状態でもエラーにならない", async () => {
    await upsertGroup(db, "primary", { id: "g1", name: "テストグループ", isCurrent: true });
    await expect(clearGroupAccountLinks(db, scopedGroupId("g1"))).resolves.not.toThrow();
  });
});

describe("deleteGroupsNotIn", () => {
  test("リストに含まれないグループを削除する", async () => {
    await upsertGroup(db, "primary", { id: "g1", name: "グループ1", isCurrent: true });
    await upsertGroup(db, "primary", { id: "g2", name: "グループ2", isCurrent: false });
    await upsertGroup(db, "primary", { id: "g3", name: "グループ3", isCurrent: false });

    await deleteGroupsNotIn(db, "primary", ["g1", "g2"]);

    const result = await db.select().from(schema.groups).all();
    expect(result).toHaveLength(2);
    expect(result.map((g) => g.id).sort()).toEqual([scopedGroupId("g1"), scopedGroupId("g2")]);
  });

  test("リストにすべて含まれる場合は何も削除しない", async () => {
    await upsertGroup(db, "primary", { id: "g1", name: "グループ1", isCurrent: true });
    await upsertGroup(db, "primary", { id: "g2", name: "グループ2", isCurrent: false });

    await deleteGroupsNotIn(db, "primary", ["g1", "g2"]);

    const result = await db.select().from(schema.groups).all();
    expect(result).toHaveLength(2);
  });

  test("空リストを渡しても何も削除しない", async () => {
    await upsertGroup(db, "primary", { id: "g1", name: "グループ1", isCurrent: true });

    await deleteGroupsNotIn(db, "primary", []);

    const result = await db.select().from(schema.groups).all();
    expect(result).toHaveLength(1);
  });

  test("NO_GROUP_ID をリストに含めれば削除されない", async () => {
    const NO_GROUP_ID = "0";
    await upsertGroup(db, "primary", { id: NO_GROUP_ID, name: "グループなし", isCurrent: false });
    await upsertGroup(db, "primary", { id: "g1", name: "グループ1", isCurrent: true });
    await upsertGroup(db, "primary", { id: "g2", name: "グループ2", isCurrent: false });

    await deleteGroupsNotIn(db, "primary", ["g1", NO_GROUP_ID]);

    const result = await db.select().from(schema.groups).all();
    expect(result).toHaveLength(2);
    expect(result.map((g) => g.id).sort()).toEqual([scopedGroupId("0"), scopedGroupId("g1")]);
  });

  test("secondaryのcleanupがprimaryの同じraw group IDへ影響しない", async () => {
    await createTestProfile(db, "secondary");
    await upsertGroup(db, "primary", { id: "shared", name: "Primary Shared", isCurrent: true });
    await upsertGroup(db, "primary", {
      id: "primary-only",
      name: "Primary Only",
      isCurrent: false,
    });
    await upsertGroup(db, "secondary", {
      id: "shared",
      name: "Secondary Shared",
      isCurrent: true,
    });
    await upsertGroup(db, "secondary", {
      id: "secondary-stale",
      name: "Secondary Stale",
      isCurrent: false,
    });

    await deleteGroupsNotIn(db, "secondary", ["shared"]);

    const groups = await db.select().from(schema.groups).all();
    expect(groups.map(({ id }) => id).sort()).toEqual([
      "primary:primary-only",
      "primary:shared",
      "secondary:shared",
    ]);
  });
});

describe("linkAccountToGroup", () => {
  test("アカウントをグループに紐付けできる", async () => {
    await upsertGroup(db, "primary", { id: "g1", name: "テストグループ", isCurrent: true });
    const accountId = await createTestAccount("mf1", "テスト銀行");

    await linkAccountToGroup(db, "primary", scopedGroupId("g1"), accountId);

    const result = await db.select().from(schema.groupAccounts).all();
    expect(result).toHaveLength(1);
    expect(result[0].groupId).toBe(scopedGroupId("g1"));
    expect(result[0].profileId).toBe("primary");
    expect(result[0].accountId).toBe(accountId);
  });

  test("同じアカウントを同じグループに複数回紐付けしても重複しない", async () => {
    await upsertGroup(db, "primary", { id: "g1", name: "テストグループ", isCurrent: true });
    const accountId = await createTestAccount("mf1", "テスト銀行");

    await linkAccountToGroup(db, "primary", scopedGroupId("g1"), accountId);
    await linkAccountToGroup(db, "primary", scopedGroupId("g1"), accountId);
    await linkAccountToGroup(db, "primary", scopedGroupId("g1"), accountId);

    const result = await db.select().from(schema.groupAccounts).all();
    expect(result).toHaveLength(1);
  });

  test("同じアカウントを異なるグループに紐付けできる", async () => {
    await upsertGroup(db, "primary", { id: "g1", name: "グループ1", isCurrent: true });
    await upsertGroup(db, "primary", { id: "g2", name: "グループ2", isCurrent: true });
    const accountId = await createTestAccount("mf1", "共有銀行");

    await linkAccountToGroup(db, "primary", scopedGroupId("g1"), accountId);
    await linkAccountToGroup(db, "primary", scopedGroupId("g2"), accountId);

    const result = await db.select().from(schema.groupAccounts).all();
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.groupId).sort()).toEqual([scopedGroupId("g1"), scopedGroupId("g2")]);
  });

  test("異なるアカウントを同じグループに紐付けできる", async () => {
    await upsertGroup(db, "primary", { id: "g1", name: "テストグループ", isCurrent: true });
    const account1 = await createTestAccount("mf1", "銀行1");
    const account2 = await createTestAccount("mf2", "銀行2");

    await linkAccountToGroup(db, "primary", scopedGroupId("g1"), account1);
    await linkAccountToGroup(db, "primary", scopedGroupId("g1"), account2);

    const result = await db.select().from(schema.groupAccounts).all();
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.accountId).sort((a, b) => a - b)).toEqual(
      [account1, account2].sort((a, b) => a - b),
    );
  });

  test("異なるprofileのgroupとaccountは紐付けできない", async () => {
    await createTestProfile(db, "secondary");
    await upsertGroup(db, "primary", { id: "g1", name: "Primary Group", isCurrent: true });
    const secondaryAccountId = await upsertAccount(db, "secondary", {
      mfId: "account-001",
      name: "Account A",
      type: "bank",
      status: "ok",
      lastUpdated: "2025-04-01",
      url: "/accounts/show/account-001",
      totalAssets: 100000,
    });

    await expect(
      linkAccountToGroup(db, "primary", scopedGroupId("g1"), secondaryAccountId),
    ).rejects.toThrow(/Failed query: insert into "group_accounts"/);
    await expect(db.select().from(schema.groupAccounts).all()).resolves.toEqual([]);
  });
});
