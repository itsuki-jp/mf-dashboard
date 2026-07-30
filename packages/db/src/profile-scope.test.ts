import { describe, expect, it } from "vitest";
import { createProfileScopeId, parseProfileScopeId, scopeGroupId } from "./profile-scope";

describe("scopeGroupId", () => {
  it("profile IDとraw group IDを衝突しない内部IDへ変換する", () => {
    expect(scopeGroupId("user-a", "group-001")).toBe("user-a:group-001");
    expect(scopeGroupId("user-b", "group-001")).toBe("user-b:group-001");
  });

  it("空でないraw group IDは値を変更せず保持する", () => {
    expect(scopeGroupId("user-a", "  group-001  ")).toBe("user-a:  group-001  ");
  });

  it.each(["", "User-A", "user.a", "../user-a", "user/a", "user\\a", "user a"])(
    "不正なprofile IDを拒否する: %s",
    (profileId) => {
      expect(() => scopeGroupId(profileId, "group-001")).toThrow(
        "Money Forward profile ID is invalid",
      );
    },
  );

  it.each(["", " ", "\t", "\n"])("空のraw group IDを拒否する", (mfGroupId) => {
    expect(() => scopeGroupId("user-a", mfGroupId)).toThrow(
      "Money Forward group ID must not be empty",
    );
  });
});

describe("profile scope ID", () => {
  it("profile IDをURL-safeな表示scopeへ変換し、元へ戻す", () => {
    const scopeId = createProfileScopeId("user-a");
    expect(scopeId).toBe("profile--user-a");
    expect(parseProfileScopeId(scopeId)).toBe("user-a");
  });

  it.each(["group-001", "profile--", "profile--User-A", "profile--../user-a"])(
    "profile scopeでない値を拒否する: %s",
    (scopeId) => {
      expect(parseProfileScopeId(scopeId)).toBeNull();
    },
  );
});
