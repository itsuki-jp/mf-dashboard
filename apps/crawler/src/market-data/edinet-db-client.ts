import type { SecurityCodeCandidate } from "./security-code.js";

const DEFAULT_BASE_URL = "https://edinetdb.jp/v1";

type EdinetForecastShareBasis = "pre_split" | "post_split" | "indeterminate";

export interface EdinetForecastDoe {
  adjusted_forecast_dividend_per_share?: number | null;
  forecast_dividend_per_share?: number | null;
  forecast_dividend_total?: number | null;
  forecast_fiscal_year?: number | null;
  forecast_share_basis?: EdinetForecastShareBasis | null;
  forecast_split_adjustment_factor?: number | null;
  source_disclosure_date?: string | null;
  source_quarter?: string | null;
  value?: number | null;
}

export interface EdinetCompany {
  edinet_code: string;
  sec_code: string | number | null;
  name: string;
  industry?: string | null;
  listing_status?: string | null;
  is_delisted?: boolean | null;
  forecast_doe?: EdinetForecastDoe | null;
}

export interface EdinetFinancial {
  fiscal_year: number;
  dividend_per_share?: number | null;
  adjusted_dividend_per_share?: number | null;
  adjusted_interim_dividend_per_share?: number | null;
  adjusted_yearend_dividend_per_share?: number | null;
  dividends_total_announced?: number | null;
  submit_date?: string | null;
}

export interface EdinetUsage {
  daily_limit?: number | null;
  daily_remaining?: number | null;
  today_count?: number | null;
  monthly_limit?: number | null;
  monthly_remaining?: number | null;
  plan?: string | null;
}

export class EdinetDbApiError extends Error {
  constructor(
    message: string,
    readonly kind: "configuration" | "network" | "timeout" | "http" | "invalid_json",
    readonly status?: number,
  ) {
    super(message);
    this.name = "EdinetDbApiError";
  }
}

export interface EdinetDbClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export class EdinetDbClient {
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: EdinetDbClientOptions) {
    if (!options.apiKey.trim()) {
      throw new EdinetDbApiError("EDINET DB API key is not configured", "configuration");
    }
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.fetcher = options.fetcher ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  async findCompaniesBySecurityCode(code: string): Promise<SecurityCodeCandidate[]> {
    return this.request<SecurityCodeCandidate[]>("/companies", { sec_code: code });
  }

  async getCompany(edinetCode: string): Promise<EdinetCompany> {
    return this.request<EdinetCompany>(`/companies/${encodeURIComponent(edinetCode)}`, {
      fields: "profile,forecast_doe",
    });
  }

  async getFinancials(edinetCode: string, years = 6): Promise<EdinetFinancial[]> {
    return this.request<EdinetFinancial[]>(
      `/companies/${encodeURIComponent(edinetCode)}/financials`,
      { years: String(years) },
    );
  }

  async getEarnings(edinetCode: string, limit = 8): Promise<Record<string, unknown>[]> {
    return this.request<Record<string, unknown>[]>(
      `/companies/${encodeURIComponent(edinetCode)}/earnings`,
      { limit: String(limit) },
    );
  }

  async getUsage(): Promise<EdinetUsage> {
    return this.request<EdinetUsage>("/usage");
  }

  private async request<T>(path: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(params ?? {})) url.searchParams.set(key, value);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetcher(url, {
        method: "GET",
        headers: { Accept: "application/json", "X-API-Key": this.options.apiKey },
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new EdinetDbApiError("EDINET DB request timed out", "timeout");
      }
      throw new EdinetDbApiError("EDINET DB request failed", "network");
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const kind = response.status === 429 ? "http" : "http";
      throw new EdinetDbApiError("EDINET DB returned an HTTP error", kind, response.status);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new EdinetDbApiError(
        "EDINET DB returned invalid JSON",
        "invalid_json",
        response.status,
      );
    }
    if (!isRecord(body) || !("data" in body)) {
      throw new EdinetDbApiError("EDINET DB returned an invalid response envelope", "invalid_json");
    }
    return body.data as T;
  }
}

export function createEdinetDbClient(): EdinetDbClient | null {
  const apiKey = process.env.EDINETDB_KEY?.trim();
  if (!apiKey) return null;
  return new EdinetDbClient({
    apiKey,
    baseUrl: process.env.EDINETDB_BASE_URL,
  });
}
