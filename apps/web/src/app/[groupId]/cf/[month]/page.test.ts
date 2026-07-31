import { beforeEach, describe, expect, it, vi } from "vitest";

type AnyMock = (...args: any[]) => any;

const mocks = vi.hoisted(() => ({
  getAllGroups: vi.fn<AnyMock>(),
  getDashboardProfiles: vi.fn<AnyMock>(),
  getAvailableMonths: vi.fn<AnyMock>(),
}));

vi.mock("@mf-dashboard/db", () => ({
  createProfileScopeId: (profileId: string) => `profile--${profileId}`,
  getAllGroups: mocks.getAllGroups,
  getAvailableMonths: mocks.getAvailableMonths,
  getDashboardProfiles: mocks.getDashboardProfiles,
  isDatabaseAvailable: () => true,
}));

vi.mock("../../../cf/[month]/page", () => ({
  CFMonthContent: () => null,
}));

vi.mock("../../../cf/[month]/page-title", () => ({
  formatCashFlowPageTitle: (month: string) => month,
}));

import { generateStaticParams } from "./page";

describe("profile scoped cash-flow static params", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAllGroups.mockResolvedValue([
      { id: "profile_a:0", isCurrent: true },
      { id: "profile_a:history", isCurrent: false },
    ]);
    mocks.getDashboardProfiles.mockResolvedValue([{ id: "profile_a" }]);
    mocks.getAvailableMonths.mockImplementation(async (scope: string) =>
      scope === "profile--profile_a" || scope === "profile_a:0"
        ? [{ month: "2026-07" }]
        : [{ month: "2025-07" }],
    );
  });

  it("current profileと過去groupの月別routeを生成する", async () => {
    await expect(generateStaticParams()).resolves.toEqual([
      { groupId: "profile--profile_a", month: "2026-07" },
      { groupId: "profile_a:0", month: "2026-07" },
      { groupId: "profile_a:history", month: "2025-07" },
    ]);
  });
});
