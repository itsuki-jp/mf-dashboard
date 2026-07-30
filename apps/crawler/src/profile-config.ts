import { readFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_PROFILE_CONFIG_PATH = path.resolve(
  import.meta.dirname,
  "../../../config/money-forward-profiles.json",
);
const PROFILE_ID_PATTERN = /^[a-z0-9_-]+$/;
const SECRET_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface MoneyForwardProfile {
  id: string;
  name: string;
  enabled: boolean;
  usernameSecretId: string;
  passwordSecretId: string;
  totpSecretId: string;
}

export interface MoneyForwardProfilesConfig {
  profiles: MoneyForwardProfile[];
}

type ReadConfigFile = (filePath: string, encoding: "utf8") => Promise<string>;

export function assertValidProfileId(profileId: string): void {
  if (
    !PROFILE_ID_PATTERN.test(profileId) ||
    profileId.includes("..") ||
    profileId.includes("/") ||
    profileId.includes("\\") ||
    /\s/.test(profileId)
  ) {
    throw new Error("Money Forward profile ID is invalid");
  }
}

function requireString(record: Record<string, unknown>, key: string, index: number): string {
  const value = record[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Money Forward profile ${index + 1} has an invalid ${key}`);
  }
  return value.trim();
}

function requireSecretId(record: Record<string, unknown>, key: string, index: number): string {
  const value = requireString(record, key, index);
  if (!SECRET_ID_PATTERN.test(value)) {
    throw new Error(`Money Forward profile ${index + 1} has an invalid ${key}`);
  }
  return value;
}

export function parseMoneyForwardProfilesConfig(value: unknown): MoneyForwardProfilesConfig {
  if (typeof value !== "object" || value === null || !("profiles" in value)) {
    throw new Error("Money Forward profiles config must contain profiles");
  }

  const profilesValue = value.profiles;
  if (!Array.isArray(profilesValue)) {
    throw new Error("Money Forward profiles config profiles must be an array");
  }

  const rootKeys = Object.keys(value);
  if (rootKeys.some((key) => !["$schema", "profiles"].includes(key))) {
    throw new Error("Money Forward profiles config contains an unsupported property");
  }

  const seenIds = new Set<string>();
  const profiles = profilesValue.map((candidate, index): MoneyForwardProfile => {
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
      throw new Error(`Money Forward profile ${index + 1} must be an object`);
    }

    const record = candidate as Record<string, unknown>;
    const supportedKeys = new Set([
      "enabled",
      "id",
      "name",
      "passwordSecretId",
      "totpSecretId",
      "usernameSecretId",
    ]);
    if (Object.keys(record).some((key) => !supportedKeys.has(key))) {
      throw new Error(`Money Forward profile ${index + 1} contains an unsupported property`);
    }
    const id = requireString(record, "id", index);
    assertValidProfileId(id);
    if (seenIds.has(id)) {
      throw new Error("Money Forward profile IDs must be unique");
    }
    seenIds.add(id);

    if (typeof record.enabled !== "boolean") {
      throw new Error(`Money Forward profile ${index + 1} has an invalid enabled flag`);
    }

    return {
      id,
      name: requireString(record, "name", index),
      enabled: record.enabled,
      usernameSecretId: requireSecretId(record, "usernameSecretId", index),
      passwordSecretId: requireSecretId(record, "passwordSecretId", index),
      totpSecretId: requireSecretId(record, "totpSecretId", index),
    };
  });

  const enabledProfiles = profiles.filter(({ enabled }) => enabled);
  if (enabledProfiles.length === 0) {
    throw new Error("Money Forward profiles config must enable at least one profile");
  }
  if (enabledProfiles.length > 1) {
    throw new Error(
      "Only one Money Forward profile can be enabled until profile-aware database storage is implemented",
    );
  }

  return { profiles };
}

export function resolveMoneyForwardProfilesConfigPath(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const configuredPath = environment.MF_PROFILES_CONFIG_PATH?.trim();
  if (!configuredPath) return DEFAULT_PROFILE_CONFIG_PATH;

  const repositoryRoot = path.resolve(import.meta.dirname, "../../..");
  return path.resolve(repositoryRoot, configuredPath);
}

export async function loadMoneyForwardProfilesConfig(
  environment: NodeJS.ProcessEnv = process.env,
  readConfigFile: ReadConfigFile = readFile,
): Promise<MoneyForwardProfilesConfig> {
  const configPath = resolveMoneyForwardProfilesConfigPath(environment);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readConfigFile(configPath, "utf8")) as unknown;
  } catch {
    throw new Error("Failed to load Money Forward profiles config");
  }
  return parseMoneyForwardProfilesConfig(parsed);
}

export function getEnabledMoneyForwardProfile(
  config: MoneyForwardProfilesConfig,
): MoneyForwardProfile {
  const profile = config.profiles.find(({ enabled }) => enabled);
  if (!profile) {
    throw new Error("Money Forward profiles config must enable at least one profile");
  }
  return profile;
}
