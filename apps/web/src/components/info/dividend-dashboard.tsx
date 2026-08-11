import {
  getDividendDashboardData,
  getDividendSecurityDetail,
  toDividendCsv,
  type DividendQueryOptions,
} from "@mf-dashboard/db/queries/dividend";
import { DividendDashboardClient, type DashboardView } from "./dividend-dashboard.client";

interface DividendDashboardProps extends Omit<DividendQueryOptions, "view"> {
  groupId?: string;
  securityCode?: string;
  queryString?: string;
  view?: DashboardView;
}

export async function DividendDashboard({
  groupId,
  securityCode,
  queryString = "",
  year,
  includeForecast = true,
  view = "security",
  granularity = "month",
}: DividendDashboardProps) {
  const data = await getDividendDashboardData(groupId, {
    year,
    includeForecast,
    // Market-data queries do not currently branch on the display-only breakdown views.
    view: view === "timeline" ? "timeline" : "security",
    granularity,
  });
  const detail = securityCode
    ? await getDividendSecurityDetail(securityCode, groupId, { year, includeForecast })
    : null;
  const staticDemo = process.env.NEXT_PUBLIC_STATIC_DEMO_BUILD === "true";
  const prefetchedDetails = staticDemo
    ? Object.fromEntries(
        await Promise.all(
          data.securities.map(async (security) => {
            const securityDetail = await getDividendSecurityDetail(security.code, groupId, {
              year,
              includeForecast: true,
            });
            return [security.code, securityDetail] as const;
          }),
        ),
      )
    : detail
      ? { [detail.code]: detail }
      : {};

  return (
    <DividendDashboardClient
      data={data}
      detail={detail}
      prefetchedDetails={prefetchedDetails}
      staticDemo={staticDemo}
      csvWithForecast={toDividendCsv(data, true)}
      csvActualOnly={toDividendCsv(data, false)}
      queryString={queryString}
      initialIncludeForecast={includeForecast}
      initialView={view}
      initialGranularity={granularity}
    />
  );
}
