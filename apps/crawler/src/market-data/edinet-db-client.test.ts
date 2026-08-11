import { describe, expect, it, vi } from "vitest";
import { EdinetDbApiError, EdinetDbClient } from "./edinet-db-client.js";

describe("EdinetDbClient", () => {
  it("uses the documented path and returns only the data envelope", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ data: [{ edinet_code: "E00001", sec_code: "7203" }], meta: {} }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    const client = new EdinetDbClient({
      apiKey: "test-key",
      baseUrl: "https://example.test/v1",
      fetcher,
    });

    await expect(client.findCompaniesBySecurityCode("7203")).resolves.toEqual([
      { edinet_code: "E00001", sec_code: "7203" },
    ]);
    expect(fetcher).toHaveBeenCalledWith(
      expect.objectContaining({ href: "https://example.test/v1/companies?sec_code=7203" }),
      expect.objectContaining({ headers: expect.objectContaining({ "X-API-Key": "test-key" }) }),
    );
  });

  it("normalizes HTTP and invalid JSON errors without exposing the key", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("nope", { status: 500 }));
    const client = new EdinetDbClient({ apiKey: "secret-key", fetcher });
    await expect(client.getUsage()).rejects.toMatchObject({ kind: "http", status: 500 });

    const invalidJsonFetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("invalid", { status: 200 }));
    const invalidJsonClient = new EdinetDbClient({
      apiKey: "secret-key",
      fetcher: invalidJsonFetcher,
    });
    const result = invalidJsonClient.getUsage();
    await expect(result).rejects.toBeInstanceOf(EdinetDbApiError);
    await expect(result).rejects.not.toThrow("secret-key");
  });

  it("returns the documented forecast split fields from the forecast_doe section", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            edinet_code: "E00001",
            sec_code: "7203",
            name: "Company A",
            forecast_doe: {
              forecast_dividend_per_share: 100,
              adjusted_forecast_dividend_per_share: 50,
              forecast_share_basis: "pre_split",
              forecast_split_adjustment_factor: 2,
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const client = new EdinetDbClient({
      apiKey: "test-key",
      baseUrl: "https://example.test/v1",
      fetcher,
    });

    await expect(client.getCompany("E00001")).resolves.toMatchObject({
      forecast_doe: {
        forecast_dividend_per_share: 100,
        adjusted_forecast_dividend_per_share: 50,
        forecast_share_basis: "pre_split",
        forecast_split_adjustment_factor: 2,
      },
    });
    expect(fetcher).toHaveBeenCalledWith(
      expect.objectContaining({
        href: "https://example.test/v1/companies/E00001?fields=profile%2Cforecast_doe",
      }),
      expect.anything(),
    );
  });
});
