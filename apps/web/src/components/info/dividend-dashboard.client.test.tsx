import type { DividendDashboardData } from "@mf-dashboard/db/queries/dividend";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DividendDashboardClient,
  parseDividendDashboardQuery,
  serializeDividendDashboardQuery,
} from "./dividend-dashboard.client";

const fallback = {
  includeForecast: true,
  view: "security" as const,
  granularity: "month" as const,
  year: 2026,
};

const data: DividendDashboardData = {
  year: 2026,
  forecastFiscalYears: [2027],
  summary: {
    actualReceivedNet: 500,
    forecastAnnualGross: 1_000,
    forecastRemainingGross: null,
    unknownPaymentMonthGross: 1_000,
    progressPct: null,
    calculationStatus: "forecast_fiscal_year_only",
    periodBasis: "fiscal_year",
    totalStockMarketValue: 10_000,
    coveredMarketValue: 10_000,
    coveragePct: 100,
    coveredHoldingCount: 1,
    totalHoldingCount: 1,
  },
  securities: [
    {
      code: "1111",
      name: "Company A",
      industryName: "Industry A",
      marketValue: 10_000,
      quantity: 10,
      costValue: 8_000,
      forecastDps: 100,
      forecastAnnualGross: 1_000,
      forecastYieldPct: 10,
      yieldOnCostPct: 12.5,
      forecastFiscalYear: 2027,
      periodBasis: "fiscal_year",
      mappingStatus: "resolved",
      mappingSyncStatus: {
        status: "success",
        lastSuccessAt: null,
        ttlSeconds: 86_400,
        isFresh: true,
      },
      forecastSyncStatus: {
        status: "success",
        lastSuccessAt: null,
        ttlSeconds: 86_400,
        isFresh: true,
      },
      dataStatus: "covered",
    },
  ],
  receipts: [
    {
      status: "matched",
      transactionId: 1,
      date: "2026-03-01",
      netAmount: 500,
      amountBasis: "net",
      securityStatus: "security_unresolved",
    },
  ],
  industries: [],
  yieldBuckets: [],
  monthlySeries: [
    { key: "2026-03", label: "3月", actual: 500, forecast: 0, periodBasis: "calendar_year" },
  ],
  yearlySeries: [
    { key: "2026", label: "2026年", actual: 500, forecast: 0, periodBasis: "calendar_year" },
  ],
  sourceAsOf: null,
};

function renderDashboard() {
  return render(
    <DividendDashboardClient
      data={data}
      detail={null}
      prefetchedDetails={{}}
      staticDemo
      csvWithForecast={"forecast\nrow"}
      csvActualOnly={"actual\nrow"}
      queryString="granularity=month&includeForecast=1&view=security&year=2026"
      initialIncludeForecast
      initialView="security"
      initialGranularity="month"
    />,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("dividend dashboard query", () => {
  it("serializes supported controls in a stable order", () => {
    expect(
      serializeDividendDashboardQuery({
        includeForecast: false,
        view: "timeline",
        granularity: "year",
        year: 2025,
        security: "7203",
      }),
    ).toBe("granularity=year&includeForecast=0&security=7203&view=timeline&year=2025");
  });

  it("normalizes shared URLs and rejects unsupported values", () => {
    expect(
      parseDividendDashboardQuery(
        "security= 7203 &view=unknown&granularity=week&includeForecast=0&year=1999",
        fallback,
      ),
    ).toEqual({
      includeForecast: false,
      view: "security",
      granularity: "month",
      year: 2026,
      security: "7203",
    });
  });

  it("hides forecast-only views and downloads the actual-only CSV after the forecast toggle", async () => {
    const createObjectUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    renderDashboard();

    expect(screen.getByText("銘柄別配当一覧")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "予想を含む" }));

    expect(screen.getByText("受取実績（予想を除外中）")).toBeTruthy();
    expect(screen.queryByText("銘柄別配当一覧")).toBeNull();
    expect(screen.getByText(/予想一覧は表示しません/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "CSVダウンロード" }));
    const downloaded = createObjectUrl.mock.calls[0]?.[0] as Blob;
    expect(await downloaded.text()).toBe("actual\nrow");
  });
});
