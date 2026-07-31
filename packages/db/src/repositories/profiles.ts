import { eq } from "drizzle-orm";
import type { DbExecutor } from "../index";
import { schema } from "../index";
import { now } from "../utils";

export interface MoneyForwardProfileInput {
  id: string;
  name: string;
  enabled: boolean;
}

export interface MoneyForwardProfileScrapeStatus {
  /** Omit while a run is starting or failing to preserve the last successful scrape time. */
  lastScrapedAt?: string | null;
  lastStatus: string | null;
  lastError: string | null;
}

/**
 * 公開設定に含まれるprofile metadataだけを保存する。
 * credentialやSecret IDはこのrepositoryの入力・保存対象にしない。
 */
export async function upsertMoneyForwardProfile(
  db: DbExecutor,
  profile: MoneyForwardProfileInput,
): Promise<void> {
  const timestamp = now();

  await db
    .insert(schema.moneyForwardProfiles)
    .values({
      id: profile.id,
      name: profile.name,
      enabled: profile.enabled,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .onConflictDoUpdate({
      target: schema.moneyForwardProfiles.id,
      set: {
        name: profile.name,
        enabled: profile.enabled,
        updatedAt: timestamp,
      },
    })
    .run();
}

/**
 * crawlerが現在処理する唯一のprofileをDB上でもactiveにする。
 * 過去profileのデータは保持し、Webの既定queryからだけ除外する。
 */
export async function activateMoneyForwardProfile(
  db: DbExecutor,
  profile: MoneyForwardProfileInput,
): Promise<void> {
  const timestamp = now();
  await db.update(schema.moneyForwardProfiles).set({ enabled: false, updatedAt: timestamp }).run();
  await upsertMoneyForwardProfile(db, { ...profile, enabled: true });
}

/**
 * 設定ファイルを正として、DB上のprofile metadataとenabled状態を同期する。
 * credentialやSecret IDは受け取らず、設定から削除されたprofileのデータも保持する。
 */
export async function synchronizeMoneyForwardProfiles(
  db: DbExecutor,
  profiles: MoneyForwardProfileInput[],
): Promise<void> {
  const timestamp = now();
  await db.update(schema.moneyForwardProfiles).set({ enabled: false, updatedAt: timestamp }).run();
  for (const profile of profiles) {
    await upsertMoneyForwardProfile(db, profile);
  }
}

export async function updateMoneyForwardProfileScrapeStatus(
  db: DbExecutor,
  profileId: string,
  status: MoneyForwardProfileScrapeStatus,
): Promise<void> {
  await db
    .update(schema.moneyForwardProfiles)
    .set({ ...status, updatedAt: now() })
    .where(eq(schema.moneyForwardProfiles.id, profileId))
    .run();
}
