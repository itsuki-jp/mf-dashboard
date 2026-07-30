import path from "node:path";
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

export function resolveBitwardenAccessTokenFile(environment: NodeJS.ProcessEnv): string {
  const containerPath = environment.BWS_ACCESS_TOKEN_FILE?.trim();
  if (containerPath) {
    return containerPath;
  }

  const hostPath = environment.BWS_ACCESS_TOKEN_HOST_FILE?.trim();
  if (hostPath) {
    const repositoryRoot = path.resolve(import.meta.dirname, "../../../..");
    return path.resolve(repositoryRoot, hostPath);
  }

  throw new Error("BWS_ACCESS_TOKEN_FILE or BWS_ACCESS_TOKEN_HOST_FILE is not configured");
}

function normalizeTotpSecret(value: string): string {
  const normalized = value.replace(/[\s-]/g, "").toUpperCase();
  if (!/^[A-Z2-7]{32}$/.test(normalized)) {
    throw new Error("Bitwarden TOTP secret must be a 32-character Base32 setup key");
  }
  return normalized;
}

export class BitwardenSecretProvider implements SecretProvider {
  private readonly environment: NodeJS.ProcessEnv;
  private readonly now: () => number;
  private readonly secretReader: SecretReader;

  constructor(options: BitwardenSecretProviderOptions = {}) {
    this.environment = options.environment ?? process.env;
    this.now = options.now ?? Date.now;
    this.secretReader =
      options.secretReader ??
      new BwsSecretClient({
        accessTokenFile: resolveBitwardenAccessTokenFile(this.environment),
        environment: this.environment,
      });
  }

  async getMoneyForwardCredentials(): Promise<MoneyForwardCredentials> {
    const [username, password] = await Promise.all([
      this.secretReader.getSecretValue(
        requireEnvironmentVariable(this.environment, "BWS_USERNAME_SECRET_ID"),
      ),
      this.secretReader.getSecretValue(
        requireEnvironmentVariable(this.environment, "BWS_PASSWORD_SECRET_ID"),
      ),
    ]);
    return { username, password };
  }

  async getOneTimePassword(): Promise<string> {
    const secret = normalizeTotpSecret(
      await this.secretReader.getSecretValue(
        requireEnvironmentVariable(this.environment, "BWS_TOTP_SECRET_ID"),
      ),
    );
    const totp = new TOTP({
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: Secret.fromBase32(secret),
    });

    return totp.generate({ timestamp: this.now() });
  }
}
