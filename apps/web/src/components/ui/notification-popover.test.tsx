import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NotificationPopover } from "./notification-popover";

describe("NotificationPopover", () => {
  it("profile名を表示しprofile scope付きの口座詳細へリンクする", () => {
    render(
      <NotificationPopover
        errorAccounts={[
          {
            id: 1,
            profileId: "profile_a",
            profileName: "Profile A",
            mfId: "shared-account",
            name: "Account A",
            status: "error",
          },
        ]}
        updatingAccounts={[]}
      />,
    );

    expect(screen.getByText("Profile A")).not.toBeNull();
    expect(screen.getByRole("link", { name: /Account A/ }).getAttribute("href")).toBe(
      "/profile--profile_a/accounts/shared-account",
    );
  });
});
