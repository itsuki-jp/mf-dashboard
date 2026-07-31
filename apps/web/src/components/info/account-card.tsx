import type { AccountStatusType } from "@mf-dashboard/db/types";
import { formatLastUpdated } from "../../lib/format";
import { buildGroupPath } from "../../lib/url";
import { AccountStatusBadge } from "../ui/account-status-badge";
import { AmountDisplay } from "../ui/amount-display";
import { Badge } from "../ui/badge";
import { Card, CardContent } from "../ui/card";

type AccountCardProps = {
  mfId: string;
  name: string;
  profileName?: string;
  type: string;
  status: AccountStatusType;
  lastUpdated: string | null;
  totalAssets: number;
  currentMonthExpense: number;
  categoryName: string;
  groupId?: string;
};

export function AccountCard({
  mfId,
  name,
  profileName,
  type,
  status,
  lastUpdated,
  totalAssets,
  currentMonthExpense,
  categoryName,
  groupId,
}: AccountCardProps) {
  const href = buildGroupPath(groupId, `accounts/${encodeURIComponent(mfId)}`);
  const isLinkable = mfId !== "unknown";
  const isCard = categoryName === "カード" || categoryName === "クレジットカード";
  const displayAmount = isCard && currentMonthExpense > 0 ? -currentMonthExpense : totalAssets;

  return (
    <Card
      href={isLinkable ? href : undefined}
      className={isLinkable ? "border-primary/30 hover:border-primary transition-colors" : ""}
    >
      <CardContent className="pt-6">
        <div className="flex items-start justify-between mb-4">
          <span className="min-w-0 font-semibold text-foreground">
            <span className="block truncate">{name}</span>
            {profileName && (
              <span className="block truncate text-xs font-normal text-muted-foreground">
                {profileName}
              </span>
            )}
          </span>
          <Badge variant="outline">{type}</Badge>
        </div>

        <div className="mb-3">
          {isCard && <div className="mb-1 text-sm text-muted-foreground">今月利用額</div>}
          <AmountDisplay
            amount={displayAmount}
            type={isCard ? "expense" : undefined}
            size="2xl"
            weight="bold"
          />
        </div>

        <div className="flex items-center justify-between h-5">
          <div className="flex items-center gap-2">
            {type !== "手動" && <AccountStatusBadge status={status} />}
          </div>
          {type !== "手動" && formatLastUpdated(lastUpdated) && (
            <span className="text-sm text-muted-foreground">
              取得日時: {formatLastUpdated(lastUpdated)}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
