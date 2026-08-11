import {
  getDividendDashboardData,
  type DividendDashboardData,
} from "@mf-dashboard/db/queries/dividend";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { mocked } from "storybook/test";
import { DividendDashboard } from "./dividend-dashboard";

const data: DividendDashboardData = {
  year: 2026,
  forecastFiscalYears: [2026],
  summary: {
    actualReceivedNet: 60_000,
    actualReceivedConfirmedNet: 60_000,
    actualReceiptUnknownCount: 0,
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
  securities: [],
  receipts: [],
  industries: [],
  yieldBuckets: [],
  monthlySeries: [],
  yearlySeries: [],
  sourceAsOf: "2026-08-11T00:00:00.000Z",
};

const meta = {
  title: "Info/DividendDashboard/Server",
  component: DividendDashboard,
  tags: ["autodocs"],
} satisfies Meta<typeof DividendDashboard>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Server Component contract: the story invokes its DB dependency through a mocked query. */
export const Default: Story = {
  args: { groupId: undefined },
  beforeEach() {
    mocked(getDividendDashboardData).mockResolvedValue(data);
  },
};
