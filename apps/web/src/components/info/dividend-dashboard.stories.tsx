import type { DividendDashboardData } from "@mf-dashboard/db/queries/dividend";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { DividendDashboardClient } from "./dividend-dashboard.client";

const data: DividendDashboardData = {
  year: 2026,
  summary: {
    actualReceivedNet: 60000,
    forecastAnnualGross: 180000,
    forecastRemainingGross: null,
    unknownPaymentMonthGross: 180000,
    progressPct: null,
    calculationStatus: "forecast_fiscal_year_only",
    periodBasis: "fiscal_year",
    totalStockMarketValue: 3000000,
    coveredMarketValue: 3000000,
    coveragePct: 100,
    coveredHoldingCount: 2,
    totalHoldingCount: 2,
  },
  securities: [
    {
      code: "7203",
      name: "Company A",
      industryName: "輸送用機器",
      marketValue: 2000000,
      quantity: 100,
      costValue: 1500000,
      forecastDps: 100,
      forecastAnnualGross: 10000,
      forecastYieldPct: 0.5,
      yieldOnCostPct: 0.67,
      forecastFiscalYear: 2026,
      periodBasis: "fiscal_year",
      dataStatus: "covered",
    },
    {
      code: "6758",
      name: "Company B",
      industryName: "電気機器",
      marketValue: 1000000,
      quantity: 50,
      costValue: 800000,
      forecastDps: 3400,
      forecastAnnualGross: 170000,
      forecastYieldPct: 17,
      yieldOnCostPct: 21.25,
      forecastFiscalYear: 2026,
      periodBasis: "fiscal_year",
      dataStatus: "covered",
    },
  ],
  industries: [
    { label: "輸送用機器", amount: 10000, ratioPct: 5.56 },
    { label: "電気機器", amount: 170000, ratioPct: 94.44 },
  ],
  yieldBuckets: [{ label: "8%以上", amount: 170000, ratioPct: 94.44 }],
  monthlySeries: [
    { key: "2026-03", label: "3月", actual: 60000, forecast: 0, periodBasis: "calendar_year" },
  ],
  yearlySeries: [
    { key: "2026", label: "2026年", actual: 60000, forecast: 0, periodBasis: "calendar_year" },
  ],
  sourceAsOf: "2026-08-11T00:00:00.000Z",
};

const meta = {
  title: "Info/DividendDashboard",
  component: DividendDashboardClient,
  tags: ["autodocs"],
} satisfies Meta<typeof DividendDashboardClient>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    data,
    detail: null,
    csv: "header\nrow",
    initialIncludeForecast: true,
    initialView: "security",
    initialGranularity: "month",
  },
};
