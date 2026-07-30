import { createClient, type Client } from "@1password/sdk";
import { debug, error } from "../logger.js";
import type { MoneyForwardCredentials, SecretProvider } from "./secret-provider.js";

export class OnePasswordSecretProvider implements SecretProvider {
  private client: Client | null = null;

  private async getClient(): Promise<Client> {
    if (this.client) {
      return this.client;
    }

    const token = process.env.OP_SERVICE_ACCOUNT_TOKEN;
    if (!token) {
      error("OP_SERVICE_ACCOUNT_TOKEN が設定されていません");
      process.exit(1);
    }

    debug("1Password SDK クライアントを初期化しています...");
    this.client = await createClient({
      auth: token,
      integrationName: "mf-dashboard",
      integrationVersion: "1.0.0",
    });

    return this.client;
  }

  async getMoneyForwardCredentials(): Promise<MoneyForwardCredentials> {
    const vault = process.env.OP_VAULT || "";
    const item = process.env.OP_ITEM || "";
    const client = await this.getClient();

    debug("1Password から認証情報を取得しています...");
    const [username, password] = await Promise.all([
      client.secrets.resolve(`op://${vault}/${item}/username`),
      client.secrets.resolve(`op://${vault}/${item}/password`),
    ]);

    if (!username || !password) {
      throw new Error("Failed to get credentials from 1Password");
    }

    return { username, password };
  }

  async getOneTimePassword(): Promise<string> {
    const vault = process.env.OP_VAULT || "";
    const item = process.env.OP_ITEM || "";
    const totpField = process.env.OP_TOTP_FIELD || "";

    if (!totpField) {
      throw new Error("OP_TOTP_FIELD が設定されていません");
    }

    const client = await this.getClient();

    debug("1Password から OTP を取得しています...");
    const otp = await client.secrets.resolve(`op://${vault}/${item}/${totpField}?attribute=totp`);

    if (!otp) {
      throw new Error("OTP の取得に失敗しました");
    }

    return otp;
  }
}
