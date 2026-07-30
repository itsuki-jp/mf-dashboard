import { OnePasswordSecretProvider } from "./one-password-secret-provider.js";
import type { MoneyForwardCredentials, SecretProvider } from "./secret-provider.js";

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
  defaultCredentialAccess ??= createCredentialAccess(new OnePasswordSecretProvider());
  return defaultCredentialAccess;
}

export async function getCredentials(): Promise<MoneyForwardCredentials> {
  return getDefaultCredentialAccess().getCredentials();
}

export async function getOTP(): Promise<string> {
  return getDefaultCredentialAccess().getOTP();
}
