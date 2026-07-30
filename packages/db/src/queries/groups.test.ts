import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { schema } from "../index";
import { activateMoneyForwardProfile } from "../repositories/profiles";
import { createTestDb, resetTestDb, closeTestDb, createTestProfile } from "../test-helpers";
import { getCurrentGroup, getAllGroups } from "./groups";

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

describe("getCurrentGroup", () => {
  it("isCurrent=trueのグループを返す", async () => {
    const now = new Date().toISOString();
    await db
      .insert(schema.groups)
      .values({
        profileId: "primary",
        mfGroupId: "group_001",
        id: "primary:group_001",
        name: "Current Group",
        isCurrent: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const result = await getCurrentGroup(db);

    expect(result?.id).toBe("primary:group_001");
    expect(result?.name).toBe("Current Group");
  });

  it("該当がない場合はundefinedを返す", async () => {
    expect(await getCurrentGroup(db)).toBeUndefined();
  });
});

describe("getAllGroups", () => {
  it("isCurrent=trueを最初に、lastScrapedAt降順でソート", async () => {
    const now = new Date().toISOString();
    const yesterday = new Date(Date.now() - 86400000).toISOString();

    await db
      .insert(schema.groups)
      .values([
        {
          profileId: "primary",
          mfGroupId: "g1",
          id: "primary:g1",
          name: "Group 1",
          isCurrent: false,
          lastScrapedAt: yesterday,
          createdAt: now,
          updatedAt: now,
        },
        {
          profileId: "primary",
          mfGroupId: "g2",
          id: "primary:g2",
          name: "Group 2",
          isCurrent: true,
          lastScrapedAt: yesterday,
          createdAt: now,
          updatedAt: now,
        },
        {
          profileId: "primary",
          mfGroupId: "g3",
          id: "primary:g3",
          name: "Group 3",
          isCurrent: false,
          lastScrapedAt: now,
          createdAt: now,
          updatedAt: now,
        },
      ])
      .run();

    const result = await getAllGroups(db);

    expect(result[0].id).toBe("primary:g2"); // isCurrent=true が最初
    expect(result[1].id).toBe("primary:g3"); // 次に lastScrapedAt が新しい順
    expect(result[2].id).toBe("primary:g1");
  });

  it("active profile切替後は新しいprofileのグループだけを返す", async () => {
    const now = new Date().toISOString();
    await createTestProfile(db, "secondary");
    await db.insert(schema.groups).values([
      {
        profileId: "primary",
        mfGroupId: "shared",
        id: "primary:shared",
        name: "Primary Group",
        isCurrent: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        profileId: "secondary",
        mfGroupId: "shared",
        id: "secondary:shared",
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

    await expect(getCurrentGroup(db)).resolves.toMatchObject({ id: "secondary:shared" });
    await expect(getAllGroups(db)).resolves.toMatchObject([{ id: "secondary:shared" }]);
  });
});
