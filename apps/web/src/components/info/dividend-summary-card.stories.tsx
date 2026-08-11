import { getDividendDashboardData } from "@mf-dashboard/db/queries/dividend";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { mocked } from "storybook/test";
import { DividendSummaryCard } from "./dividend-summary-card";

const meta = {
  title: "Info/DividendSummaryCard",
  component: DividendSummaryCard,
  tags: ["autodocs"],
} satisfies Meta<typeof DividendSummaryCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  beforeEach() {
    mocked(getDividendDashboardData).mockResolvedValue({
      year: 2026,
      forecastFiscalYears: [2026],
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
      securities: [],
      receipts: [],
      industries: [],
      yieldBuckets: [],
      monthlySeries: [],
      yearlySeries: [],
      sourceAsOf: "2026-08-11T00:00:00.000Z",
    });
  },
};

export const Unavailable: Story = {
  beforeEach() {
    mocked(getDividendDashboardData).mockResolvedValue({
      year: 2026,
      forecastFiscalYears: [],
      summary: {
        actualReceivedNet: null,
        forecastAnnualGross: null,
        forecastRemainingGross: null,
        unknownPaymentMonthGross: null,
        progressPct: null,
        calculationStatus: "data_unavailable",
        periodBasis: null,
        totalStockMarketValue: 0,
        coveredMarketValue: 0,
        coveragePct: null,
        coveredHoldingCount: 0,
        totalHoldingCount: 0,
      },
      securities: [],
      receipts: [],
      industries: [],
      yieldBuckets: [],
      monthlySeries: [],
      yearlySeries: [],
      sourceAsOf: null,
    });
  },
};
