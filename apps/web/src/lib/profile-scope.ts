const PROFILE_ID_PATTERN = /^[a-z0-9_-]+$/;
const PROFILE_SCOPE_PREFIX = "profile--";

export function createProfileScopeId(profileId: string): string {
  if (!PROFILE_ID_PATTERN.test(profileId) || profileId.includes("..")) {
    throw new Error("Money Forward profile ID is invalid");
  }
  return `${PROFILE_SCOPE_PREFIX}${profileId}`;
}

export function parseProfileScopeId(scopeId: string): string | null {
  if (!scopeId.startsWith(PROFILE_SCOPE_PREFIX)) return null;
  const profileId = scopeId.slice(PROFILE_SCOPE_PREFIX.length);
  try {
    createProfileScopeId(profileId);
    return profileId;
  } catch {
    return null;
  }
}
