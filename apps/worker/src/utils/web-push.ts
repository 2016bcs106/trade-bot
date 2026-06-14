import webpush from "web-push";
import createLogger from "./logger.ts";
import FirebaseClient from "../firebase/client.ts";

const log = createLogger("web-push");

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT;

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

export async function sendPushNotification(
  firebase: FirebaseClient,
  payload: { title: string; body: string; url?: string },
): Promise<void> {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return;

  const subscriptions = await firebase.getPushSubscriptions();
  const json = JSON.stringify(payload);

  await Promise.all(Object.entries(subscriptions).map(async ([key, sub]) => {
    try {
      await webpush.sendNotification(sub, json);
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        await firebase.removePushSubscription(key);
      } else {
        log.error("Failed to send push notification", err);
      }
    }
  }));
}
