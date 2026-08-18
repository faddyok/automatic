# Telegram + Railway + Playwright v3

This version gives you an **interactive temporary browser inside Railway** using noVNC.

## What changed

- Password is exactly **16 characters**.
- Generates a random username.
- Browser runs visibly inside a virtual desktop on Railway.
- Telegram sends a temporary browser link.
- You type card details **directly into the checkout page**, not into Telegram.
- After card entry, press **Purchase / Start Membership** in Telegram.
- Playwright clicks the final purchase button.
- Browser session closes automatically.

## Railway variables

Add:

```text
BOT_TOKEN=your_telegram_bot_token
ALLOWED_TELEGRAM_ID=your_numeric_telegram_id
PUBLIC_BASE_URL=https://your-service.up.railway.app
VNC_PASSWORD=make-a-random-password
SESSION_TTL_MINUTES=10
```

Keep `VNC_PASSWORD` private.

## Important: generate a Railway domain

Railway -> your service -> Settings -> Networking -> Generate Domain.

Copy the generated `https://...up.railway.app` URL and put it into:

```text
PUBLIC_BASE_URL=https://...
```

Then redeploy.

## Telegram flow

```text
/signup
→ email
→ first name
→ last name
→ country
→ ZIP
→ Start automation
→ bot opens promotion
→ FREE WEEK IS BACK
→ email
→ FREE 7 DAYS
→ checkout
→ random username
→ 16-character password
→ name/country/ZIP
→ Telegram sends noVNC browser link
→ open link
→ enter VNC_PASSWORD
→ type card directly on checkout
→ return to Telegram
→ Purchase / Start Membership
→ bot clicks purchase
→ username/password/result returned
```

## Card handling

The bot does not ask for card number, expiry, or CVV in Telegram and does not store them. They are typed directly into the remote browser showing the site's checkout page.

## If selectors change

The website can change its HTML. If a button stops working, inspect the visible browser through noVNC and update the corresponding fallback locators in `src/automation.js`.
