import { BitwardenSecretProvider } from "./bitwarden-secret-provider.js";
import { OnePasswordSecretProvider } from "./one-password-secret-provider.js";
import type { MoneyForwardCredentials, SecretProvider } from "./secret-provider.js";

export function createSecretProvider(environment: NodeJS.ProcessEnv = process.env): SecretProvider {
  const provider = environment.SECRET_PROVIDER ?? "onepassword";

  switch (provider) {
    case "bitwarden":
      return new BitwardenSecretProvider({ environment });
    case "onepassword":
      return new OnePasswordSecretProvider();
    default:
      throw new Error(`Unsupported SECRET_PROVIDER: ${provider}`);
  }
}

export function createCredentialAccess(provider: SecretProvider): {
  getCredentials: () => Promise<MoneyForwardCredentials>;
  getOTP: () => Promise<string>;
} {
  return {
    getCredentials: () => provider.getMoneyForwardCredentials(),
    getOTP: () => provider.getOneTimePassword(),
  };
}

let defaultCredentialAccess: ReturnType<typeof createCredentialAccess> | null = null;

function getDefaultCredentialAccess(): ReturnType<typeof createCredentialAccess> {
  defaultCredentialAccess ??= createCredentialAccess(createSecretProvider());
  return defaultCredentialAccess;
}

export async function getCredentials(): Promise<MoneyForwardCredentials> {
  return getDefaultCredentialAccess().getCredentials();
}

export async function getOTP(): Promise<string> {
  return getDefaultCredentialAccess().getOTP();
}
