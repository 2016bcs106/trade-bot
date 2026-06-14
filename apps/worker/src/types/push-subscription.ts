export interface PushSubscriptionData {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}
