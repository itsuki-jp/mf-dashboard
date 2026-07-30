import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

type AnyMock = (...args: any[]) => any;

const { mockResolve, mockCreateClient } = vi.hoisted(() => {
  const mockResolve = vi.fn<AnyMock>();
  const mockCreateClient = vi.fn<AnyMock>().mockResolvedValue({
    secrets: {
      resolve: mockResolve,
    },
  });
  return { mockResolve, mockCreateClient };
});

vi.mock("@1password/sdk", () => ({
  createClient: mockCreateClient,
}));

vi.spyOn(process, "exit").mockImplementation(() => {
  throw new Error("process.exit called");
});

import { OnePasswordSecretProvider } from "./one-password-secret-provider.js";

describe("OnePasswordSecretProvider", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = {
      ...originalEnv,
      OP_SERVICE_ACCOUNT_TOKEN: "test-token",
      OP_VAULT: "test-vault",
      OP_ITEM: "test-item",
      OP_TOTP_FIELD: "totp",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test("returns credentials from 1Password", async () => {
    mockResolve.mockImplementation((path: string) => {
      if (path.includes("username")) return Promise.resolve("test-user@example.com");
      if (path.includes("password")) return Promise.resolve("test-password");
      return Promise.resolve("");
    });
    const provider = new OnePasswordSecretProvider();

    await expect(provider.getMoneyForwardCredentials()).resolves.toEqual({
      username: "test-user@example.com",
      password: "test-password",
    });
    expect(mockResolve).toHaveBeenCalledWith("op://test-vault/test-item/username");
    expect(mockResolve).toHaveBeenCalledWith("op://test-vault/test-item/password");
  });

  test("throws when credentials are empty", async () => {
    mockResolve.mockResolvedValue("");
    const provider = new OnePasswordSecretProvider();

    await expect(provider.getMoneyForwardCredentials()).rejects.toThrow(
      "Failed to get credentials from 1Password",
    );
  });

  test("exits when OP_SERVICE_ACCOUNT_TOKEN is not set", async () => {
    delete process.env.OP_SERVICE_ACCOUNT_TOKEN;
    const provider = new OnePasswordSecretProvider();

    await expect(provider.getMoneyForwardCredentials()).rejects.toThrow("process.exit called");
  });

  test("returns OTP from 1Password", async () => {
    mockResolve.mockResolvedValue("123456");
    const provider = new OnePasswordSecretProvider();

    await expect(provider.getOneTimePassword()).resolves.toBe("123456");
    expect(mockResolve).toHaveBeenCalledWith("op://test-vault/test-item/totp?attribute=totp");
  });

  test("throws when OP_TOTP_FIELD is not set", async () => {
    delete process.env.OP_TOTP_FIELD;
    const provider = new OnePasswordSecretProvider();

    await expect(provider.getOneTimePassword()).rejects.toThrow(
      "OP_TOTP_FIELD が設定されていません",
    );
  });

  test("throws when OTP is empty", async () => {
    mockResolve.mockResolvedValue("");
    const provider = new OnePasswordSecretProvider();

    await expect(provider.getOneTimePassword()).rejects.toThrow("OTP の取得に失敗しました");
  });

  test("reuses the SDK client across credential and OTP retrieval", async () => {
    mockResolve.mockImplementation((path: string) => {
      if (path.includes("username")) return Promise.resolve("test-user@example.com");
      if (path.includes("password")) return Promise.resolve("test-password");
      return Promise.resolve("123456");
    });
    const provider = new OnePasswordSecretProvider();

    await provider.getMoneyForwardCredentials();
    await provider.getOneTimePassword();

    expect(mockCreateClient).toHaveBeenCalledOnce();
  });
});
