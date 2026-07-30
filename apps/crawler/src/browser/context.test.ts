import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createBrowserContext } from "./context.js";

let temporaryRoot: string;

beforeEach(async () => {
  temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "mf-browser-context-"));
});

afterEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true });
});

function browser() {
  const context = {
    setDefaultNavigationTimeout: vi.fn<(milliseconds: number) => void>(),
    setDefaultTimeout: vi.fn<(milliseconds: number) => void>(),
  };
  return {
    context,
    instance: {
      newContext: vi.fn<() => Promise<typeof context>>().mockResolvedValue(context),
    },
  };
}

describe("createBrowserContext", () => {
  test("loads only the selected profile auth state", async () => {
    await writeFile(path.join(temporaryRoot, "primary.json"), "{}", "utf8");
    const target = browser();

    await createBrowserContext(target.instance as never, {
      environment: { AUTH_STATE_ROOT: temporaryRoot },
      profileId: "primary",
      useAuthState: true,
    });

    expect(target.instance.newContext).toHaveBeenCalledWith(
      expect.objectContaining({ storageState: path.join(temporaryRoot, "primary.json") }),
    );
  });

  test("does not borrow another profile auth state", async () => {
    await writeFile(path.join(temporaryRoot, "primary.json"), "{}", "utf8");
    const target = browser();

    await createBrowserContext(target.instance as never, {
      environment: { AUTH_STATE_ROOT: temporaryRoot },
      profileId: "secondary",
      useAuthState: true,
    });

    expect(target.instance.newContext).toHaveBeenCalledWith(
      expect.objectContaining({ storageState: undefined }),
    );
  });

  test("requires a profile ID when auth-state loading is enabled", async () => {
    await expect(
      createBrowserContext(browser().instance as never, { useAuthState: true }),
    ).rejects.toThrow("profileId is required when auth state is enabled");
  });
});
