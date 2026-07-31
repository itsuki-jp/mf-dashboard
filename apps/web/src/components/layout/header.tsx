"use client";

import { Menu } from "lucide-react";
import Image from "next/image";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { withBasePath } from "../../lib/base-path";
import { parseProfileScopeId } from "../../lib/profile-scope";
import { extractGroupIdFromPath } from "../../lib/url";
import { IconButton } from "../ui/icon-button";
import { ActionIcons } from "./action-icons";
import { GroupSelectorDisplay, groupSelectorContainerClassName } from "./group-selector-display";
import { GroupSelectorClient, type Group } from "./group-selector.client";
import { ProfileSelectorClient, type DashboardProfileOption } from "./profile-selector.client";
import { useSidebar } from "./sidebar-context";

interface HeaderProps {
  groups: Group[];
  profiles?: DashboardProfileOption[];
  defaultGroupId: string | null;
  notifications?: ReactNode;
}

export function Header({ groups, profiles = [], defaultGroupId, notifications }: HeaderProps) {
  const { toggle } = useSidebar();
  const pathname = usePathname();
  const urlGroupId = extractGroupIdFromPath(pathname);
  const selectedProfileId = urlGroupId
    ? (parseProfileScopeId(urlGroupId) ??
      groups.find((group) => group.id === urlGroupId)?.profileId ??
      null)
    : null;
  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId) ?? null;
  const profileGroups = selectedProfileId
    ? groups.filter((group) => group.profileId === selectedProfileId)
    : [];
  const selectedGroup =
    groups.find((group) => group.id === urlGroupId) ??
    profileGroups.find((group) => group.isCurrent) ??
    (profiles.length === 0 ? groups.find((group) => group.id === defaultGroupId) : null) ??
    null;
  const allProfilesLastScrapedAt =
    profiles.length > 0 && profiles.every(({ lastScrapedAt }) => lastScrapedAt !== null)
      ? (profiles
          .map(({ lastScrapedAt }) => lastScrapedAt as string)
          .sort()
          .at(0) ?? null)
      : null;

  let groupSelector: ReactNode = null;
  const profileDefaultGroupId = selectedProfile?.currentGroupId ?? defaultGroupId;
  if (profileGroups.length > 1 && profileDefaultGroupId) {
    groupSelector = (
      <GroupSelectorClient groups={profileGroups} defaultGroupId={profileDefaultGroupId} />
    );
  } else if (selectedGroup) {
    groupSelector = (
      <div className={groupSelectorContainerClassName}>
        <GroupSelectorDisplay name={selectedGroup.name} />
      </div>
    );
  }

  return (
    <header className="fixed top-0 z-50 w-full border-b bg-card text-foreground shadow-sm">
      <div className="flex h-14 items-center justify-between px-4 md:px-6">
        <div className="flex items-center min-w-0 gap-2">
          <IconButton
            icon={<Menu className="h-5 w-5" />}
            onClick={toggle}
            ariaLabel="メニューを開く"
            className="lg:hidden shrink-0"
          />
          <Image
            src={withBasePath("/logo.png")}
            alt="Logo"
            width={758}
            height={708}
            className="hidden h-auto w-8 shrink-0 lg:block"
          />
          <div className="flex min-w-0 items-center gap-1">
            {profiles.length > 0 && (
              <ProfileSelectorClient
                profiles={profiles}
                groupProfiles={groups.map((group) => ({
                  groupId: group.id,
                  profileId: group.profileId ?? "",
                }))}
              />
            )}
            {groupSelector}
          </div>
        </div>
        <ActionIcons
          variant="header"
          notifications={notifications}
          profiles={profiles.map(({ id, name }) => ({ id, name }))}
          selectedProfileId={selectedProfileId}
          lastScrapedAt={
            selectedGroup?.lastScrapedAt ??
            selectedProfile?.lastScrapedAt ??
            allProfilesLastScrapedAt ??
            null
          }
        />
      </div>
    </header>
  );
}
