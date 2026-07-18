import fetch from "node-fetch";
import { writeFile } from "fs/promises";

// Same User-Agent already used for every other NSE/BSE request in this codebase (nse-client.ts,
// bse-client.ts) -- both exchanges 403 a plain unheaded request even for static file downloads
// like a filed PDF, not just their JSON APIs.
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export default async function downloadFile(url: string, destPath: string): Promise<void> {
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
  await writeFile(destPath, Buffer.from(await response.arrayBuffer()));
}
