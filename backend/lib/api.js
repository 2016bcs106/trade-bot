import fetch from "node-fetch";

export class DataFetcher {
  async fetch(fromDate, toDate, pmlId) {
    const response = await fetch(
      "https://api-eq.paytmmoney.com/charts/price/v1/price-charts",
      {
        headers: {
          accept: "application/json, text/plain, */*",
          "accept-language": "en-US,en;q=0.9",
          "content-type": "application/json",
          priority: "u=1, i",
          "sec-ch-ua":
            '"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
          "sec-ch-ua-mobile": "?0",
          "sec-ch-ua-platform": '"macOS"',
          "sec-fetch-dest": "empty",
          "sec-fetch-mode": "cors",
          "sec-fetch-site": "same-origin",
          "x-pmngx-key": "paytmmoney",
          "x-request-id": "45525300-5068-11f1-b795-4bb77e3a4e27",
          "x-sso-token": "56d3eec0-907a-4cf4-ad4f-803cdcd91900",
          "x-user-agent":
            '{"platform":"web","user_id":"69491394","appName":"Netscape","os_version":"5","product":"Chrome","device_id":"48535f45-191d-5e4f-9a0e-9aa155dd42a2"}',
        },
        body: JSON.stringify({
          toDate: fromDate,
          fromDate: toDate,
          interval: "MINUTE",
          pmlId,
        }),
        method: "POST",
      },
    );

    const data = await response.json();

    return data.data.map((item) => ({
      date: item[0],
      close: item[4],
      volume: item[5],
    }));
  }
}
