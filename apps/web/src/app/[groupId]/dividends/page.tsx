import type { Metadata } from "next";
import { DividendContent } from "../../dividends/page";

export const metadata: Metadata = {
  title: "配当・分配",
};

type GroupDividendsPageProps = {
  params: Promise<{ groupId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function GroupDividendsPage({
  params,
  searchParams,
}: GroupDividendsPageProps) {
  const { groupId } = await params;
  const resolvedSearchParams =
    process.env.NEXT_PUBLIC_STATIC_DEMO_BUILD === "true" ? undefined : await searchParams;
  return <DividendContent groupId={groupId} searchParams={resolvedSearchParams} />;
}
