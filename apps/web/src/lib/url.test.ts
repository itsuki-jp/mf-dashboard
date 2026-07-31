import { describe, expect, it } from "vitest";
import { extractGroupIdFromPath, extractPagePath, buildGroupPath, isNavItemActive } from "./url";

describe("extractGroupIdFromPath", () => {
  it("returns null for root path", () => {
    expect(extractGroupIdFromPath("/")).toBe(null);
  });

  it("returns null for known paths without groupId", () => {
    expect(extractGroupIdFromPath("/cf")).toBe(null);
    expect(extractGroupIdFromPath("/bs")).toBe(null);
    expect(extractGroupIdFromPath("/accounts")).toBe(null);
  });

  it("returns null for known paths with trailing slash", () => {
    expect(extractGroupIdFromPath("/cf/")).toBe(null);
    expect(extractGroupIdFromPath("/cf/2024-01")).toBe(null);
  });

  it("returns groupId for group root path", () => {
    expect(extractGroupIdFromPath("/abc123")).toBe("abc123");
    expect(extractGroupIdFromPath("/abc123/")).toBe("abc123");
  });

  it("returns groupId for group sub-paths", () => {
    expect(extractGroupIdFromPath("/abc123/cf")).toBe("abc123");
    expect(extractGroupIdFromPath("/abc123/bs")).toBe("abc123");
    expect(extractGroupIdFromPath("/abc123/accounts")).toBe("abc123");
    expect(extractGroupIdFromPath("/abc123/cf/2024-01")).toBe("abc123");
    expect(extractGroupIdFromPath("/abc123/accounts/xyz")).toBe("abc123");
  });

  it("handles complex groupIds", () => {
    expect(extractGroupIdFromPath("/XyZ123AbC-test1234567")).toBe("XyZ123AbC-test1234567");
    expect(extractGroupIdFromPath("/XyZ123AbC-test1234567/cf")).toBe("XyZ123AbC-test1234567");
  });

  it("decodes profile-scoped internal group IDs", () => {
    expect(extractGroupIdFromPath("/profile_a%3A0/cf")).toBe("profile_a:0");
  });
});

describe("extractPagePath", () => {
  it("returns empty string for root path", () => {
    expect(extractPagePath("/")).toBe("");
  });

  it("returns page path for known paths without groupId", () => {
    expect(extractPagePath("/cf")).toBe("cf");
    expect(extractPagePath("/bs")).toBe("bs");
    expect(extractPagePath("/accounts")).toBe("accounts");
  });

  it("returns empty string for group root path", () => {
    expect(extractPagePath("/abc123")).toBe("");
    expect(extractPagePath("/abc123/")).toBe("");
  });

  it("returns page path for group sub-paths", () => {
    expect(extractPagePath("/abc123/cf")).toBe("cf");
    expect(extractPagePath("/abc123/bs")).toBe("bs");
    expect(extractPagePath("/abc123/accounts")).toBe("accounts");
  });

  it("handles nested paths", () => {
    expect(extractPagePath("/cf/2024-01")).toBe("cf/2024-01");
    expect(extractPagePath("/abc123/cf/2024-01")).toBe("cf/2024-01");
    expect(extractPagePath("/abc123/accounts/xyz")).toBe("accounts/xyz");
  });

  it("handles complex groupIds", () => {
    expect(extractPagePath("/XyZ123AbC-test1234567")).toBe("");
    expect(extractPagePath("/XyZ123AbC-test1234567/cf")).toBe("cf");
    expect(extractPagePath("/XyZ123AbC-test1234567/bs")).toBe("bs");
  });

  it("encodes profile-scoped internal group IDs", () => {
    expect(buildGroupPath("profile_a:0", "cf")).toBe("/profile_a%3A0/cf");
  });

  it("does not double-encode a route parameter", () => {
    expect(buildGroupPath("profile_a%3A0", "accounts/account-a")).toBe(
      "/profile_a%3A0/accounts/account-a",
    );
  });
});

describe("buildGroupPath", () => {
  it("builds path without groupId", () => {
    expect(buildGroupPath(null, "cf")).toBe("/cf");
    expect(buildGroupPath(undefined, "cf")).toBe("/cf");
    expect(buildGroupPath(null, "")).toBe("/");
  });

  it("builds path with groupId", () => {
    expect(buildGroupPath("abc123", "cf")).toBe("/abc123/cf");
    expect(buildGroupPath("abc123", "bs")).toBe("/abc123/bs");
    expect(buildGroupPath("abc123", "")).toBe("/abc123");
  });

  it("handles complex groupIds", () => {
    expect(buildGroupPath("XyZ123AbC-test1234567", "cf")).toBe("/XyZ123AbC-test1234567/cf");
  });
});

describe("isNavItemActive", () => {
  describe("without groupId", () => {
    it("matches dashboard at root", () => {
      expect(isNavItemActive("/", "", null)).toBe(true);
      expect(isNavItemActive("/cf", "", null)).toBe(false);
    });

    it("matches cf pages", () => {
      expect(isNavItemActive("/cf", "cf", null)).toBe(true);
      expect(isNavItemActive("/cf/", "cf", null)).toBe(true);
      expect(isNavItemActive("/cf/2024-01", "cf", null)).toBe(true);
      expect(isNavItemActive("/", "cf", null)).toBe(false);
    });

    it("matches bs pages", () => {
      expect(isNavItemActive("/bs", "bs", null)).toBe(true);
      expect(isNavItemActive("/cf", "bs", null)).toBe(false);
    });

    it("matches accounts pages", () => {
      expect(isNavItemActive("/accounts", "accounts", null)).toBe(true);
      expect(isNavItemActive("/accounts/xyz", "accounts", null)).toBe(true);
    });
  });

  describe("with groupId", () => {
    const groupId = "abc123";

    it("matches dashboard at group root", () => {
      expect(isNavItemActive("/abc123", "", groupId)).toBe(true);
      expect(isNavItemActive("/abc123/", "", groupId)).toBe(true);
      expect(isNavItemActive("/abc123/cf", "", groupId)).toBe(false);
    });

    it("matches cf pages", () => {
      expect(isNavItemActive("/abc123/cf", "cf", groupId)).toBe(true);
      expect(isNavItemActive("/abc123/cf/", "cf", groupId)).toBe(true);
      expect(isNavItemActive("/abc123/cf/2024-01", "cf", groupId)).toBe(true);
      expect(isNavItemActive("/abc123", "cf", groupId)).toBe(false);
    });

    it("matches bs pages", () => {
      expect(isNavItemActive("/abc123/bs", "bs", groupId)).toBe(true);
      expect(isNavItemActive("/abc123/cf", "bs", groupId)).toBe(false);
    });

    it("matches accounts pages", () => {
      expect(isNavItemActive("/abc123/accounts", "accounts", groupId)).toBe(true);
      expect(isNavItemActive("/abc123/accounts/xyz", "accounts", groupId)).toBe(true);
    });
  });
});
