import { DhanHolding, DhanPosition } from "../../types/market-data/dhanhq-portfolio.ts";
import fetch from "node-fetch";

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

  async fetchFunds(accessToken: string, clientId: string): Promise<{ availabelBalance: number; utilizedAmount: number; sodLimit: number } | null> {
    const res = await fetch(`${DHAN_API_BASE}/fundlimit`, { headers: this.headers(accessToken, clientId) });
    if (!res.ok) return null;
    return res.json() as Promise<{ availabelBalance: number; utilizedAmount: number; sodLimit: number }>;
  }

  async fetchPositions(accessToken: string, clientId: string): Promise<DhanPosition[]> {
    const res = await fetch(`${DHAN_API_BASE}/positions`, { headers: this.headers(accessToken, clientId) });
    if (!res.ok) return [];
    const data = await res.json() as unknown;
    return Array.isArray(data) ? data as DhanPosition[] : [];
  }

  async placeOrder(
    accessToken: string,
    clientId: string,
    order: { securityId: string; transactionType: "BUY" | "SELL"; quantity: number },
  ): Promise<{ orderId: string; orderStatus: string }> {
    const res = await fetch(`${DHAN_API_BASE}/orders`, {
      method: "POST",
      headers: this.headers(accessToken, clientId),
      body: JSON.stringify({
        dhanClientId: clientId,
        transactionType: order.transactionType,
        exchangeSegment: "NSE_EQ",
        productType: "CNC",
        orderType: "MARKET",
        validity: "DAY",
        securityId: order.securityId,
        quantity: order.quantity,
        disclosedQuantity: 0,
        price: 0,
        triggerPrice: 0,
        afterMarketOrder: false,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Dhan order failed ${res.status}: ${body}`);
    }
    return res.json() as Promise<{ orderId: string; orderStatus: string }>;
  }
}
