import { describe, expect, test, vi } from "vitest";
import { BitwardenSecretProvider } from "./bitwarden-secret-provider.js";

const environment = {
  BWS_ACCESS_TOKEN_FILE: "/run/secrets/bws_access_token",
  BWS_PASSWORD_SECRET_ID: "password-id",
  BWS_TOTP_SECRET_ID: "totp-id",
  BWS_USERNAME_SECRET_ID: "username-id",
};

describe("BitwardenSecretProvider", () => {
  test("retrieves fresh Money Forward credentials by secret ID", async () => {
    const getSecretValue = vi.fn<(secretId: string) => Promise<string>>(async (secretId) => {
      if (secretId === "username-id") return "test-user@example.com";
      if (secretId === "password-id") return "test-password";
      throw new Error("unexpected secret ID");
    });
    const provider = new BitwardenSecretProvider({
      environment,
      secretReader: { getSecretValue },
    });

    await expect(provider.getMoneyForwardCredentials()).resolves.toEqual({
      username: "test-user@example.com",
      password: "test-password",
    });
    await provider.getMoneyForwardCredentials();

    expect(getSecretValue).toHaveBeenCalledTimes(4);
    expect(getSecretValue).toHaveBeenCalledWith("username-id");
    expect(getSecretValue).toHaveBeenCalledWith("password-id");
  });

  test("generates a six-digit RFC 6238 TOTP and normalizes grouped Base32", async () => {
    const getSecretValue = vi
      .fn<(secretId: string) => Promise<string>>()
      .mockResolvedValue("GEZD GNBV GY3T QOJQ GEZD GNBV GY3T QOJQ");
    const provider = new BitwardenSecretProvider({
      environment,
      now: () => 59_000,
      secretReader: { getSecretValue },
    });

    await expect(provider.getOneTimePassword()).resolves.toBe("287082");
    await provider.getOneTimePassword();

    expect(getSecretValue).toHaveBeenCalledTimes(2);
    expect(getSecretValue).toHaveBeenCalledWith("totp-id");
  });

  test.each(["not-a-valid-secret-1", "A"])(
    "rejects an invalid or truncated TOTP setup key: %s",
    async (setupKey) => {
      const provider = new BitwardenSecretProvider({
        environment,
        secretReader: {
          getSecretValue: vi
            .fn<(secretId: string) => Promise<string>>()
            .mockResolvedValue(setupKey),
        },
      });

      await expect(provider.getOneTimePassword()).rejects.toThrow(
        "Bitwarden TOTP secret must be a 32-character Base32 setup key",
      );
    },
  );

  test("requires every configured secret ID", async () => {
    const provider = new BitwardenSecretProvider({
      environment: {
        BWS_ACCESS_TOKEN_FILE: "/run/secrets/bws_access_token",
        BWS_PASSWORD_SECRET_ID: "password-id",
      },
      secretReader: { getSecretValue: vi.fn<(secretId: string) => Promise<string>>() },
    });

    await expect(provider.getMoneyForwardCredentials()).rejects.toThrow(
      "BWS_USERNAME_SECRET_ID is not configured",
    );
  });
});
