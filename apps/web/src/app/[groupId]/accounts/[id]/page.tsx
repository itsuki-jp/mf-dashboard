import {
  createProfileScopeId,
  getAllAccountMfIds,
  getAccountByMfId,
  getAllGroups,
  getDashboardProfiles,
  isDatabaseAvailable,
} from "@mf-dashboard/db";
import type { Metadata } from "next";
import { AccountDetailContent } from "../../../accounts/[id]/page";

export async function generateStaticParams() {
  if (!isDatabaseAvailable()) return [{ groupId: "_", id: "_" }];
  const groups = await getAllGroups();
  const profiles = await getDashboardProfiles();

  const params: { groupId: string; id: string }[] = [];

  for (const profile of profiles) {
    const groupId = createProfileScopeId(profile.id);
    const mfIds = await getAllAccountMfIds(groupId);
    for (const id of mfIds) {
      params.push({ groupId, id });
    }
  }

  for (const group of groups) {
    const mfIds = await getAllAccountMfIds(group.id);
    for (const id of mfIds) {
      params.push({ groupId: group.id, id });
    }
  }

  return params.length > 0 ? params : [{ groupId: "_", id: "_" }];
}

export async function generateMetadata({
  params,
}: PageProps<"/[groupId]/accounts/[id]">): Promise<Metadata> {
  const { id, groupId } = await params;
  const account = await getAccountByMfId(id, groupId);
  return {
    title: account?.name ?? "アカウント詳細",
  };
}

export default async function GroupAccountDetailPage({
  params,
}: PageProps<"/[groupId]/accounts/[id]">) {
  const { groupId, id } = await params;

  return <AccountDetailContent id={id} groupId={groupId} />;
}
