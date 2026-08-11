import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { DividendContent } from "./page";

vi.mock("../../components/info/dividend-dashboard", () => ({
  DividendDashboard: ({ view, queryString }: { view?: string; queryString?: string }) => (
    <output data-testid="dashboard" data-query={queryString}>
      {view}
    </output>
  ),
}));

vi.mock("../../components/layout/page-layout", () => ({
  PageLayout: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

describe("DividendContent", () => {
  it.each([
    ["industry", "granularity=month&includeForecast=1&view=industry"],
    ["yield", "granularity=month&includeForecast=1&view=yield"],
  ] as const)("keeps the %s display view after a server reload", async (view, queryString) => {
    render(await DividendContent({ searchParams: { view } }));

    const dashboard = screen.getByTestId("dashboard");
    expect(dashboard.textContent).toBe(view);
    expect(dashboard.dataset.query).toBe(queryString);
  });
});
