export interface TokenExchangeResponse {
  access_token?: string;
  public_access_token?: string;
  read_access_token?: string;
  [key: string]: unknown;
}
