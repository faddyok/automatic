import http from "node:http";
import fs from "node:fs/promises";
import { Telegraf, Markup } from "telegraf";
import { runSignup } from "./automation.js";

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN is required.");
}

const ALLOWED_TELEGRAM_ID = String(process.env.ALLOWED_TELEGRAM_ID || "").trim();
const PORT = Number(process.env.PORT || 3000);

const bot = new Telegraf(BOT_TOKEN);
const sessions = new Map();
const activeUsers = new Set();

function allowed(ctx) {
  if (!ALLOWED_TELEGRAM_ID) return true;
  return String(ctx.from?.id ?? "") === ALLOWED_TELEGRAM_ID;
}

async function denyIfNeeded(ctx) {
  if (allowed(ctx)) return false;
  await ctx.reply("This bot is private.");
  return true;
}

function newSession() {
  return {
    step: "email",
    data: {}
  };
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function validPostal(value) {
  return /^[A-Za-z0-9][A-Za-z0-9 -]{1,11}$/.test(value);
}

function summary(data) {
  return [
    "Please confirm:",
    "",
    `Email: ${data.email}`,
    `Name: ${data.firstName} ${data.lastName}`,
    `Country: ${data.country}`,
    `Postal/ZIP: ${data.postalCode}`,
    "",
    "The browser will select the currently displayed FREE 7 DAYS offer and reach the secure payment page.",
    "It will NOT collect, store, or enter card number, expiration date, or CVV.",
    "Check the site's current renewal price/terms before completing any payment."
  ].join("\n");
}

bot.start(async (ctx) => {
  if (await denyIfNeeded(ctx)) return;
  await ctx.reply(
    [
      "Signup helper is online.",
      "",
      "/signup - start a signup",
      "/cancel - cancel the current input flow",
      "/whoami - show your Telegram user ID",
      "",
      "This bot automates the landing/signup steps and stops at secure payment entry."
    ].join("\n")
  );
});

bot.command("whoami", async (ctx) => {
  await ctx.reply(`Your Telegram user ID: ${ctx.from.id}`);
});

bot.command("cancel", async (ctx) => {
  if (await denyIfNeeded(ctx)) return;
  sessions.delete(ctx.from.id);
  await ctx.reply("Cancelled.");
});

bot.command("signup", async (ctx) => {
  if (await denyIfNeeded(ctx)) return;

  if (activeUsers.has(ctx.from.id)) {
    await ctx.reply("A browser job is already running for you.");
    return;
  }

  sessions.set(ctx.from.id, newSession());
  await ctx.reply("Send the email address you want to use:");
});

bot.on("text", async (ctx) => {
  if (await denyIfNeeded(ctx)) return;

  const userId = ctx.from.id;
  const session = sessions.get(userId);
  if (!session) return;

  const value = ctx.message.text.trim();

  if (value.startsWith("/")) return;

  if (session.step === "email") {
    if (!validEmail(value)) {
      await ctx.reply("That does not look like a valid email. Send it again:");
      return;
    }
    session.data.email = value;
    session.step = "firstName";
    await ctx.reply("First name:");
    return;
  }

  if (session.step === "firstName") {
    if (value.length < 1 || value.length > 60) {
      await ctx.reply("Send a valid first name:");
      return;
    }
    session.data.firstName = value;
    session.step = "lastName";
    await ctx.reply("Last name:");
    return;
  }

  if (session.step === "lastName") {
    if (value.length < 1 || value.length > 60) {
      await ctx.reply("Send a valid last name:");
      return;
    }
    session.data.lastName = value;
    session.step = "country";
    await ctx.reply('Country exactly as it appears at checkout, for example "United States":');
    return;
  }

  if (session.step === "country") {
    if (value.length < 2 || value.length > 80) {
      await ctx.reply("Send a valid country name:");
      return;
    }
    session.data.country = value;
    session.step = "postalCode";
    await ctx.reply("ZIP / postal code:");
    return;
  }

  if (session.step === "postalCode") {
    if (!validPostal(value)) {
      await ctx.reply("Send a valid ZIP / postal code:");
      return;
    }

    session.data.postalCode = value;
    session.step = "confirm";

    await ctx.reply(
      summary(session.data),
      Markup.inlineKeyboard([
        Markup.button.callback("Start automation", "begin_signup"),
        Markup.button.callback("Cancel", "cancel_signup")
      ])
    );
  }
});

bot.action("cancel_signup", async (ctx) => {
  if (await denyIfNeeded(ctx)) return;
  sessions.delete(ctx.from.id);
  await ctx.answerCbQuery();
  await ctx.editMessageReplyMarkup(undefined).catch(() => {});
  await ctx.reply("Cancelled.");
});

bot.action("begin_signup", async (ctx) => {
  if (await denyIfNeeded(ctx)) return;

  const userId = ctx.from.id;
  const session = sessions.get(userId);

  if (!session || session.step !== "confirm") {
    await ctx.answerCbQuery("Start /signup again.");
    return;
  }

  if (activeUsers.has(userId)) {
    await ctx.answerCbQuery("A job is already running.");
    return;
  }

  const profile = { ...session.data };
  sessions.delete(userId);
  activeUsers.add(userId);

  await ctx.answerCbQuery();
  await ctx.editMessageReplyMarkup(undefined).catch(() => {});
  await ctx.reply("Starting Chromium on Railway…");

  void (async () => {
    let result;
    try {
      result = await runSignup(profile, async (message) => {
        await ctx.reply(`• ${message}`);
      });

      const lines = [
        "Browser automation finished.",
        "",
        `Email: ${result.email}`,
        `Generated password: ${result.password}`,
        "",
        `Reached: ${result.reachedPaymentPage ? "secure payment page" : "signup flow"}`,
        "",
        "Payment was NOT submitted. Card number, expiration date and CVV are intentionally not accepted by this bot.",
        "Use the offer only if you are eligible, and review the current renewal terms before completing checkout."
      ];

      await ctx.reply(lines.join("\n"));

      if (result.screenshotPath && process.env.SEND_CHECKOUT_SCREENSHOT !== "false") {
        try {
          await ctx.replyWithPhoto({ source: result.screenshotPath }, {
            caption: "Checkout-stage screenshot for debugging. No card data is entered."
          });
        } finally {
          await fs.unlink(result.screenshotPath).catch(() => {});
        }
      }
    } catch (error) {
      console.error(error);
      await ctx.reply(`Automation failed: ${error?.message || String(error)}`);
    } finally {
      activeUsers.delete(userId);
      if (result?.screenshotPath) {
        await fs.unlink(result.screenshotPath).catch(() => {});
      }
    }
  })();
});

bot.catch((err, ctx) => {
  console.error("Telegram bot error:", err, "update:", ctx?.update?.update_id);
});

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  res.writeHead(200, { "content-type": "text/plain" });
  res.end("Telegram Playwright bot is running.");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Health server listening on ${PORT}`);
});

await bot.launch({ dropPendingUpdates: true });
console.log("Telegram long polling started.");

const shutdown = async (signal) => {
  console.log(`Received ${signal}; shutting down.`);
  bot.stop(signal);
  server.close(() => process.exit(0));
};

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
