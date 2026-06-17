import { DhanHolding, DhanPosition } from "../../types/market-data/dhanhq-portfolio.ts";

const DHAN_API_BASE = "https://api.dhan.co/v2";

export default class DhanhqClient {
  private headers(accessToken: string, clientId: string): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "access-token": accessToken,
      "dhanClientId": clientId,
    };
  }

  async fetchHoldings(accessToken: string, clientId: string): Promise<DhanHolding[]> {
    const res = await fetch(`${DHAN_API_BASE}/holdings`, { headers: this.headers(accessToken, clientId) });
    if (!res.ok) return []; // DH-1111 = no holdings
    const data = await res.json() as unknown;
    return Array.isArray(data) ? data as DhanHolding[] : [];
  }

  async fetchPositions(accessToken: string, clientId: string): Promise<DhanPosition[]> {
    const res = await fetch(`${DHAN_API_BASE}/positions`, { headers: this.headers(accessToken, clientId) });
    if (!res.ok) return [];
    const data = await res.json() as unknown;
    return Array.isArray(data) ? data as DhanPosition[] : [];
  }
}
