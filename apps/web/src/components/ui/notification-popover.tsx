import type { Route } from "next";
import Link from "next/link";
import { createProfileScopeId } from "../../lib/profile-scope";
import { buildGroupPath } from "../../lib/url";
import { Badge } from "./badge";

interface Account {
  id: number;
  profileId?: string;
  profileName?: string;
  mfId: string;
  name: string;
  status: string;
}

function accountHref(account: Account): string {
  const path = `accounts/${account.mfId}`;
  return buildGroupPath(
    account.profileId ? createProfileScopeId(account.profileId) : undefined,
    path,
  );
}

interface NotificationPopoverProps {
  errorAccounts: Account[];
  updatingAccounts: Account[];
}

export function NotificationPopover({ errorAccounts, updatingAccounts }: NotificationPopoverProps) {
  const totalIssues = errorAccounts.length + updatingAccounts.length;

  if (totalIssues === 0) {
    return (
      <div className="space-y-3">
        <h3 className="font-semibold text-sm">通知</h3>
        <div className="flex flex-col items-center justify-center py-6 text-center">
          <p className="text-sm text-muted-foreground">通知はありません</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-semibold">ステータス</h4>
          <span className="text-xs text-muted-foreground">({totalIssues}件)</span>
        </div>

        <div className="space-y-3 pl-2">
          {errorAccounts.length > 0 && (
            <div className="space-y-2">
              <Badge variant="destructive">エラー ({errorAccounts.length}件)</Badge>
              <div className="space-y-1 pl-4">
                {errorAccounts.map((account) => (
                  <Link
                    key={account.id}
                    href={accountHref(account) as Route}
                    className="block px-3 py-2 text-sm rounded-md hover:bg-muted transition-colors"
                  >
                    <span className="block">{account.name}</span>
                    {account.profileName && (
                      <span className="block text-xs text-muted-foreground">
                        {account.profileName}
                      </span>
                    )}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {updatingAccounts.length > 0 && (
            <div className="space-y-2">
              <Badge variant="warning">更新中 ({updatingAccounts.length}件)</Badge>
              <div className="space-y-1 pl-4">
                {updatingAccounts.map((account) => (
                  <Link
                    key={account.id}
                    href={accountHref(account) as Route}
                    className="block px-3 py-2 text-sm rounded-md hover:bg-muted transition-colors"
                  >
                    <span className="block">{account.name}</span>
                    {account.profileName && (
                      <span className="block text-xs text-muted-foreground">
                        {account.profileName}
                      </span>
                    )}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
