const PROFILE_ID_PATTERN = /^[a-z0-9_-]+$/;
export const PROFILE_SCOPE_PREFIX = "profile--";

export function assertValidProfileId(profileId: string): void {
  if (!PROFILE_ID_PATTERN.test(profileId) || profileId.includes("..")) {
    throw new Error("Money Forward profile ID is invalid");
  }
}

/**
 * Money ForwardのグループIDをprofile名前空間内の内部IDへ変換する。
 */
export function scopeGroupId(profileId: string, mfGroupId: string): string {
  assertValidProfileId(profileId);

  if (!mfGroupId.trim()) {
    throw new Error("Money Forward group ID must not be empty");
  }

  return `${profileId}:${mfGroupId}`;
}

export function createProfileScopeId(profileId: string): string {
  assertValidProfileId(profileId);
  return `${PROFILE_SCOPE_PREFIX}${profileId}`;
}

export function parseProfileScopeId(scopeId: string): string | null {
  if (!scopeId.startsWith(PROFILE_SCOPE_PREFIX)) return null;
  const profileId = scopeId.slice(PROFILE_SCOPE_PREFIX.length);
  try {
    assertValidProfileId(profileId);
    return profileId;
  } catch {
    return null;
  }
}
