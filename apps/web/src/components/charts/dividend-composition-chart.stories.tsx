import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { DividendCompositionChart } from "./dividend-composition-chart";

const meta = {
  title: "Charts/DividendCompositionChart",
  component: DividendCompositionChart,
  tags: ["autodocs"],
} satisfies Meta<typeof DividendCompositionChart>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Industry: Story = {
  args: {
    title: "業種別内訳",
    rows: [
      { label: "輸送用機器", amount: 120000, ratioPct: 60 },
      { label: "情報・通信業", amount: 80000, ratioPct: 40 },
    ],
  },
};

export const Empty: Story = {
  args: { title: "業種別内訳", rows: [] },
};
