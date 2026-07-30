import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";

type ReadTokenFile = (path: string, encoding: "utf8") => Promise<string>;
type RunBws = (args: string[], env: NodeJS.ProcessEnv, timeoutMs: number) => Promise<string>;

const CHILD_ENVIRONMENT_VARIABLES = [
  "HOME",
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "NO_PROXY",
  "PATH",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
  "TZ",
  "https_proxy",
  "http_proxy",
  "no_proxy",
] as const;

function runBws(args: string[], env: NodeJS.ProcessEnv, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "bws",
      args,
      {
        encoding: "utf8",
        env,
        killSignal: "SIGTERM",
        maxBuffer: 1024 * 1024,
        timeout: timeoutMs,
        windowsHide: true,
      },
      (commandError, stdout) => {
        if (commandError) {
          reject(new Error("bws command failed"));
          return;
        }

        resolve(stdout);
      },
    );
  });
}

export interface BwsSecretClientOptions {
  accessTokenFile: string;
  environment?: NodeJS.ProcessEnv;
  readTokenFile?: ReadTokenFile;
  runBws?: RunBws;
  timeoutMs?: number;
}

export class BwsSecretClient {
  private readonly accessTokenFile: string;
  private readonly environment: NodeJS.ProcessEnv;
  private readonly readTokenFile: ReadTokenFile;
  private readonly runBws: RunBws;
  private readonly timeoutMs: number;

  constructor(options: BwsSecretClientOptions) {
    this.accessTokenFile = options.accessTokenFile;
    this.environment = options.environment ?? process.env;
    this.readTokenFile = options.readTokenFile ?? readFile;
    this.runBws = options.runBws ?? runBws;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  private async getAccessToken(): Promise<string> {
    const token = await this.readTokenFile(this.accessTokenFile, "utf8");
    const trimmedToken = token.trim();
    if (!trimmedToken) {
      throw new Error("Bitwarden access token file is empty");
    }
    return trimmedToken;
  }

  async getSecretValue(secretId: string): Promise<string> {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(secretId)
    ) {
      throw new Error("Bitwarden secret ID is not a valid UUID");
    }

    try {
      const accessToken = await this.getAccessToken();
      const childEnvironment: NodeJS.ProcessEnv = {};
      for (const name of CHILD_ENVIRONMENT_VARIABLES) {
        if (this.environment[name]) {
          childEnvironment[name] = this.environment[name];
        }
      }
      if (this.environment.BWS_SERVER_URL) {
        childEnvironment.BWS_SERVER_URL = this.environment.BWS_SERVER_URL;
      }
      childEnvironment.BWS_ACCESS_TOKEN = accessToken;

      const output = await this.runBws(
        ["secret", "get", secretId, "--output", "json", "--color", "no"],
        childEnvironment,
        this.timeoutMs,
      );
      const secret = JSON.parse(output) as unknown;

      if (
        typeof secret !== "object" ||
        secret === null ||
        !("value" in secret) ||
        typeof secret.value !== "string" ||
        !secret.value
      ) {
        throw new Error("Invalid Bitwarden response");
      }

      return secret.value;
    } catch {
      throw new Error("Failed to retrieve a secret from Bitwarden");
    }
  }
}
