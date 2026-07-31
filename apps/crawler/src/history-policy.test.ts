import { describe, expect, test } from "vitest";
import {
  DEFAULT_HISTORY_MAX_MONTHS,
  parseHistoryMaxMonths,
  resolveHistoryFetchPolicy,
} from "./history-policy.js";

describe("resolveHistoryFetchPolicy", () => {
  test("明示的な全期間取得を優先する", () => {
    expect(
      resolveHistoryFetchPolicy({
        forceHistory: true,
        existingAccountMfIds: new Set(["account-a"]),
        registeredAccountMfIds: ["account-a"],
      }),
    ).toEqual({ shouldFetchHistory: true, newAccountCount: 0 });
  });

  test("未登録の口座またはカードがあれば全期間取得に切り替える", () => {
    expect(
      resolveHistoryFetchPolicy({
        forceHistory: false,
        existingAccountMfIds: new Set(["account-a"]),
        registeredAccountMfIds: ["account-a", "account-b"],
      }),
    ).toEqual({ shouldFetchHistory: true, newAccountCount: 1 });
  });

  test("登録済み口座だけなら通常の当月取得を維持する", () => {
    expect(
      resolveHistoryFetchPolicy({
        forceHistory: false,
        existingAccountMfIds: new Set(["account-a", "account-b"]),
        registeredAccountMfIds: ["account-a", "account-b"],
      }),
    ).toEqual({ shouldFetchHistory: false, newAccountCount: 0 });
  });
});

describe("parseHistoryMaxMonths", () => {
  test("未指定時は全期間探索用の安全上限を使う", () => {
    expect(parseHistoryMaxMonths(undefined)).toBe(DEFAULT_HISTORY_MAX_MONTHS);
  });

  test("環境変数で安全上限を拡張できる", () => {
    expect(parseHistoryMaxMonths("480")).toBe(480);
  });

  test.each(["0", "-1", "1.5", "601", "invalid"])("不正な値を拒否する: %s", (value) => {
    expect(() => parseHistoryMaxMonths(value)).toThrow("HISTORY_MAX_MONTHS");
  });
});
