const PROFILE_ID_PATTERN = /^[a-z0-9_-]+$/;

function assertValidProfileId(profileId: string): void {
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
