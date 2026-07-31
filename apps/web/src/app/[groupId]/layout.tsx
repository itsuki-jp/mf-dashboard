import {
  getAllGroups,
  getDashboardProfiles,
  getDb,
  isDatabaseAvailable,
  resolveGroupIds,
} from "@mf-dashboard/db";
import { createProfileScopeId, parseProfileScopeId } from "@mf-dashboard/db/profile-scope";
import { notFound } from "next/navigation";

export async function generateStaticParams() {
  if (!isDatabaseAvailable()) return [{ groupId: "_" }];
  const groups = await getAllGroups();
  const profiles = await getDashboardProfiles();
  const params = [
    ...profiles.map((profile) => ({ groupId: createProfileScopeId(profile.id) })),
    ...groups.map((group) => ({ groupId: group.id })),
  ];
  return params.length > 0 ? params : [{ groupId: "_" }];
}

export default async function GroupLayout({ children, params }: LayoutProps<"/[groupId]">) {
  const { groupId } = await params;
  const profileId = parseProfileScopeId(groupId);
  const profiles = profileId ? await getDashboardProfiles() : [];
  const validScope = profileId
    ? profiles.some((profile) => profile.id === profileId)
    : (await resolveGroupIds(getDb(), groupId)).length === 1;

  if (!validScope) {
    notFound();
  }

  return <>{children}</>;
}
