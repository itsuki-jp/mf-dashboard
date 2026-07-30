import { createProfileCredentialAccess } from "@mf-dashboard/crawler/auth/credentials";
import { loginWithAuthState } from "@mf-dashboard/crawler/auth/login";
import { hasAuthState } from "@mf-dashboard/crawler/auth/state";
import { createBrowserContext } from "@mf-dashboard/crawler/browser/context";
import {
  getEnabledMoneyForwardProfile,
  loadMoneyForwardProfilesConfig,
  resolveMoneyForwardProfilesConfigPath,
  type MoneyForwardProfile,
} from "@mf-dashboard/crawler/profile-config";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

export async function loadProfileWithAuthState(): Promise<MoneyForwardProfile | null> {
  if (!existsSync(resolveMoneyForwardProfilesConfigPath())) return null;

  const profile = getEnabledMoneyForwardProfile(await loadMoneyForwardProfilesConfig());
  return hasAuthState(profile.id) ? profile : null;
}

export async function launchProfileSession(profile: MoneyForwardProfile): Promise<{
  browser: Browser;
  context: BrowserContext;
  page: Page;
}> {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await createBrowserContext(browser, {
      profileId: profile.id,
      useAuthState: true,
    });
    const page = await context.newPage();
    await loginWithAuthState(page, context, {
      credentialAccess: createProfileCredentialAccess(profile),
      profileId: profile.id,
    });
    return { browser, context, page };
  } catch (error) {
    await browser.close();
    throw error;
  }
}
import { existsSync } from "node:fs";
