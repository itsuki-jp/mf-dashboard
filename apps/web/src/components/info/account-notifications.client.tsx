"use client";

import { NotificationButton } from "../ui/notification-button";
import { NotificationPopover } from "../ui/notification-popover";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";

interface Account {
  id: number;
  profileId?: string;
  profileName?: string;
  mfId: string;
  name: string;
  status: string;
}

interface AccountNotificationsClientProps {
  errorAccounts: Account[];
  updatingAccounts: Account[];
  totalIssues: number;
}

export function AccountNotificationsClient({
  errorAccounts,
  updatingAccounts,
  totalIssues,
}: AccountNotificationsClientProps) {
  return (
    <Popover>
      <PopoverTrigger>
        <NotificationButton count={totalIssues} />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-2xs">
        <NotificationPopover errorAccounts={errorAccounts} updatingAccounts={updatingAccounts} />
      </PopoverContent>
    </Popover>
  );
}
