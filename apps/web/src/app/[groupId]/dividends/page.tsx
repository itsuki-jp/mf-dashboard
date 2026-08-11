import type { Metadata } from "next";
import { DividendContent } from "../../dividends/page";

export const metadata: Metadata = {
  title: "配当・分配",
};

export default async function GroupDividendsPage({
  params,
  searchParams,
}: PageProps<"/[groupId]/dividends"> & {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { groupId } = await params;
  return <DividendContent groupId={groupId} searchParams={await searchParams} />;
}
