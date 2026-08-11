import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { DividendHistoryChart } from "./dividend-history-chart";

const meta = {
  title: "Charts/DividendHistoryChart",
  component: DividendHistoryChart,
  tags: ["autodocs"],
} satisfies Meta<typeof DividendHistoryChart>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Monthly: Story = {
  args: {
    title: "月別推移",
    rows: [
      {
        key: "2026-01",
        label: "1月",
        actual: 30000,
        forecast: 20000,
        periodBasis: "calendar_year",
      },
      { key: "2026-02", label: "2月", actual: 0, forecast: 0, periodBasis: "calendar_year" },
      { key: "2026-03", label: "3月", actual: 60000, forecast: 0, periodBasis: "calendar_year" },
    ],
  },
};
