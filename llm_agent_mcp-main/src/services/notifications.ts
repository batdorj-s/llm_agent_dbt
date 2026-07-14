import { getPool } from "../db/pool.js";

export type NotificationChannel = "email" | "slack" | "telegram";

export interface NotificationConfig {
  id: string;
  user_id: string;
  channel: NotificationChannel;
  enabled: boolean;
  config: Record<string, string>; // { webhook_url, api_key, chat_id, smtp_host, ... }
  created_at: string;
}

export interface NotificationMessage {
  subject: string;
  body: string;
  attachments?: { filename: string; content: Buffer }[];
}

async function sendEmail(config: Record<string, string>, message: NotificationMessage): Promise<void> {
  const nodemailer = await import("nodemailer");
  const transporter = nodemailer.default.createTransport({
    host: config.smtp_host || "smtp.ethereal.email",
    port: parseInt(config.smtp_port || "587", 10),
    secure: config.smtp_secure === "true",
    auth: {
      user: config.smtp_user || "",
      pass: config.smtp_pass || "",
    },
  });
  await transporter.sendMail({
    from: config.from_email || "noreply@enterprise.ai",
    to: config.to_email,
    subject: message.subject,
    text: message.body,
    attachments: message.attachments?.map(a => ({
      filename: a.filename,
      content: a.content,
    })),
  });
}

async function sendSlack(config: Record<string, string>, message: NotificationMessage): Promise<void> {
  const webhookUrl = config.webhook_url;
  if (!webhookUrl) throw new Error("Slack webhook URL not configured");
  const blocks: any[] = [
    { type: "header", text: { type: "plain_text", text: message.subject } },
    { type: "section", text: { type: "mrkdwn", text: message.body } },
  ];
  const payload: any = { blocks };
  if (message.attachments && message.attachments.length > 0) {
    payload.text = `${message.subject}\n\n${message.body}`;
  }
  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function sendTelegram(config: Record<string, string>, message: NotificationMessage): Promise<void> {
  const botToken = config.bot_token;
  const chatId = config.chat_id;
  if (!botToken || !chatId) throw new Error("Telegram bot token or chat ID not configured");
  const text = `*${message.subject}*\n\n${message.body}`;
  const resp = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" }),
  });
  if (!resp.ok) {
    const errBody = await resp.text();
    throw new Error(`Telegram API error (${resp.status}): ${errBody}`);
  }
}

const CHANNEL_SENDERS: Record<NotificationChannel, (cfg: Record<string, string>, msg: NotificationMessage) => Promise<void>> = {
  email: sendEmail,
  slack: sendSlack,
  telegram: sendTelegram,
};

export async function sendNotification(
  userId: string,
  channel: NotificationChannel,
  message: NotificationMessage
): Promise<void> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT id, channel, enabled, config FROM notification_preferences
     WHERE user_id = $1 AND channel = $2 AND enabled = true
     LIMIT 1`,
    [userId, channel]
  );
  if (result.rows.length === 0) {
    console.log(`[notifications] No active ${channel} config for user ${userId}, skipping`);
    return;
  }
  const pref = result.rows[0];
  const sender = CHANNEL_SENDERS[channel];
  if (!sender) throw new Error(`Unsupported notification channel: ${channel}`);
  await sender(pref.config, message);
  console.log(`[notifications] Sent ${channel} notification to user ${userId}: "${message.subject}"`);
}

export async function sendNotificationToAllChannels(
  userId: string,
  message: NotificationMessage
): Promise<{ channel: NotificationChannel; success: boolean; error?: string }[]> {
  const pool = getPool();
  const result = await pool.query(
    `SELECT channel, config FROM notification_preferences
     WHERE user_id = $1 AND enabled = true`,
    [userId]
  );
  const results: { channel: NotificationChannel; success: boolean; error?: string }[] = [];
  for (const row of result.rows) {
    const channel = row.channel as NotificationChannel;
    const sender = CHANNEL_SENDERS[channel];
    if (!sender) continue;
    try {
      await sender(row.config, message);
      results.push({ channel, success: true });
    } catch (err) {
      const msg = (err as Error).message;
      console.error(`[notifications] ${channel} failed for user ${userId}: ${msg}`);
      results.push({ channel, success: false, error: msg });
    }
  }
  return results;
}

export async function sendBulkNotification(
  userIds: string[],
  message: NotificationMessage,
  channel?: NotificationChannel
): Promise<{ userId: string; success: boolean; error?: string }[]> {
  const results: { userId: string; success: boolean; error?: string }[] = [];
  for (const uid of userIds) {
    try {
      if (channel) {
        await sendNotification(uid, channel, message);
      } else {
        await sendNotificationToAllChannels(uid, message);
      }
      results.push({ userId: uid, success: true });
    } catch (err) {
      results.push({ userId: uid, success: false, error: (err as Error).message });
    }
  }
  return results;
}
