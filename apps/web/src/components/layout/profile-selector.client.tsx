"use client";

import { Select as BaseSelect } from "@base-ui/react/select";
import { Check, ChevronDown, Layers3 } from "lucide-react";
import type { Route } from "next";
import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import { formatLastUpdated } from "../../lib/format";
import { createProfileScopeId, parseProfileScopeId } from "../../lib/profile-scope";
import { buildGroupPath, extractGroupIdFromPath, extractPagePath } from "../../lib/url";
import { cn } from "../../lib/utils";

export interface DashboardProfileOption {
  id: string;
  name: string;
  lastScrapedAt: string | null;
  lastStatus: string | null;
  currentGroupId: string | null;
}

interface ProfileSelectorClientProps {
  profiles: DashboardProfileOption[];
  groupProfiles: Array<{ groupId: string; profileId: string }>;
}

export const ALL_PROFILES_VALUE = "all-profiles:";

export function profileIdFromSelectionValue(value: string): string | null {
  return value === ALL_PROFILES_VALUE ? null : value;
}

export function buildProfileSelectionPath(pathname: string, profileId: string | null): string {
  const pagePath = extractPagePath(pathname);
  // Account IDs are profile-local. There is no unambiguous all-profile detail URL,
  // so return to the aggregate account list when clearing the profile scope.
  if (/^accounts\/[^/]+$/.test(pagePath)) {
    return buildGroupPath(profileId ? createProfileScopeId(profileId) : null, "accounts");
  }
  return buildGroupPath(profileId ? createProfileScopeId(profileId) : null, pagePath);
}

function statusLabel(status: string | null): string | null {
  switch (status) {
    case "success":
      return "成功";
    case "partial_success":
      return "一部失敗";
    case "auth_failed":
      return "認証失敗";
    case "scrape_failed":
    case "failed":
      return "取得失敗";
    case "running":
      return "更新中";
    default:
      return null;
  }
}

export function ProfileSelectorClient({ profiles, groupProfiles }: ProfileSelectorClientProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const scopeId = extractGroupIdFromPath(pathname);
  const selectedProfileId = scopeId
    ? (parseProfileScopeId(scopeId) ??
      groupProfiles.find((group) => group.groupId === scopeId)?.profileId ??
      null)
    : null;
  const selectedValue = selectedProfileId ?? ALL_PROFILES_VALUE;
  const selectedName =
    profiles.find((profile) => profile.id === selectedProfileId)?.name ?? "すべて";

  function handleChange(value: string | null) {
    if (!value) return;
    startTransition(() =>
      router.push(buildProfileSelectionPath(pathname, profileIdFromSelectionValue(value)) as Route),
    );
  }

  return (
    <BaseSelect.Root value={selectedValue} onValueChange={handleChange}>
      <BaseSelect.Trigger
        aria-label="表示対象のプロフィールを選択"
        className={cn(
          "flex min-w-0 items-center gap-2 rounded-lg px-3 py-1 text-sm font-medium",
          "cursor-pointer transition-colors hover:bg-muted",
          isPending && "pointer-events-none opacity-70",
        )}
      >
        <Layers3 className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="hidden text-xs text-muted-foreground sm:inline">表示対象</span>
        <span className="max-w-28 truncate sm:max-w-36">{selectedName}</span>
        <BaseSelect.Icon className="flex shrink-0">
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </BaseSelect.Icon>
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner className="z-50">
          <BaseSelect.Popup className="min-w-56 overflow-hidden rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg">
            <BaseSelect.Item
              value={ALL_PROFILES_VALUE}
              className="relative flex cursor-pointer items-center rounded-md py-2 pl-8 pr-3 text-sm outline-none focus:bg-accent data-[highlighted]:bg-accent"
            >
              <BaseSelect.ItemIndicator className="absolute left-2">
                <Check className="h-4 w-4 text-primary" />
              </BaseSelect.ItemIndicator>
              <BaseSelect.ItemText>すべて</BaseSelect.ItemText>
            </BaseSelect.Item>
            {profiles.map((profile) => {
              const label = statusLabel(profile.lastStatus);
              const updatedAt = formatLastUpdated(profile.lastScrapedAt, true);
              const details = [
                label,
                updatedAt ?? (profile.lastScrapedAt ? null : "未取得"),
              ].filter((value): value is string => value !== null);
              return (
                <BaseSelect.Item
                  key={profile.id}
                  value={profile.id}
                  className="relative flex cursor-pointer items-center justify-between gap-3 rounded-md py-2 pl-8 pr-3 text-sm outline-none focus:bg-accent data-[highlighted]:bg-accent"
                >
                  <BaseSelect.ItemIndicator className="absolute left-2">
                    <Check className="h-4 w-4 text-primary" />
                  </BaseSelect.ItemIndicator>
                  <BaseSelect.ItemText className="truncate">{profile.name}</BaseSelect.ItemText>
                  {details.length > 0 && (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {details.join(" · ")}
                    </span>
                  )}
                </BaseSelect.Item>
              );
            })}
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}
