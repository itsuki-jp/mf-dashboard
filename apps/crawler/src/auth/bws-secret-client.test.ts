import { describe, expect, test, vi } from "vitest";
import { BwsSecretClient } from "./bws-secret-client.js";

const secretId = "12345678-1234-4123-8123-123456789abc";

describe("BwsSecretClient", () => {
  test("passes the access token through the child environment, never argv", async () => {
    const readTokenFile = vi
      .fn<(path: string, encoding: "utf8") => Promise<string>>()
      .mockResolvedValue("  test-access-token\n");
    const runBws = vi
      .fn<(args: string[], environment: NodeJS.ProcessEnv) => Promise<string>>()
      .mockResolvedValue(JSON.stringify({ value: "secret-value" }));
    const client = new BwsSecretClient({
      accessTokenFile: "/run/secrets/bws_access_token",
      readTokenFile,
      runBws,
    });

    await expect(client.getSecretValue(secretId)).resolves.toBe("secret-value");
    expect(readTokenFile).toHaveBeenCalledWith("/run/secrets/bws_access_token", "utf8");

    const [args, environment] = runBws.mock.calls[0] as [string[], NodeJS.ProcessEnv];
    expect(args).toEqual(["secret", "get", secretId, "--output", "json", "--color", "no"]);
    expect(args).not.toContain("test-access-token");
    expect(environment.BWS_ACCESS_TOKEN).toBe("test-access-token");
    expect(environment.BITWARDEN_ACCESS_TOKEN).toBeUndefined();
  });

  test("reads the access token file only once", async () => {
    const readTokenFile = vi
      .fn<(path: string, encoding: "utf8") => Promise<string>>()
      .mockResolvedValue("test-access-token");
    const runBws = vi
      .fn<(args: string[], environment: NodeJS.ProcessEnv) => Promise<string>>()
      .mockResolvedValue(JSON.stringify({ value: "secret-value" }));
    const client = new BwsSecretClient({
      accessTokenFile: "/run/secrets/bws_access_token",
      readTokenFile,
      runBws,
    });

    await client.getSecretValue(secretId);
    await client.getSecretValue("87654321-4321-4321-8321-cba987654321");

    expect(readTokenFile).toHaveBeenCalledOnce();
  });

  test("does not include command output in failures", async () => {
    const client = new BwsSecretClient({
      accessTokenFile: "/run/secrets/bws_access_token",
      readTokenFile: vi
        .fn<(path: string, encoding: "utf8") => Promise<string>>()
        .mockResolvedValue("test-access-token"),
      runBws: vi
        .fn<(args: string[], environment: NodeJS.ProcessEnv) => Promise<string>>()
        .mockRejectedValue(new Error("sensitive command output")),
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
      runBws: vi
        .fn<(args: string[], environment: NodeJS.ProcessEnv) => Promise<string>>()
        .mockResolvedValue(JSON.stringify({ value: "" })),
    });

    await expect(client.getSecretValue(secretId)).rejects.toThrow(
      "Failed to retrieve a secret from Bitwarden",
    );
  });

  test("rejects a non-UUID secret ID before invoking bws", async () => {
    const runBws = vi.fn<(args: string[], environment: NodeJS.ProcessEnv) => Promise<string>>();
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
});
