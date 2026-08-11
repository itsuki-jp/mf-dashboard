import { describe, expect, it } from "vitest";
import { buildGroupSelectionPath } from "./group-selector.client";

describe("buildGroupSelectionPath", () => {
  it("scopeに依存しないqueryとhashを保ち、scope依存queryを削除する", () => {
    expect(
      buildGroupSelectionPath(
        "/group-a/dividends",
        "group-b",
        "view=yield&product=stock&year=2026&account=account-a&includeForecast=1&security=1234&granularity=monthly",
        "#breakdown",
      ),
    ).toBe(
      "/group-b/dividends?granularity=monthly&includeForecast=1&view=yield&year=2026#breakdown",
    );
  });

  it("queryがない既存のpathname-only呼び出しを保つ", () => {
    expect(buildGroupSelectionPath("/group-a/cf/2026-07", "group-b")).toBe("/group-b/cf/2026-07");
  });
});
