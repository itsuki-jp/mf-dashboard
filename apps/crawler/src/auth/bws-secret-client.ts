import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";

type ReadTokenFile = (path: string, encoding: "utf8") => Promise<string>;
type RunBws = (args: string[], env: NodeJS.ProcessEnv) => Promise<string>;

function runBws(args: string[], env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "bws",
      args,
      {
        encoding: "utf8",
        env,
        maxBuffer: 1024 * 1024,
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
  readTokenFile?: ReadTokenFile;
  runBws?: RunBws;
}

export class BwsSecretClient {
  private readonly accessTokenFile: string;
  private readonly readTokenFile: ReadTokenFile;
  private readonly runBws: RunBws;
  private accessTokenPromise: Promise<string> | null = null;

  constructor(options: BwsSecretClientOptions) {
    this.accessTokenFile = options.accessTokenFile;
    this.readTokenFile = options.readTokenFile ?? readFile;
    this.runBws = options.runBws ?? runBws;
  }

  private async getAccessToken(): Promise<string> {
    this.accessTokenPromise ??= this.readTokenFile(this.accessTokenFile, "utf8").then((token) => {
      const trimmedToken = token.trim();
      if (!trimmedToken) {
        throw new Error("Bitwarden access token file is empty");
      }
      return trimmedToken;
    });

    return this.accessTokenPromise;
  }

  async getSecretValue(secretId: string): Promise<string> {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(secretId)
    ) {
      throw new Error("Bitwarden secret ID is not a valid UUID");
    }

    try {
      const accessToken = await this.getAccessToken();
      const childEnvironment = { ...process.env };
      delete childEnvironment.BITWARDEN_ACCESS_TOKEN;
      childEnvironment.BWS_ACCESS_TOKEN = accessToken;

      const output = await this.runBws(
        ["secret", "get", secretId, "--output", "json", "--color", "no"],
        childEnvironment,
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
