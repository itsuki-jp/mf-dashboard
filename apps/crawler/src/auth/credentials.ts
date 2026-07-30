import type { MoneyForwardProfile } from "../profile-config.js";
import { BitwardenSecretProvider } from "./bitwarden-secret-provider.js";
import type { MoneyForwardCredentials, SecretProvider } from "./secret-provider.js";

export function createSecretProvider(
  profile: MoneyForwardProfile,
  environment: NodeJS.ProcessEnv = process.env,
): SecretProvider {
  return new BitwardenSecretProvider({
    environment,
    secretIds: {
      username: profile.usernameSecretId,
      password: profile.passwordSecretId,
      totp: profile.totpSecretId,
    },
  });
}

export interface CredentialAccess {
  getCredentials: () => Promise<MoneyForwardCredentials>;
  getOTP: () => Promise<string>;
}

export function createCredentialAccess(provider: SecretProvider): CredentialAccess {
  return {
    getCredentials: () => provider.getMoneyForwardCredentials(),
    getOTP: () => provider.getOneTimePassword(),
  };
}

export function createProfileCredentialAccess(
  profile: MoneyForwardProfile,
  environment: NodeJS.ProcessEnv = process.env,
): CredentialAccess {
  return createCredentialAccess(createSecretProvider(profile, environment));
}
