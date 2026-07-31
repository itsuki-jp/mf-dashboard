import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { schema } from "../index";
import { createProfileScopeId } from "../shared/group-filter";
import { createTestDb, resetTestDb, closeTestDb } from "../test-helpers";
import { getTransactions, getTransactionsByMonth, getTransactionsByAccountId } from "./transaction";

type Db = Awaited<ReturnType<typeof createTestDb>>;
let db: Db;

const TEST_MF_GROUP_ID = "test_group_001";
const TEST_GROUP_ID = `primary:${TEST_MF_GROUP_ID}`;

beforeAll(async () => {
  db = await createTestDb();
});

afterAll(() => {
  closeTestDb(db);
});

beforeEach(async () => {
  await resetTestDb(db);
  // Setup test group
  const now = new Date().toISOString();
  await db
    .insert(schema.groups)
    .values({
      profileId: "primary",
      mfGroupId: TEST_MF_GROUP_ID,
      id: TEST_GROUP_ID,
      name: "Test Group",
      isCurrent: true,
      createdAt: now,
      updatedAt: now,
    })
    .run();
});

async function createTestAccount(
  name: string,
  profileId = "primary",
  groupId = TEST_GROUP_ID,
): Promise<number> {
  const now = new Date().toISOString();
  const account = await db
    .insert(schema.accounts)
    .values({
      profileId,
      mfId: `mf_${name}`,
      name,
      type: "bank",
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();

  await db
    .insert(schema.groupAccounts)
    .values({
      profileId,
      groupId,
      accountId: account.id,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  return account.id;
}

async function createSecondaryProfileGroup() {
  const now = new Date().toISOString();
  const profileId = "secondary";
  const groupId = `${profileId}:${TEST_MF_GROUP_ID}`;
  await db.insert(schema.moneyForwardProfiles).values({
    id: profileId,
    name: "Profile B",
    enabled: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.groups).values({
    profileId,
    mfGroupId: TEST_MF_GROUP_ID,
    id: groupId,
    name: "Group B",
    isCurrent: true,
    createdAt: now,
    updatedAt: now,
  });
  return { profileId, groupId };
}

async function createTransaction(data: {
  accountId: number;
  date: string;
  amount: number;
  type: "income" | "expense" | "transfer";
  category?: string;
  transferTargetAccountId?: number;
  profileId?: string;
}) {
  const now = new Date().toISOString();
  await db
    .insert(schema.transactions)
    .values({
      profileId: data.profileId ?? "primary",
      mfId: `tx_${Date.now()}_${Math.random()}`,
      date: data.date,
      accountId: data.accountId,
      category: data.category ?? null,
      subCategory: null,
      description: "Test transaction",
      amount: data.amount,
      type: data.type,
      isTransfer: data.type === "transfer",
      isExcludedFromCalculation: data.type === "transfer",
      transferTargetAccountId: data.transferTargetAccountId ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

describe("getTransactions", () => {
  it("トランザクション一覧を返す", async () => {
    const accountId = await createTestAccount("Bank A");
    await createTransaction({
      accountId,
      date: "2025-04-15",
      amount: 3000,
      type: "expense",
      category: "食費",
    });
    await createTransaction({
      accountId,
      date: "2025-04-14",
      amount: 500000,
      type: "income",
      category: "給与",
    });

    const result = await getTransactions(undefined, db);

    expect(result).toHaveLength(2);
    expect(result[0].date).toBe("2025-04-15");
    expect(result[1].date).toBe("2025-04-14");
  });

  it("limitを指定した場合は件数が制限される", async () => {
    const accountId = await createTestAccount("Bank A");
    await createTransaction({ accountId, date: "2025-04-15", amount: 1000, type: "expense" });
    await createTransaction({ accountId, date: "2025-04-14", amount: 2000, type: "expense" });

    const result = await getTransactions({ limit: 1 }, db);

    expect(result).toHaveLength(1);
  });

  it("グループがない場合は空配列を返す", async () => {
    await resetTestDb(db);
    expect(await getTransactions(undefined, db)).toEqual([]);
  });

  it("未指定では全profileを集約し、profile scopeと明示groupでは分離する", async () => {
    const secondary = await createSecondaryProfileGroup();
    const primaryAccountId = await createTestAccount("Account A");
    const secondaryAccountId = await createTestAccount(
      "Account B",
      secondary.profileId,
      secondary.groupId,
    );
    await createTransaction({
      accountId: primaryAccountId,
      date: "2025-04-15",
      amount: 1000,
      type: "expense",
    });
    await createTransaction({
      accountId: secondaryAccountId,
      date: "2025-04-16",
      amount: 2000,
      type: "expense",
      profileId: secondary.profileId,
    });

    expect((await getTransactions(undefined, db)).map((item) => item.accountName)).toEqual([
      "Account B",
      "Account A",
    ]);
    expect(
      (await getTransactions({ groupId: createProfileScopeId("secondary") }, db)).map(
        (item) => item.accountName,
      ),
    ).toEqual(["Account B"]);
    expect(
      (await getTransactions({ groupId: TEST_GROUP_ID }, db)).map((item) => item.accountName),
    ).toEqual(["Account A"]);
  });
});

describe("getTransactionsByMonth", () => {
  it("指定月のトランザクションを返す", async () => {
    const accountId = await createTestAccount("Bank A");
    await createTransaction({
      accountId,
      date: "2025-04-15",
      amount: 3000,
      type: "expense",
      category: "食費",
    });
    await createTransaction({
      accountId,
      date: "2025-05-01",
      amount: 5000,
      type: "expense",
      category: "交通費",
    });

    const result = await getTransactionsByMonth("2025-04", undefined, db);

    expect(result).toHaveLength(1);
    expect(result[0].date).toBe("2025-04-15");
  });

  it("該当月にデータがない場合は空配列を返す", async () => {
    const accountId = await createTestAccount("Bank A");
    await createTransaction({ accountId, date: "2025-04-15", amount: 3000, type: "expense" });

    expect(await getTransactionsByMonth("2099-01", undefined, db)).toEqual([]);
  });

  it("未指定では全profileの対象月を集約する", async () => {
    const secondary = await createSecondaryProfileGroup();
    const primaryAccountId = await createTestAccount("Account A");
    const secondaryAccountId = await createTestAccount(
      "Account B",
      secondary.profileId,
      secondary.groupId,
    );
    await createTransaction({
      accountId: primaryAccountId,
      date: "2025-04-15",
      amount: 1000,
      type: "expense",
    });
    await createTransaction({
      accountId: secondaryAccountId,
      date: "2025-04-16",
      amount: 2000,
      type: "expense",
      profileId: secondary.profileId,
    });

    expect(
      (await getTransactionsByMonth("2025-04", undefined, db)).map((item) => item.amount),
    ).toEqual([2000, 1000]);
    expect(
      (await getTransactionsByMonth("2025-04", createProfileScopeId("primary"), db)).map(
        (item) => item.amount,
      ),
    ).toEqual([1000]);
  });

  describe("振替トランザクションの収入変換", () => {
    it("グループ外アカウントからの振替は収入として扱われる", async () => {
      const accountId = await createTestAccount("Bank A");
      const now = new Date().toISOString();
      const externalAccount = await db
        .insert(schema.accounts)
        .values({
          profileId: "primary",
          mfId: "external",
          name: "External Account",
          type: "bank",
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get();

      await createTransaction({
        accountId,
        date: "2025-04-15",
        amount: 100000,
        type: "transfer",
        transferTargetAccountId: externalAccount.id,
      });

      const result = await getTransactionsByMonth("2025-04", undefined, db);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("income");
      expect(result[0].category).toBe("収入");
      expect(result[0].subCategory).toBe("振替入金");
    });

    it("グループ内アカウント間の振替はそのまま振替として返される", async () => {
      const accountId1 = await createTestAccount("Bank A");
      const accountId2 = await createTestAccount("Bank B");

      await createTransaction({
        accountId: accountId1,
        date: "2025-04-15",
        amount: 50000,
        type: "transfer",
        transferTargetAccountId: accountId2,
      });

      const result = await getTransactionsByMonth("2025-04", undefined, db);

      expect(result).toHaveLength(1);
      expect(result[0].type).toBe("transfer");
    });
  });
});

describe("getTransactionsByAccountId", () => {
  it("現在のグループに所属するアカウントのトランザクションを取得できる", async () => {
    const accountId = await createTestAccount("Bank A");
    await createTransaction({ accountId, date: "2025-04-15", amount: 3000, type: "expense" });

    const result = await getTransactionsByAccountId(accountId, undefined, db);

    expect(result).toHaveLength(1);
  });

  it("他のグループのアカウントは空配列を返す", async () => {
    const accountId = await createTestAccount("Bank A");
    await createTransaction({ accountId, date: "2025-04-15", amount: 3000, type: "expense" });

    expect(await getTransactionsByAccountId(9999, undefined, db)).toEqual([]);
  });

  it("profile scope外のアカウントは空配列を返す", async () => {
    const secondary = await createSecondaryProfileGroup();
    const primaryAccountId = await createTestAccount("Account A");
    await createTransaction({
      accountId: primaryAccountId,
      date: "2025-04-15",
      amount: 1000,
      type: "expense",
    });

    expect(
      await getTransactionsByAccountId(
        primaryAccountId,
        createProfileScopeId(secondary.profileId),
        db,
      ),
    ).toEqual([]);
  });
});
