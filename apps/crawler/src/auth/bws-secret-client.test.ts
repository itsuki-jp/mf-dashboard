import { describe, expect, test, vi } from "vitest";
import { BwsSecretClient } from "./bws-secret-client.js";

const secretId = "12345678-1234-4123-8123-123456789abc";
type TestRunBws = (
  args: string[],
  environment: NodeJS.ProcessEnv,
  timeoutMs: number,
) => Promise<string>;

describe("BwsSecretClient", () => {
  test("passes the access token through the child environment, never argv", async () => {
    const readTokenFile = vi
      .fn<(path: string, encoding: "utf8") => Promise<string>>()
      .mockResolvedValue("  test-access-token\n");
    const runBws = vi.fn<TestRunBws>().mockResolvedValue(JSON.stringify({ value: "secret-value" }));
    const client = new BwsSecretClient({
      accessTokenFile: "/run/secrets/bws_access_token",
      environment: {
        BWS_SERVER_URL: "https://vault.example.test",
        PATH: "/usr/local/bin:/usr/bin",
        REFRESH_TOKEN: "must-not-reach-bws",
      },
      readTokenFile,
      runBws,
    });

    await expect(client.getSecretValue(secretId)).resolves.toBe("secret-value");
    expect(readTokenFile).toHaveBeenCalledWith("/run/secrets/bws_access_token", "utf8");

    const [args, environment, timeoutMs] = runBws.mock.calls[0];
    expect(args).toEqual(["secret", "get", secretId, "--output", "json", "--color", "no"]);
    expect(args).not.toContain("test-access-token");
    expect(environment.BWS_ACCESS_TOKEN).toBe("test-access-token");
    expect(environment.BWS_SERVER_URL).toBe("https://vault.example.test");
    expect(environment.PATH).toBe("/usr/local/bin:/usr/bin");
    expect(environment.REFRESH_TOKEN).toBeUndefined();
    expect(timeoutMs).toBe(30_000);
  });

  test("rereads the access token file so rotation is picked up", async () => {
    const readTokenFile = vi
      .fn<(path: string, encoding: "utf8") => Promise<string>>()
      .mockResolvedValue("test-access-token");
    const runBws = vi.fn<TestRunBws>().mockResolvedValue(JSON.stringify({ value: "secret-value" }));
    const client = new BwsSecretClient({
      accessTokenFile: "/run/secrets/bws_access_token",
      readTokenFile,
      runBws,
    });

    await client.getSecretValue(secretId);
    await client.getSecretValue("87654321-4321-4321-8321-cba987654321");

    expect(readTokenFile).toHaveBeenCalledTimes(2);
  });

  test("does not include command output in failures", async () => {
    const client = new BwsSecretClient({
      accessTokenFile: "/run/secrets/bws_access_token",
      readTokenFile: vi
        .fn<(path: string, encoding: "utf8") => Promise<string>>()
        .mockResolvedValue("test-access-token"),
      runBws: vi.fn<TestRunBws>().mockRejectedValue(new Error("sensitive command output")),
    });

    await expect(client.getSecretValue(secretId)).rejects.toThrow(
      "Failed to retrieve a secret from Bitwarden",
    );
    await expect(client.getSecretValue(secretId)).rejects.not.toThrow("sensitive command output");
  });

  test("rejects responses without a non-empty string value", async () => {
    const client = new BwsSecretClient({
      accessTokenFile: "/run/secrets/bws_access_token",
      readTokenFile: vi
        .fn<(path: string, encoding: "utf8") => Promise<string>>()
        .mockResolvedValue("test-access-token"),
      runBws: vi.fn<TestRunBws>().mockResolvedValue(JSON.stringify({ value: "" })),
    });

    await expect(client.getSecretValue(secretId)).rejects.toThrow(
      "Failed to retrieve a secret from Bitwarden",
    );
  });

  test("rejects a non-UUID secret ID before invoking bws", async () => {
    const runBws = vi.fn<TestRunBws>();
    const client = new BwsSecretClient({
      accessTokenFile: "/run/secrets/bws_access_token",
      readTokenFile: vi
        .fn<(path: string, encoding: "utf8") => Promise<string>>()
        .mockResolvedValue("test-access-token"),
      runBws,
    });

    await expect(client.getSecretValue("--access-token")).rejects.toThrow(
      "Bitwarden secret ID is not a valid UUID",
    );
    expect(runBws).not.toHaveBeenCalled();
  });

  test("passes the configured timeout and redacts timeout failures", async () => {
    const runBws = vi.fn<TestRunBws>().mockRejectedValue(new Error("timed out after 10ms"));
    const client = new BwsSecretClient({
      accessTokenFile: "/run/secrets/bws_access_token",
      readTokenFile: vi
        .fn<(path: string, encoding: "utf8") => Promise<string>>()
        .mockResolvedValue("test-access-token"),
      runBws,
      timeoutMs: 10,
    });

    await expect(client.getSecretValue(secretId)).rejects.toThrow(
      "Failed to retrieve a secret from Bitwarden",
    );
    expect(runBws).toHaveBeenCalledWith(expect.any(Array), expect.any(Object), 10);
  });
});
