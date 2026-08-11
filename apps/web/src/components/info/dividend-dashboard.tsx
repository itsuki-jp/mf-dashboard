import {
  getDividendDashboardData,
  getDividendSecurityDetail,
  toDividendCsv,
  type DividendQueryOptions,
} from "@mf-dashboard/db/queries/dividend";
import { DividendDashboardClient } from "./dividend-dashboard.client";

interface DividendDashboardProps extends DividendQueryOptions {
  groupId?: string;
  securityCode?: string;
}

export async function DividendDashboard({
  groupId,
  securityCode,
  year,
  includeForecast = true,
  view = "security",
  granularity = "month",
}: DividendDashboardProps) {
  const data = await getDividendDashboardData(groupId, {
    year,
    includeForecast,
    view,
    granularity,
  });
  const detail = securityCode
    ? await getDividendSecurityDetail(securityCode, groupId, { year, includeForecast })
    : null;

  return (
    <DividendDashboardClient
      data={data}
      detail={detail}
      csv={toDividendCsv(data)}
      initialIncludeForecast={includeForecast}
      initialView={view}
      initialGranularity={granularity}
    />
  );
}
