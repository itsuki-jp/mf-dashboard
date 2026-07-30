import { describe, expect, test, vi } from "vitest";
import { BitwardenSecretProvider } from "./bitwarden-secret-provider.js";
import { createCredentialAccess, createSecretProvider } from "./credentials.js";
import { OnePasswordSecretProvider } from "./one-password-secret-provider.js";
import type { SecretProvider } from "./secret-provider.js";

describe("credential access", () => {
  test("delegates credential retrieval to the configured provider", async () => {
    const getMoneyForwardCredentials = vi
      .fn<SecretProvider["getMoneyForwardCredentials"]>()
      .mockResolvedValue({
        username: "test-user@example.com",
        password: "test-password",
      });
    const getOneTimePassword = vi.fn<SecretProvider["getOneTimePassword"]>();
    const provider: SecretProvider = {
      getMoneyForwardCredentials,
      getOneTimePassword,
    };
    const access = createCredentialAccess(provider);

    await expect(access.getCredentials()).resolves.toEqual({
      username: "test-user@example.com",
      password: "test-password",
    });
    expect(getMoneyForwardCredentials).toHaveBeenCalledOnce();
  });

  test("delegates OTP retrieval to the configured provider", async () => {
    const getMoneyForwardCredentials = vi.fn<SecretProvider["getMoneyForwardCredentials"]>();
    const getOneTimePassword = vi
      .fn<SecretProvider["getOneTimePassword"]>()
      .mockResolvedValue("123456");
    const provider: SecretProvider = {
      getMoneyForwardCredentials,
      getOneTimePassword,
    };
    const access = createCredentialAccess(provider);

    await expect(access.getOTP()).resolves.toBe("123456");
    expect(getOneTimePassword).toHaveBeenCalledOnce();
  });
});

describe("createSecretProvider", () => {
  test("keeps 1Password as the default provider", () => {
    expect(createSecretProvider({})).toBeInstanceOf(OnePasswordSecretProvider);
  });

  test("selects Bitwarden explicitly", () => {
    expect(
      createSecretProvider({
        SECRET_PROVIDER: "bitwarden",
        BWS_ACCESS_TOKEN_FILE: "/run/secrets/bws_access_token",
      }),
    ).toBeInstanceOf(BitwardenSecretProvider);
  });

  test("rejects an unsupported provider", () => {
    expect(() => createSecretProvider({ SECRET_PROVIDER: "unknown" })).toThrow(
      "Unsupported SECRET_PROVIDER: unknown",
    );
  });
});
