import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { ReactNode } from "react";
import { AccountNotificationsClient } from "../info/account-notifications.client";
import { Header } from "./header";
import { SidebarProvider } from "./sidebar-context";

const mockGroups = [
  {
    id: "profile_a:0",
    profileId: "profile_a",
    profileName: "Profile A",
    name: "個人資産",
    isCurrent: true,
    lastScrapedAt: "2025-04-30T10:30:00",
  },
  {
    id: "profile_a:group_1",
    profileId: "profile_a",
    profileName: "Profile A",
    name: "Group A",
    isCurrent: false,
    lastScrapedAt: "2025-04-30T15:20:00",
  },
];

const meta = {
  title: "Layout/Header",
  component: Header,
  tags: ["autodocs"],
  decorators: [
    (Story: () => ReactNode) => (
      <SidebarProvider>
        <Story />
      </SidebarProvider>
    ),
  ],
  parameters: {
    nextjs: {
      appDirectory: true,
      navigation: {
        pathname: "/",
      },
    },
  },
} satisfies Meta<typeof Header>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    groups: mockGroups,
    defaultGroupId: "profile_a:0",
    notifications: (
      <AccountNotificationsClient errorAccounts={[]} updatingAccounts={[]} totalIssues={0} />
    ),
  },
};

export const SingleGroup: Story = {
  args: {
    groups: [mockGroups[0]],
    defaultGroupId: "profile_a:0",
    notifications: (
      <AccountNotificationsClient errorAccounts={[]} updatingAccounts={[]} totalIssues={0} />
    ),
  },
};

export const NoGroup: Story = {
  args: {
    groups: [],
    defaultGroupId: null,
    notifications: (
      <AccountNotificationsClient errorAccounts={[]} updatingAccounts={[]} totalIssues={0} />
    ),
  },
};

export const WithNotifications: Story = {
  args: {
    groups: mockGroups,
    defaultGroupId: "profile_a:0",
    notifications: (
      <AccountNotificationsClient
        errorAccounts={[{ id: 1, mfId: "account-1", name: "User Aの銀行口座", status: "error" }]}
        updatingAccounts={[
          { id: 2, mfId: "account-2", name: "User Bの証券口座", status: "updating" },
        ]}
        totalIssues={2}
      />
    ),
  },
};

export const MultipleProfiles: Story = {
  args: {
    groups: [
      ...mockGroups,
      {
        id: "profile_b:0",
        profileId: "profile_b",
        profileName: "Profile B",
        name: "個人資産",
        isCurrent: true,
        lastScrapedAt: "2025-04-30T15:25:00",
      },
    ],
    profiles: [
      {
        id: "profile_a",
        name: "Profile A",
        lastScrapedAt: "2025-04-30T15:20:00",
        lastStatus: "success",
        currentGroupId: "profile_a:0",
      },
      {
        id: "profile_b",
        name: "Profile B",
        lastScrapedAt: "2025-04-30T15:25:00",
        lastStatus: "success",
        currentGroupId: "profile_b:0",
      },
    ],
    defaultGroupId: "profile_a:0",
    notifications: (
      <AccountNotificationsClient errorAccounts={[]} updatingAccounts={[]} totalIssues={0} />
    ),
  },
};

export const SelectedProfile: Story = {
  args: MultipleProfiles.args,
  parameters: {
    nextjs: {
      appDirectory: true,
      navigation: { pathname: "/profile--profile_a" },
    },
  },
};
