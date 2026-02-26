const token = process.env.TELEGRAM_BOT_TOKEN;
const baseUrl = process.env.WEBHOOK_BASE_URL;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;

if (!token) {
  console.error("Missing TELEGRAM_BOT_TOKEN");
  process.exit(1);
}

if (!baseUrl) {
  console.error("Missing WEBHOOK_BASE_URL (e.g. https://your-app.up.railway.app)");
  process.exit(1);
}

const webhookUrl = `${baseUrl.replace(/\/+$/, "")}/api/telegram/webhook`;

const payload = {
  url: webhookUrl,
  allowed_updates: ["message", "edited_message", "callback_query"],
};

if (secret) {
  payload.secret_token = secret;
}

const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
});

const json = await response.json();
console.log(JSON.stringify({ webhookUrl, response: json }, null, 2));

if (!response.ok || !json.ok) {
  process.exit(1);
}
