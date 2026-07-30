import path from "node:path";
import {
  getEnabledMoneyForwardProfile,
  loadMoneyForwardProfilesConfig,
} from "@mf-dashboard/crawler/profile-config";
import { launchProfileSession } from "./profile-session";

const ROOT_ENV_PATH = path.resolve(process.cwd(), "../../.env");

export async function setup() {
  try {
    process.loadEnvFile(ROOT_ENV_PATH);
  } catch {
    // CI environment
  }

  console.log("Setting up E2E tests...");
  const profile = getEnabledMoneyForwardProfile(await loadMoneyForwardProfilesConfig());
  const { browser } = await launchProfileSession(profile);

  try {
    console.log("Login successful, auth state ready");
  } finally {
    await browser.close();
  }
}
