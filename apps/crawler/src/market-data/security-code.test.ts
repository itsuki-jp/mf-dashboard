import { describe, expect, it } from "vitest";
import { normalizeSecurityCode, resolveSecurityCode } from "./security-code.js";

describe("normalizeSecurityCode", () => {
  it("trims, uppercases, and removes the market suffix", () => {
    expect(normalizeSecurityCode(" 7203.t ")).toBe("7203");
  });

  it("rejects names and unsupported code shapes", () => {
    expect(normalizeSecurityCode("Toyota")).toBeNull();
    expect(normalizeSecurityCode("123")).toBeNull();
    expect(normalizeSecurityCode("ABCDE")).toBeNull();
  });
});

describe("resolveSecurityCode", () => {
  it("accepts one listed candidate including the trailing-zero form", () => {
    const result = resolveSecurityCode("7203", [
      {
        edinet_code: "E00001",
        sec_code: "72030",
        name: "Company A",
        listing_status: "listed",
        is_delisted: false,
      },
    ]);
    expect(result.status).toBe("resolved");
    expect(result.candidate?.edinet_code).toBe("E00001");
  });

  it("does not guess when candidates are ambiguous or delisted", () => {
    expect(
      resolveSecurityCode("7203", [
        {
          edinet_code: "E00001",
          sec_code: "7203",
          name: "Company A",
          listing_status: "listed",
          is_delisted: false,
        },
        {
          edinet_code: "E00002",
          sec_code: "72030",
          name: "Company B",
          listing_status: "listed",
          is_delisted: false,
        },
      ]).status,
    ).toBe("ambiguous_match");
    expect(
      resolveSecurityCode("7203", [
        {
          edinet_code: "E00003",
          sec_code: "7203",
          name: "Company C",
          listing_status: "delisted",
          is_delisted: true,
        },
      ]).status,
    ).toBe("unresolved");
  });
});
