export const DEFAULT_HISTORY_MAX_MONTHS = 360;
const MAX_HISTORY_MAX_MONTHS = 600;

export function parseHistoryMaxMonths(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return DEFAULT_HISTORY_MAX_MONTHS;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_HISTORY_MAX_MONTHS) {
    throw new Error(
      `HISTORY_MAX_MONTHS must be an integer between 1 and ${MAX_HISTORY_MAX_MONTHS}`,
    );
  }
  return parsed;
}

export function resolveHistoryFetchPolicy({
  forceHistory,
  existingAccountMfIds,
  registeredAccountMfIds,
}: {
  forceHistory: boolean;
  existingAccountMfIds: ReadonlySet<string>;
  registeredAccountMfIds: readonly string[];
}): { shouldFetchHistory: boolean; newAccountCount: number } {
  const newAccountCount = new Set(
    registeredAccountMfIds.filter((mfId) => mfId && !existingAccountMfIds.has(mfId)),
  ).size;

  return {
    shouldFetchHistory: forceHistory || newAccountCount > 0,
    newAccountCount,
  };
}
