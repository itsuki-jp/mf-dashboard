import path from "node:path";
import { describe, expect, test, vi } from "vitest";
import {
  assertValidProfileId,
  getEnabledMoneyForwardProfile,
  loadMoneyForwardProfilesConfig,
  parseMoneyForwardProfilesConfig,
  resolveMoneyForwardProfilesConfigPath,
} from "./profile-config.js";

function profile(overrides: Record<string, unknown> = {}) {
  return {
    id: "primary",
    name: "Primary",
    enabled: true,
    usernameSecretId: "00000000-0000-4000-8000-000000000001",
    passwordSecretId: "00000000-0000-4000-8000-000000000002",
    totpSecretId: "00000000-0000-4000-8000-000000000003",
    ...overrides,
  };
}

describe("parseMoneyForwardProfilesConfig", () => {
  test("accepts one enabled profile and disabled future profiles", () => {
    const config = parseMoneyForwardProfilesConfig({
      profiles: [profile(), profile({ id: "secondary", name: "Secondary", enabled: false })],
    });

    expect(config.profiles).toHaveLength(2);
    expect(getEnabledMoneyForwardProfile(config).id).toBe("primary");
  });

  test.each(["", "Primary", "profile id", "../primary", "primary/x", "primary\\x", "."])(
    "rejects unsafe profile ID: %s",
    (id) => {
      expect(() => assertValidProfileId(id)).toThrow("Money Forward profile ID is invalid");
    },
  );

  test("rejects duplicate profile IDs", () => {
    expect(() =>
      parseMoneyForwardProfilesConfig({ profiles: [profile(), profile({ enabled: false })] }),
    ).toThrow("Money Forward profile IDs must be unique");
  });

  test("rejects unknown properties instead of silently ignoring typos", () => {
    expect(() =>
      parseMoneyForwardProfilesConfig({ profiles: [profile({ userNameSecretId: "typo" })] }),
    ).toThrow("Money Forward profile 1 contains an unsupported property");
  });

  test.each(["usernameSecretId", "passwordSecretId", "totpSecretId"])(
    "rejects an empty or malformed %s without including its value",
    (key) => {
      expect(() =>
        parseMoneyForwardProfilesConfig({ profiles: [profile({ [key]: "not-a-secret-id" })] }),
      ).toThrow(`Money Forward profile 1 has an invalid ${key}`);
    },
  );

  test("requires at least one enabled profile", () => {
    expect(() =>
      parseMoneyForwardProfilesConfig({ profiles: [profile({ enabled: false })] }),
    ).toThrow("Money Forward profiles config must enable at least one profile");
  });

  test("rejects multiple enabled profiles until database storage is profile-aware", () => {
    expect(() =>
      parseMoneyForwardProfilesConfig({
        profiles: [profile(), profile({ id: "secondary", name: "Secondary" })],
      }),
    ).toThrow("Only one Money Forward profile can be enabled");
  });
});

describe("loadMoneyForwardProfilesConfig", () => {
  test("keeps the committed anonymous example compatible with runtime validation", async () => {
    await expect(
      loadMoneyForwardProfilesConfig({
        MF_PROFILES_CONFIG_PATH: "./config/money-forward-profiles.example.json",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        profiles: [
          expect.objectContaining({ id: "primary", enabled: true }),
          expect.objectContaining({ id: "secondary", enabled: false }),
        ],
      }),
    );
  });

  test("resolves a configured relative path from the repository root", () => {
    expect(
      resolveMoneyForwardProfilesConfigPath({
        MF_PROFILES_CONFIG_PATH: "./config/money-forward-profiles.json",
      }),
    ).toBe(path.resolve(import.meta.dirname, "../../../config/money-forward-profiles.json"));
  });

  test("loads and validates JSON without logging its contents", async () => {
    const readConfigFile = vi
      .fn<(filePath: string, encoding: "utf8") => Promise<string>>()
      .mockResolvedValue(JSON.stringify({ profiles: [profile()] }));

    await expect(
      loadMoneyForwardProfilesConfig(
        { MF_PROFILES_CONFIG_PATH: "./config/money-forward-profiles.json" },
        readConfigFile,
      ),
    ).resolves.toEqual({ profiles: [profile()] });
    expect(readConfigFile).toHaveBeenCalledWith(
      path.resolve(import.meta.dirname, "../../../config/money-forward-profiles.json"),
      "utf8",
    );
  });

  test("redacts file and parse failures", async () => {
    const readConfigFile = vi
      .fn<(filePath: string, encoding: "utf8") => Promise<string>>()
      .mockRejectedValue(new Error("sensitive file contents"));

    await expect(loadMoneyForwardProfilesConfig({}, readConfigFile)).rejects.toThrow(
      "Failed to load Money Forward profiles config",
    );
  });
});
