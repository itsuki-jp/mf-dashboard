import { describe, expect, it } from "vitest";
import { createProfileScopeId, parseProfileScopeId } from "./profile-scope";

describe("profile scope", () => {
  it("DBのprofile scope規約と同じURL segmentを生成する", () => {
    expect(createProfileScopeId("profile_a")).toBe("profile--profile_a");
    expect(parseProfileScopeId("profile--profile_a")).toBe("profile_a");
  });

  it.each(["profile--", "profile--Profile-A", "profile--../profile-a", "group-a"])(
    "不正なscopeを受け入れない: %s",
    (scopeId) => expect(parseProfileScopeId(scopeId)).toBeNull(),
  );
});
