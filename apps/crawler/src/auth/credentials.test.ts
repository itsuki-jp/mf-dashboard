import { describe, expect, test, vi } from "vitest";
import { createCredentialAccess } from "./credentials.js";
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
