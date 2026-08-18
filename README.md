# Railway + Telegram + Playwright signup helper

This project runs a Telegram bot on Railway and launches Chromium only when a signup is requested.

It automates:

1. Open the configured landing page.
2. Click the **FREE WEEK IS BACK** promotion.
3. Enter the email and press **CONTINUE TO START**.
4. Select **Credit Card** as the checkout method.
5. Select the **FREE 7 DAYS** offer and continue to checkout.
6. Generate/fill a password, first name, last name, country and ZIP/postal code.
7. Stop at the secure payment page.

## Important boundary

The project intentionally **does not collect, store, transmit, or enter**:

- card number
- expiration date
- CVV/security code

It also does not submit the final payment, bypass CAPTCHA/3-D Secure/age checks, or bypass trial/eligibility limits.

Use it only for an account/payment method you are authorized to use. Review the site's current renewal price and terms before completing checkout.

## Files

```text
.
├── Dockerfile
├── railway.toml
├── package.json
├── .env.example
└── src
    ├── index.js
    └── automation.js
```

## 1. Create a Telegram bot

Create a bot with BotFather and copy the token.

Do not commit that token to GitHub.

## 2. Put the project on GitHub

Create a repository and upload all files in this folder.

## 3. Deploy on Railway

In Railway:

1. Create a new project.
2. Choose **Deploy from GitHub repo**.
3. Select this repository.
4. Railway will see the `Dockerfile` and build it.
5. Add the environment variable:

```text
BOT_TOKEN=your_bot_token
```

Optional but strongly recommended:

```text
ALLOWED_TELEGRAM_ID=your_numeric_telegram_id
```

You can deploy once without `ALLOWED_TELEGRAM_ID`, message `/whoami` to the bot, copy the returned numeric ID, add it to Railway Variables, then redeploy.

The landing URL is already included as a default. You can override it in Railway:

```text
LANDING_URL=https://...
```

## 4. Long polling

This project uses Telegram long polling, so you do **not** need:

- a Telegram webhook
- a custom domain
- `PUBLIC_URL`

If this bot token was previously configured with a webhook, remove the webhook once before using long polling:

```bash
curl -X POST "https://api.telegram.org/bot$BOT_TOKEN/deleteWebhook?drop_pending_updates=true"
```

## 5. Use the bot

Send:

```text
/signup
```

The bot asks for:

- email
- first name
- last name
- country
- ZIP/postal code

Then it shows a confirmation button and starts Chromium.

## 6. Railway health check

The app exposes:

```text
/health
```

Railway uses this to verify the container is alive.

## 7. Debugging selectors

The live website may change its HTML at any time. The code uses multiple text/role/placeholder fallbacks instead of relying on a single CSS class.

If the bot says a button or field could not be found:

1. Check the screenshot the bot sends.
2. Open `src/automation.js`.
3. Find the relevant `clickFirst(...)` or `fillFirst(...)`.
4. Add the new locator.

For local debugging you can run Playwright headed by setting:

```text
HEADLESS=false
```

That is useful on your own computer, but Railway normally needs:

```text
HEADLESS=true
```

## 8. Local run

Requires Node.js 20+ and Playwright browser dependencies.

```bash
npm install
npx playwright install chromium
BOT_TOKEN="your_token" npm start
```

On Windows PowerShell:

```powershell
$env:BOT_TOKEN="your_token"
npm start
```

## Security notes

- Keep `BOT_TOKEN` only in Railway Variables or a local `.env` that is not committed.
- Set `ALLOWED_TELEGRAM_ID` so strangers cannot operate your bot.
- Never put raw payment-card data into Telegram messages, GitHub, `.env`, MongoDB, or Railway Variables for this project.
- The bot only generates a site password in memory and sends it back to the authorized Telegram chat.
