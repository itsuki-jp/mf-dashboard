import type { DividendDashboardData } from "@mf-dashboard/db/queries/dividend";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { DividendDashboardClient } from "./dividend-dashboard.client";

const data: DividendDashboardData = {
  year: 2026,
  forecastFiscalYears: [2026],
  summary: {
    actualReceivedNet: 60_000,
    forecastAnnualGross: 180_000,
    forecastRemainingGross: null,
    unknownPaymentMonthGross: 180_000,
    progressPct: null,
    calculationStatus: "forecast_fiscal_year_only",
    periodBasis: "fiscal_year",
    totalStockMarketValue: 3_000_000,
    coveredMarketValue: 3_000_000,
    coveragePct: 100,
    coveredHoldingCount: 2,
    totalHoldingCount: 2,
  },
  securities: [
    {
      code: "7203",
      name: "Company A",
      industryName: "輸送用機器",
      marketValue: 2_000_000,
      quantity: 100,
      costValue: 1_500_000,
      forecastDps: 100,
      forecastAnnualGross: 10_000,
      forecastYieldPct: 0.5,
      yieldOnCostPct: 0.67,
      forecastFiscalYear: 2026,
      periodBasis: "fiscal_year",
      mappingStatus: "resolved",
      mappingSyncStatus: {
        status: "success",
        lastSuccessAt: "2026-08-11T00:00:00.000Z",
        ttlSeconds: 86_400,
        isFresh: true,
      },
      forecastSyncStatus: {
        status: "success",
        lastSuccessAt: "2026-08-11T00:00:00.000Z",
        ttlSeconds: 86_400,
        isFresh: true,
      },
      dataStatus: "covered",
    },
    {
      code: "6758",
      name: "Company B",
      industryName: "電気機器",
      marketValue: 1_000_000,
      quantity: 50,
      costValue: 800_000,
      forecastDps: null,
      forecastAnnualGross: null,
      forecastYieldPct: null,
      yieldOnCostPct: null,
      forecastFiscalYear: null,
      periodBasis: null,
      mappingStatus: "unresolved",
      mappingSyncStatus: {
        status: "never_synced",
        lastSuccessAt: null,
        ttlSeconds: null,
        isFresh: false,
      },
      forecastSyncStatus: {
        status: "error",
        lastSuccessAt: null,
        ttlSeconds: null,
        isFresh: false,
      },
      dataStatus: "calculation_unavailable",
    },
  ],
  receipts: [
    {
      status: "matched",
      transactionId: 1,
      date: "2026-03-15",
      netAmount: 60_000,
      amountBasis: "net",
      securityStatus: "security_unresolved",
    },
    {
      status: "ambiguous",
      transactionId: 2,
      date: "2026-06-15",
      netAmount: null,
      amountBasis: "unknown",
      securityStatus: "security_unresolved",
    },
  ],
  industries: [{ label: "輸送用機器", amount: 10_000, ratioPct: 100 }],
  yieldBuckets: [{ label: "0–2%", amount: 10_000, ratioPct: 100 }],
  monthlySeries: [
    {
      key: "2026-03",
      label: "3月",
      actual: 60_000,
      forecast: 10_000,
      periodBasis: "calendar_year",
    },
  ],
  yearlySeries: [
    {
      key: "2026",
      label: "2026年",
      actual: 60_000,
      forecast: 10_000,
      periodBasis: "calendar_year",
    },
  ],
  sourceAsOf: "2026-08-11T00:00:00.000Z",
};

const meta = {
  title: "Info/DividendDashboard/Client",
  component: DividendDashboardClient,
  tags: ["autodocs"],
} satisfies Meta<typeof DividendDashboardClient>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    data,
    detail: null,
    prefetchedDetails: {},
    staticDemo: true,
    csvWithForecast: "header\nforecast",
    csvActualOnly: "header\nactual",
    queryString: "granularity=month&includeForecast=1&view=security&year=2026",
    initialIncludeForecast: true,
    initialView: "security",
    initialGranularity: "month",
  },
};
