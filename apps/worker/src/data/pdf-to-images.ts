import { execFile } from "child_process";
import { promisify } from "util";
import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

const execFileAsync = promisify(execFile);

export async function getPageCount(pdfPath: string): Promise<number> {
  const { stdout } = await execFileAsync("pdfinfo", [pdfPath]);
  const match = stdout.match(/^Pages:\s+(\d+)/m);
  if (!match) throw new Error(`Could not determine page count for ${pdfPath}`);
  return parseInt(match[1], 10);
}

/** Renders specific 1-indexed pages of a PDF to PNG buffers, in the order given. */
export default async function renderPages(pdfPath: string, pages: number[]): Promise<Buffer[]> {
  const workDir = await mkdtemp(join(tmpdir(), "pdf-render-"));
  try {
    const buffers: Buffer[] = [];
    for (const page of pages) {
      const imagePrefix = join(workDir, `page-${page}`);
      await execFileAsync("pdftoppm", ["-png", "-r", "200", "-f", String(page), "-l", String(page), "-singlefile", pdfPath, imagePrefix]);
      buffers.push(await readFile(`${imagePrefix}.png`));
    }
    return buffers;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
