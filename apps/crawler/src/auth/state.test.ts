import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { getAuthStatePath, hasAuthState, saveAuthState } from "./state.js";

let temporaryRoot: string;

beforeEach(async () => {
  temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "mf-auth-state-"));
});

afterEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true });
});

describe("getAuthStatePath", () => {
  test("returns a different file for each validated profile", () => {
    const environment = { AUTH_STATE_ROOT: temporaryRoot };

    expect(getAuthStatePath("primary", environment)).toBe(path.join(temporaryRoot, "primary.json"));
    expect(getAuthStatePath("secondary", environment)).toBe(
      path.join(temporaryRoot, "secondary.json"),
    );
  });

  test.each(["../primary", "primary/other", "primary\\other", "Primary", "profile id"])(
    "rejects an unsafe profile ID before constructing a path: %s",
    (profileId) => {
      expect(() => getAuthStatePath(profileId, { AUTH_STATE_ROOT: temporaryRoot })).toThrow(
        "Money Forward profile ID is invalid",
      );
    },
  );
});

describe("hasAuthState", () => {
  test("checks only the selected profile file", () => {
    const fileExists = vi.fn<(filePath: string) => boolean>((filePath) =>
      filePath.endsWith("primary.json"),
    );
    const environment = { AUTH_STATE_ROOT: temporaryRoot };

    expect(hasAuthState("primary", environment, fileExists)).toBe(true);
    expect(hasAuthState("secondary", environment, fileExists)).toBe(false);
    expect(fileExists).toHaveBeenNthCalledWith(1, path.join(temporaryRoot, "primary.json"));
    expect(fileExists).toHaveBeenNthCalledWith(2, path.join(temporaryRoot, "secondary.json"));
  });
});

describe("saveAuthState", () => {
  test("atomically replaces only the selected profile state after a successful write", async () => {
    const destination = path.join(temporaryRoot, "primary.json");
    await writeFile(destination, "old-state", "utf8");
    let modeDuringWrite: number | null = null;
    const context = {
      storageState: vi.fn<(options: { path: string }) => Promise<void>>(
        async ({ path: outputPath }) => {
          modeDuringWrite = (await stat(outputPath)).mode & 0o777;
          await writeFile(outputPath, "new-state", "utf8");
        },
      ),
    };

    await saveAuthState(context as unknown as Parameters<typeof saveAuthState>[0], "primary", {
      AUTH_STATE_ROOT: temporaryRoot,
    });

    await expect(readFile(destination, "utf8")).resolves.toBe("new-state");
    const expectedMode = process.platform === "win32" ? 0o666 : 0o600;
    expect(modeDuringWrite).toBe(expectedMode);
    expect((await stat(destination)).mode & 0o777).toBe(expectedMode);
    await expect(readFile(path.join(temporaryRoot, "secondary.json"), "utf8")).rejects.toThrow(
      /ENOENT/,
    );
  });

  test("preserves the existing profile state when the new state write fails", async () => {
    const destination = path.join(temporaryRoot, "primary.json");
    await writeFile(destination, "old-state", "utf8");
    const context = {
      storageState: vi.fn<(options: { path: string }) => Promise<void>>(
        async ({ path: outputPath }) => {
          await writeFile(outputPath, "partial-state", "utf8");
          throw new Error("storage state write failed");
        },
      ),
    };

    await expect(
      saveAuthState(context as unknown as Parameters<typeof saveAuthState>[0], "primary", {
        AUTH_STATE_ROOT: temporaryRoot,
      }),
    ).rejects.toThrow("storage state write failed");

    await expect(readFile(destination, "utf8")).resolves.toBe("old-state");
    const remainingFiles = await readdir(temporaryRoot);
    expect(remainingFiles).toEqual(["primary.json"]);
  });
});
