type SecurityCodeResolutionStatus =
  | "resolved"
  | "unsupported"
  | "unresolved"
  | "ambiguous_match";

export interface SecurityCodeCandidate {
  edinet_code: string;
  sec_code: string | number | null;
  name: string;
  industry?: string | null;
  listing_status?: string | null;
  is_delisted?: boolean | null;
}

export interface SecurityCodeResolution {
  normalizedCode: string;
  status: SecurityCodeResolutionStatus;
  candidate: SecurityCodeCandidate | null;
}

export function normalizeSecurityCode(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toUpperCase().replace(/\.T$/, "");
  if (!/^[A-Z0-9]{4}$/.test(normalized) || !/[0-9]/.test(normalized)) return null;
  return normalized;
}

function normalizedCandidateCode(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim().toUpperCase().replace(/\.T$/, "");
  if (/^[A-Z0-9]{4}$/.test(normalized)) return normalized;
  if (/^[A-Z0-9]{5}$/.test(normalized) && normalized.endsWith("0")) {
    return normalized.slice(0, -1);
  }
  return null;
}

export function resolveSecurityCode(
  value: string | null | undefined,
  candidates: readonly SecurityCodeCandidate[],
): SecurityCodeResolution {
  const normalizedCode = normalizeSecurityCode(value);
  if (!normalizedCode) {
    return {
      normalizedCode: value?.trim().toUpperCase() ?? "",
      status: "unsupported",
      candidate: null,
    };
  }

  const matches = candidates.filter((candidate) => {
    const code = normalizedCandidateCode(candidate.sec_code);
    return (
      code === normalizedCode &&
      candidate.listing_status === "listed" &&
      candidate.is_delisted !== true
    );
  });
  if (matches.length === 1) {
    return { normalizedCode, status: "resolved", candidate: matches[0] ?? null };
  }
  return {
    normalizedCode,
    status: matches.length > 1 ? "ambiguous_match" : "unresolved",
    candidate: null,
  };
}
