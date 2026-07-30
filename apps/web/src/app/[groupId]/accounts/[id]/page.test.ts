import { beforeEach, describe, expect, it, vi } from "vitest";

type AnyMock = (...args: any[]) => any;

const mocks = vi.hoisted(() => ({
  getAllGroups: vi.fn<AnyMock>(),
  getDashboardProfiles: vi.fn<AnyMock>(),
  getAllAccountMfIds: vi.fn<AnyMock>(),
}));

vi.mock("@mf-dashboard/db", () => ({
  createProfileScopeId: (profileId: string) => `profile--${profileId}`,
  getAllAccountMfIds: mocks.getAllAccountMfIds,
  getAccountByMfId: vi.fn<AnyMock>(),
  getAllGroups: mocks.getAllGroups,
  getDashboardProfiles: mocks.getDashboardProfiles,
  isDatabaseAvailable: () => true,
}));

vi.mock("../../../accounts/[id]/page", () => ({
  AccountDetailContent: () => null,
}));

import { generateStaticParams } from "./page";

describe("profile scoped account static params", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAllGroups.mockResolvedValue([
      { id: "profile_a:0", isCurrent: true },
      { id: "profile_a:history", isCurrent: false },
    ]);
    mocks.getDashboardProfiles.mockResolvedValue([{ id: "profile_a" }]);
    mocks.getAllAccountMfIds.mockImplementation(async (scope: string) =>
      scope === "profile--profile_a" || scope === "profile_a:0"
        ? ["current-account"]
        : ["history-account"],
    );
  });

  it("current profileと過去groupの口座詳細routeを生成する", async () => {
    await expect(generateStaticParams()).resolves.toEqual([
      { groupId: "profile--profile_a", id: "current-account" },
      { groupId: "profile_a:0", id: "current-account" },
      { groupId: "profile_a:history", id: "history-account" },
    ]);
  });
});
