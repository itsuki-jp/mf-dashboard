import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ProfileSelectorClient } from "./profile-selector.client";

const meta = {
  title: "Layout/ProfileSelector",
  component: ProfileSelectorClient,
  tags: ["autodocs"],
  parameters: {
    layout: "centered",
    nextjs: { appDirectory: true, navigation: { pathname: "/" } },
  },
} satisfies Meta<typeof ProfileSelectorClient>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AllProfiles: Story = {
  args: {
    profiles: [
      {
        id: "profile_a",
        name: "Profile A",
        lastScrapedAt: "2026-07-01T10:00:00Z",
        lastStatus: "success",
        currentGroupId: "profile_a:0",
      },
      {
        id: "profile_b",
        name: "Profile B",
        lastScrapedAt: "2026-07-01T10:05:00Z",
        lastStatus: "auth_failed",
        currentGroupId: "profile_b:0",
      },
    ],
    groupProfiles: [
      { groupId: "profile_a:0", profileId: "profile_a" },
      { groupId: "profile_b:0", profileId: "profile_b" },
    ],
  },
};

export const SelectedProfile: Story = {
  ...AllProfiles,
  parameters: {
    nextjs: { appDirectory: true, navigation: { pathname: "/profile--profile_a/cf" } },
  },
};
