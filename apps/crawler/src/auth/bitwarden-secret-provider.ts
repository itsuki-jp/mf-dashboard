import { Secret, TOTP } from "otpauth";
import { BwsSecretClient } from "./bws-secret-client.js";
import type { MoneyForwardCredentials, SecretProvider } from "./secret-provider.js";

interface SecretReader {
  getSecretValue(secretId: string): Promise<string>;
}

export interface BitwardenSecretProviderOptions {
  environment?: NodeJS.ProcessEnv;
  now?: () => number;
  secretReader?: SecretReader;
}

function requireEnvironmentVariable(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name];
  if (!value) {
    throw new Error(`${name} is not configured`);
  }
  return value;
}

function normalizeTotpSecret(value: string): string {
  const normalized = value.replace(/[\s-]/g, "").toUpperCase();
  if (!/^[A-Z2-7]+=*$/.test(normalized)) {
    throw new Error("Bitwarden TOTP secret is not valid Base32");
  }
  return normalized;
}

export class BitwardenSecretProvider implements SecretProvider {
  private readonly environment: NodeJS.ProcessEnv;
  private readonly now: () => number;
  private readonly secretReader: SecretReader;
  private credentialsPromise: Promise<MoneyForwardCredentials> | null = null;
  private totpSecretPromise: Promise<string> | null = null;

  constructor(options: BitwardenSecretProviderOptions = {}) {
    this.environment = options.environment ?? process.env;
    this.now = options.now ?? Date.now;
    this.secretReader =
      options.secretReader ??
      new BwsSecretClient({
        accessTokenFile: requireEnvironmentVariable(this.environment, "BWS_ACCESS_TOKEN_FILE"),
      });
  }

  async getMoneyForwardCredentials(): Promise<MoneyForwardCredentials> {
    this.credentialsPromise ??= Promise.all([
      this.secretReader.getSecretValue(
        requireEnvironmentVariable(this.environment, "BWS_USERNAME_SECRET_ID"),
      ),
      this.secretReader.getSecretValue(
        requireEnvironmentVariable(this.environment, "BWS_PASSWORD_SECRET_ID"),
      ),
    ]).then(([username, password]) => ({ username, password }));

    return this.credentialsPromise;
  }

  async getOneTimePassword(): Promise<string> {
    this.totpSecretPromise ??= this.secretReader
      .getSecretValue(requireEnvironmentVariable(this.environment, "BWS_TOTP_SECRET_ID"))
      .then(normalizeTotpSecret);

    const secret = await this.totpSecretPromise;
    const totp = new TOTP({
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: Secret.fromBase32(secret),
    });

    return totp.generate({ timestamp: this.now() });
  }
}
