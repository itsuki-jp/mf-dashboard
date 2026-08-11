import type { DividendGranularity } from "@mf-dashboard/db/queries/dividend";
import type { Metadata } from "next";
import { DividendDashboard } from "../../components/info/dividend-dashboard";
import type { DashboardView } from "../../components/info/dividend-dashboard.client";
import { PageLayout } from "../../components/layout/page-layout";

export const metadata: Metadata = {
  title: "配当・分配",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseYear(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const year = Number(value);
  return Number.isInteger(year) && year >= 2000 && year <= 2100 ? year : undefined;
}

function parseView(value: string | undefined): DashboardView | undefined {
  return value === "timeline" || value === "security" || value === "industry" || value === "yield"
    ? value
    : undefined;
}

function parseGranularity(value: string | undefined): DividendGranularity | undefined {
  return value === "year" || value === "month" ? value : undefined;
}

function serializeSearchParams(
  searchParams: Record<string, string | string[] | undefined> | undefined,
): string {
  const params = new URLSearchParams();
  const year = parseYear(first(searchParams?.year));
  const view = parseView(first(searchParams?.view)) ?? "security";
  const granularity = parseGranularity(first(searchParams?.granularity)) ?? "month";
  const includeForecast = first(searchParams?.includeForecast) !== "0";
  const security = first(searchParams?.security)?.trim().toUpperCase();
  // Keep the browser URL deterministic so it remains suitable for refresh, back, and sharing.
  params.set("granularity", granularity);
  params.set("includeForecast", includeForecast ? "1" : "0");
  if (security) params.set("security", security);
  params.set("view", view);
  if (year) params.set("year", String(year));
  return params.toString();
}

export async function DividendContent({
  groupId,
  searchParams,
}: {
  groupId?: string;
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const view = parseView(first(searchParams?.view));
  const granularity = parseGranularity(first(searchParams?.granularity));
  const includeForecast = first(searchParams?.includeForecast) !== "0";

  return (
    <PageLayout title="配当・分配">
      <DividendDashboard
        groupId={groupId}
        year={parseYear(first(searchParams?.year))}
        includeForecast={includeForecast}
        view={view}
        granularity={granularity}
        securityCode={first(searchParams?.security)}
        queryString={serializeSearchParams(searchParams)}
      />
    </PageLayout>
  );
}

export default async function DividendsPage({ searchParams }: { searchParams: SearchParams }) {
  const resolvedSearchParams =
    process.env.NEXT_PUBLIC_STATIC_DEMO_BUILD === "true" ? undefined : await searchParams;
  return <DividendContent searchParams={resolvedSearchParams} />;
}
