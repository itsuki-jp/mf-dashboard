import { describe, expect, it } from "vitest";
import type { CrawlerRunStateSnapshot } from "./crawler-run-state.js";
import {
  createProfileCompletedStatus,
  createProfileFailedStatus,
  createProfileRunningStatus,
  sliceProfileRunState,
} from "./profile-run-status.js";

function stateWithTimeline(timeline: CrawlerRunStateSnapshot["timeline"]): CrawlerRunStateSnapshot {
  return {
    version: 1,
    runId: "anonymous-run",
    source: "test",
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: null,
    runStatus: "running",
    current: null,
    progress: null,
    reason: null,
    timeline,
  };
}

describe("profile run status", () => {
  it("開始時は最終成功日時を上書きしないrunning状態にする", () => {
    expect(createProfileRunningStatus()).toEqual({ lastStatus: "running", lastError: null });
  });

  it("警告なしの完了をsuccessとして完了日時とともに記録する", () => {
    expect(createProfileCompletedStatus(stateWithTimeline([]), "2026-01-02T03:04:05.000Z")).toEqual(
      {
        lastScrapedAt: "2026-01-02T03:04:05.000Z",
        lastStatus: "success",
        lastError: null,
      },
    );
  });

  it("警告を含む完了をpartial_successとして記録する", () => {
    const state = stateWithTimeline([
      {
        id: "anonymous-step",
        label: "通知",
        step: "notification",
        status: "warning",
        startedAt: "2026-01-01T00:00:00.000Z",
        finishedAt: "2026-01-01T00:00:01.000Z",
        metadata: null,
        reason: { code: "unknown_error", message: "通知に失敗しました" },
      },
    ]);

    expect(createProfileCompletedStatus(state, "2026-01-02T03:04:05.000Z").lastStatus).toBe(
      "partial_success",
    );
  });

  it("認証stepの失敗をauth_failedとして安全な理由とともに記録する", () => {
    const state = stateWithTimeline([
      {
        id: "anonymous-step",
        label: "認証",
        step: "authentication",
        status: "failed",
        startedAt: "2026-01-01T00:00:00.000Z",
        finishedAt: "2026-01-01T00:00:01.000Z",
        metadata: null,
        reason: { code: "auth_failed", message: "MoneyForward の認証に失敗しました" },
      },
    ]);

    expect(createProfileFailedStatus(state, new Error("private detail"))).toEqual({
      lastStatus: "auth_failed",
      lastError: "MoneyForward の認証に失敗しました",
    });
  });

  it("途中失敗をscrape_failedにし生の例外内容を保存しない", () => {
    expect(createProfileFailedStatus(stateWithTimeline([]), new Error("private detail"))).toEqual({
      lastStatus: "scrape_failed",
      lastError: "処理中にエラーが発生しました",
    });
  });

  it("前profileのwarningを次profileの成功状態へ混ぜない", () => {
    const sharedState = stateWithTimeline([
      {
        id: "profile-a-warning",
        label: "[profile-a] 通知",
        step: "notification",
        status: "warning",
        startedAt: "2026-01-01T00:00:00.000Z",
        finishedAt: "2026-01-01T00:00:01.000Z",
        metadata: null,
        reason: { code: "unknown_error", message: "通知に失敗しました" },
      },
    ]);
    const profileBState = sliceProfileRunState(sharedState, 1);

    expect(createProfileCompletedStatus(profileBState, "2026-01-02T03:04:05.000Z")).toMatchObject({
      lastStatus: "success",
    });
  });

  it("前profileの失敗理由を次profileのsetup失敗へ混ぜない", () => {
    const sharedState = stateWithTimeline([
      {
        id: "profile-a-failure",
        label: "[profile-a] 認証",
        step: "authentication",
        status: "failed",
        startedAt: "2026-01-01T00:00:00.000Z",
        finishedAt: "2026-01-01T00:00:01.000Z",
        metadata: null,
        reason: { code: "auth_failed", message: "MoneyForward の認証に失敗しました" },
      },
    ]);
    const profileBState = sliceProfileRunState(sharedState, 1);

    expect(createProfileFailedStatus(profileBState, new Error("setup failed"))).toEqual({
      lastStatus: "scrape_failed",
      lastError: "処理中にエラーが発生しました",
    });
  });
});
