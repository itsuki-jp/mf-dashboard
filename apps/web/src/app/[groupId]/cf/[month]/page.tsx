import {
  createProfileScopeId,
  getAllGroups,
  getAvailableMonths,
  getDashboardProfiles,
  isDatabaseAvailable,
} from "@mf-dashboard/db";
import type { Metadata } from "next";
import { CFMonthContent } from "../../../cf/[month]/page";
import { formatCashFlowPageTitle } from "../../../cf/[month]/page-title";

export async function generateStaticParams() {
  if (!isDatabaseAvailable()) return [{ groupId: "_", month: "_" }];
  const groups = await getAllGroups();
  const profiles = await getDashboardProfiles();

  const params: { groupId: string; month: string }[] = [];

  for (const profile of profiles) {
    const groupId = createProfileScopeId(profile.id);
    const months = await getAvailableMonths(groupId);
    for (const { month } of months) {
      params.push({ groupId, month });
    }
  }

  for (const group of groups) {
    const months = await getAvailableMonths(group.id);
    for (const { month } of months) {
      params.push({ groupId: group.id, month });
    }
  }

  return params.length > 0 ? params : [{ groupId: "_", month: "_" }];
}

export async function generateMetadata({
  params,
}: PageProps<"/[groupId]/cf/[month]">): Promise<Metadata> {
  const { month } = await params;
  return {
    title: formatCashFlowPageTitle(month),
  };
}

export default async function GroupCFMonthPage({ params }: PageProps<"/[groupId]/cf/[month]">) {
  const { groupId, month } = await params;

  return <CFMonthContent month={month} groupId={groupId} />;
}
