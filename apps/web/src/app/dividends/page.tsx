import type { DividendGranularity, DividendView } from "@mf-dashboard/db/queries/dividend";
import type { Metadata } from "next";
import { DividendDashboard } from "../../components/info/dividend-dashboard";
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

function parseView(value: string | undefined): DividendView | undefined {
  return value === "timeline" || value === "security" ? value : undefined;
}

function parseGranularity(value: string | undefined): DividendGranularity | undefined {
  return value === "year" || value === "month" ? value : undefined;
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
      />
    </PageLayout>
  );
}

export default async function DividendsPage({ searchParams }: { searchParams: SearchParams }) {
  return <DividendContent searchParams={await searchParams} />;
}
