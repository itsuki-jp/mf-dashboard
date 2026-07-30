import { describe, expect, it } from "vitest";
import {
  ALL_PROFILES_VALUE,
  buildProfileSelectionPath,
  profileIdFromSelectionValue,
} from "./profile-selector.client";

describe("buildProfileSelectionPath", () => {
  it("現在のページを保ったままprofileを切り替える", () => {
    expect(buildProfileSelectionPath("/profile--profile_a/cf/2026-07", "profile_b")).toBe(
      "/profile--profile_b/cf/2026-07",
    );
  });

  it("すべてを選ぶとscope segmentだけを外す", () => {
    expect(buildProfileSelectionPath("/profile--profile_a/accounts", null)).toBe("/accounts");
  });

  it("口座詳細ですべてを選ぶと曖昧な詳細URLではなく一覧へ戻る", () => {
    expect(buildProfileSelectionPath("/profile--profile_a/accounts/shared", null)).toBe(
      "/accounts",
    );
  });

  it("口座詳細で別profileを選ぶとmfIdを引き継がず対象profileの一覧へ移る", () => {
    expect(buildProfileSelectionPath("/profile--profile_a/accounts/shared", "profile_b")).toBe(
      "/profile--profile_b/accounts",
    );
  });

  it("Money Forward group表示からprofile表示へ切り替えられる", () => {
    expect(buildProfileSelectionPath("/profile_a%3A0/bs", "profile_b")).toBe(
      "/profile--profile_b/bs",
    );
  });
});

describe("profileIdFromSelectionValue", () => {
  it("allというprofile IDを全体表示のsentinelと区別する", () => {
    expect(profileIdFromSelectionValue("all")).toBe("all");
    expect(profileIdFromSelectionValue(ALL_PROFILES_VALUE)).toBeNull();
  });
});
