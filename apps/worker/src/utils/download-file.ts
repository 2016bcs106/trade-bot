import fetch from "node-fetch";
import { writeFile } from "fs/promises";

export default async function downloadFile(url: string, destPath: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
  await writeFile(destPath, Buffer.from(await response.arrayBuffer()));
}
