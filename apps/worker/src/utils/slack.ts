import createLogger from "./logger.ts";

const log = createLogger("slack");

const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const SLACK_CHANNEL_ID = process.env.SLACK_CHANNEL_ID;

export async function sendSlackMessage(message: string): Promise<void> {
  if (!SLACK_WEBHOOK_URL) return;

  try {
    await fetch(SLACK_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
  } catch {}
}

/**
 * Posts a rich Block Kit message via the Slack Web API (chat.postMessage) using a bot token,
 * rather than an incoming webhook -- required for Block Kit layouts (headers, field grids,
 * buttons) beyond what a webhook's plain-text payload supports. `fallbackText` is Slack's
 * required plain-text summary, used for notification previews and accessibility.
 * Unlike sendSlackMessage, this checks Slack's response body for `ok: false` and logs failures --
 * the Slack API returns HTTP 200 even on error, with the actual failure reason only in the body.
 *
 * `color` (a hex string) wraps the blocks in a Slack "attachment" to get a colored side-bar --
 * plain top-level `blocks` have no color support, only attachments do. Note this changes where
 * `fallbackText` goes: a top-level `text` renders as its own visible message line *in addition
 * to* the attachment's blocks (duplicating a header block that says the same thing), whereas an
 * attachment's `fallback` field is never rendered in-channel, only used for notifications -- so
 * fallbackText goes into `fallback` when `color` (and therefore attachments) is used.
 */
export async function sendSlackBlocks(blocks: unknown[], fallbackText: string, color?: string): Promise<void> {
  if (!SLACK_BOT_TOKEN || !SLACK_CHANNEL_ID) return;

  try {
    const payload: Record<string, unknown> = { channel: SLACK_CHANNEL_ID };
    if (color) {
      payload.attachments = [{ color, fallback: fallbackText, blocks }];
    } else {
      payload.text = fallbackText;
      payload.blocks = blocks;
    }

    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Authorization": `Bearer ${SLACK_BOT_TOKEN}`,
      },
      body: JSON.stringify(payload),
    });

    const body = (await response.json()) as { ok: boolean; error?: string };
    if (!body.ok) {
      log.error(`Slack chat.postMessage failed: ${body.error}`);
    }
  } catch (err) {
    log.error("Slack chat.postMessage request failed", err);
  }
}
