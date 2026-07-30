import { existsSync } from "node:fs";
import { chmod, mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import type { BrowserContext } from "playwright";
import { debug } from "../logger.js";
import { assertValidProfileId } from "../profile-config.js";

const DEFAULT_AUTH_STATE_ROOT = path.join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "..",
  "data",
  "crawler-state",
);

export function getAuthStatePath(
  profileId: string,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  assertValidProfileId(profileId);
  const configuredRoot = environment.AUTH_STATE_ROOT?.trim();
  const repositoryRoot = path.resolve(import.meta.dirname, "../../../..");
  const authStateRoot = configuredRoot
    ? path.resolve(repositoryRoot, configuredRoot)
    : DEFAULT_AUTH_STATE_ROOT;

  return path.join(authStateRoot, `${profileId}.json`);
}

export function hasAuthState(
  profileId: string,
  environment: NodeJS.ProcessEnv = process.env,
  fileExists: (filePath: string) => boolean = existsSync,
): boolean {
  return fileExists(getAuthStatePath(profileId, environment));
}

export async function saveAuthState(
  context: BrowserContext,
  profileId: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const authStatePath = getAuthStatePath(profileId, environment);
  const temporaryPath = `${authStatePath}.tmp-${process.pid}`;
  await mkdir(path.dirname(authStatePath), { recursive: true });
  try {
    await context.storageState({ path: temporaryPath });
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, authStatePath);
    debug(`Auth state saved for profile ${profileId}`);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}
