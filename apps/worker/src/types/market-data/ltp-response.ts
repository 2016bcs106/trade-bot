export interface LtpResponse {
  data?: Array<{ last_price?: number; [key: string]: unknown }>;
  [key: string]: unknown;
}
