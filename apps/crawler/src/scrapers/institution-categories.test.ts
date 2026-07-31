import { mfUrls } from "@mf-dashboard/meta/urls";
import type { Page } from "playwright";
import { describe, expect, test, vi } from "vitest";
import {
  associateInstitutionCategories,
  type InstitutionCategoryEntry,
  scrapeInstitutionCategories,
} from "./institution-categories.js";

describe("associateInstitutionCategories", () => {
  test("各口座一覧の見出しを後続アカウントへ関連付ける", () => {
    const lists: InstitutionCategoryEntry[][] = [
      [
        { type: "category", category: "Category A" },
        { type: "account", mfId: "account-a" },
        { type: "account", mfId: "account-b" },
      ],
      [
        { type: "category", category: "Category B" },
        { type: "account", mfId: "account-c" },
      ],
    ];

    expect(associateInstitutionCategories(lists)).toEqual([
      { mfId: "account-a", category: "Category A" },
      { mfId: "account-b", category: "Category A" },
      { mfId: "account-c", category: "Category B" },
    ]);
  });

  test("最初の見出しより前・空の見出しより後・IDなしのアカウントを除外する", () => {
    const lists: InstitutionCategoryEntry[][] = [
      [
        { type: "account", mfId: "before-heading" },
        { type: "category", category: "Category A" },
        { type: "account", mfId: null },
        { type: "account", mfId: "account-a" },
        { type: "category", category: "" },
        { type: "account", mfId: "after-empty-heading" },
      ],
    ];

    expect(associateInstitutionCategories(lists)).toEqual([
      { mfId: "account-a", category: "Category A" },
    ]);
  });
});

describe("scrapeInstitutionCategories", () => {
  test("必要な口座一覧のDOMを待ってからカテゴリーを抽出する", async () => {
    const waitFor = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const first = vi.fn<() => { waitFor: typeof waitFor }>().mockReturnValue({ waitFor });
    const count = vi.fn<() => Promise<number>>().mockResolvedValue(1);
    const locator = vi
      .fn<(selector: string) => { count?: typeof count; first?: typeof first }>()
      .mockImplementation((selector) =>
        selector === ".facilities.accounts-list" ? { count } : { first },
      );
    const goto = vi.fn<() => Promise<null>>().mockResolvedValue(null);
    const evaluate = vi.fn<() => Promise<InstitutionCategoryEntry[][]>>().mockResolvedValue([
      [
        { type: "category", category: "Category A" },
        { type: "account", mfId: "account-a" },
      ],
    ]);
    const mockPage = { evaluate, goto, locator } as unknown as Page;

    const result = await scrapeInstitutionCategories(mockPage);

    expect(goto).toHaveBeenCalledWith(mfUrls.home, { waitUntil: "domcontentloaded" });
    expect(locator).toHaveBeenCalledWith(
      ".facilities.accounts-list, .heading-no-service, .no-service",
    );
    expect(first).toHaveBeenCalledOnce();
    expect(waitFor).toHaveBeenCalledWith({ state: "attached" });
    expect(evaluate).toHaveBeenCalledOnce();
    expect(result).toEqual(new Map([["account-a", "Category A"]]));
  });

  test("連携サービスなしが明示されていれば空のカテゴリーmapを返す", async () => {
    const waitFor = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const first = vi.fn<() => { waitFor: typeof waitFor }>().mockReturnValue({ waitFor });
    const count = vi.fn<() => Promise<number>>().mockResolvedValue(0);
    const locator = vi.fn((selector: string) => {
      if (selector === ".facilities.accounts-list") return { count };
      return { first };
    });
    const goto = vi.fn<() => Promise<null>>().mockResolvedValue(null);
    const evaluate = vi.fn();
    const mockPage = { evaluate, goto, locator } as unknown as Page;

    await expect(scrapeInstitutionCategories(mockPage)).resolves.toEqual(new Map());

    expect(locator).toHaveBeenCalledWith(
      ".facilities.accounts-list, .heading-no-service, .no-service",
    );
    expect(count).toHaveBeenCalledOnce();
    expect(evaluate).not.toHaveBeenCalled();
  });
});
