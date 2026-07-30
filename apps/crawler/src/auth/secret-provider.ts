export interface MoneyForwardCredentials {
  username: string;
  password: string;
}

export interface SecretProvider {
  getMoneyForwardCredentials(): Promise<MoneyForwardCredentials>;
  getOneTimePassword(): Promise<string>;
}
