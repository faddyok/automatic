import http from "node:http";
import { Telegraf, Markup } from "telegraf";
import { prepareSignup, purchase } from "./automation.js";

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) throw new Error("BOT_TOKEN is required.");

const APP_PORT = Number(process.env.APP_PORT || 3001);
const ALLOWED_ID = String(process.env.ALLOWED_TELEGRAM_ID || "").trim();
const PUBLIC_BASE_URL = String(process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
const TTL = Math.max(2, Number(process.env.SESSION_TTL_MINUTES || 10));

const bot = new Telegraf(BOT_TOKEN);
const inputs = new Map();
const jobs = new Map();

function allowed(ctx) {
  return !ALLOWED_ID || String(ctx.from?.id || "") === ALLOWED_ID;
}

async function guard(ctx) {
  if (allowed(ctx)) return false;
  await ctx.reply("This bot is private.");
  return true;
}

async function closeJob(id) {
  const j = jobs.get(id);
  if (!j) return;
  jobs.delete(id);
  clearTimeout(j.timer);
  try { await j.context.close(); } catch {}
  try { await j.browser.close(); } catch {}
}

function viewerUrl() {
  return PUBLIC_BASE_URL
    ? `${PUBLIC_BASE_URL}/novnc/vnc.html?autoconnect=true&resize=scale&path=websockify`
    : "(Set PUBLIC_BASE_URL in Railway first)";
}

function armJobTimer(id, job) {
  clearTimeout(job.timer);
  job.timer = setTimeout(() => closeJob(id), TTL * 60_000);
}

async function sendCheckoutReady(ctx, job, note = "Checkout is ready.") {
  await ctx.reply(
    [
      note,
      "",
      `Username: ${job.username}`,
      `Password: ${job.password}`,
      "",
      "Open the temporary browser:",
      viewerUrl(),
      "",
      "Enter the VNC password you set in Railway as VNC_PASSWORD.",
      "Then type the card directly into the checkout page.",
      "Return here and press Purchase when the card fields are complete.",
      "",
      `Session closes after ${TTL} minutes.`
    ].join("\n"),
    Markup.inlineKeyboard([
      Markup.button.callback("Purchase / Start Membership", "purchase"),
      Markup.button.callback("Cancel", "cancel_job")
    ])
  );
}

bot.start(async ctx => {
  if (await guard(ctx)) return;
  await ctx.reply(
    "/signup - begin\n/cancel - cancel current session\n/whoami - show your Telegram ID"
  );
});

bot.command("whoami", async ctx => ctx.reply(`Your Telegram user ID: ${ctx.from.id}`));

bot.command("cancel", async ctx => {
  if (await guard(ctx)) return;
  inputs.delete(ctx.from.id);
  await closeJob(ctx.from.id);
  await ctx.reply("Cancelled.");
});

bot.command("signup", async ctx => {
  if (await guard(ctx)) return;
  if (jobs.has(ctx.from.id)) return void ctx.reply("A browser is already active. Use /cancel first.");
  inputs.set(ctx.from.id, { step: "email", data: {} });
  await ctx.reply("Email:");
});

bot.on("text", async ctx => {
  if (await guard(ctx)) return;
  const s = inputs.get(ctx.from.id);
  if (!s) return;
  const v = ctx.message.text.trim();
  if (v.startsWith("/")) return;

  if (s.step === "email") {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return void ctx.reply("Send a valid email:");
    s.data.email = v; s.step = "first"; return void ctx.reply("First name:");
  }
  if (s.step === "first") {
    s.data.firstName = v; s.step = "last"; return void ctx.reply("Last name:");
  }
  if (s.step === "last") {
    s.data.lastName = v;
    s.step = "CARD_NUMBER";
    return void ctx.reply("CARD_NUMBER:");
  }

  if (s.step === "CARD_NUMBER") {
    s.data.CARD_NUMBER = v;
    s.step = "CARD_EXPIRY";
    return void ctx.reply("CARD_EXPIRY:");
  }

  if (s.step === "CARD_EXPIRY") {
    s.data.CARD_EXPIRY = v;
    s.step = "CARD_CVV";
    return void ctx.reply("CARD_CVV:");
  }

  if (s.step === "CARD_CVV") {
    s.data.CARD_CVV = v;
    s.step = "country";
    return void ctx.reply("Country:");
  }

  if (s.step === "country") {
    s.data.country = v; s.step = "zip"; return void ctx.reply("ZIP / postal code:");
  }

  if (s.step === "zip") {
    s.data.postalCode = v; s.step = "confirm";
    await ctx.reply(
      `Email: ${s.data.email}\nName: ${s.data.firstName} ${s.data.lastName}\nCARD_NUMBER: ${s.data.CARD_NUMBER}\nCARD_EXPIRY: ${s.data.CARD_EXPIRY}\nCARD_CVV: ${s.data.CARD_CVV}\nCountry: ${s.data.country}\nZIP: ${s.data.postalCode}`,
      Markup.inlineKeyboard([
        Markup.button.callback("Start automation", "begin"),
        Markup.button.callback("Cancel", "cancel_input")
      ])
    );
  }
});

bot.action("cancel_input", async ctx => {
  inputs.delete(ctx.from.id);
  await ctx.answerCbQuery();
  await ctx.reply("Cancelled.");
});

bot.action("begin", async ctx => {
  if (await guard(ctx)) return;
  const s = inputs.get(ctx.from.id);
  if (!s || s.step !== "confirm") return void ctx.answerCbQuery("Use /signup again.");
  inputs.delete(ctx.from.id);

  await ctx.answerCbQuery();
  await ctx.reply("Starting browser…");

  try {
    const job = await prepareSignup(s.data, async m => ctx.reply(`• ${m}`));
    jobs.set(ctx.from.id, job);
    armJobTimer(ctx.from.id, job);
    await sendCheckoutReady(ctx, job);
  } catch (e) {
    console.error(e);
    await ctx.reply(`Automation failed: ${e?.message || String(e)}`);
  }
});

bot.action("cancel_job", async ctx => {
  await ctx.answerCbQuery();
  await closeJob(ctx.from.id);
  await ctx.reply("Browser closed.");
});

bot.action("purchase", async ctx => {
  if (await guard(ctx)) return;
  const job = jobs.get(ctx.from.id);
  if (!job) return void ctx.answerCbQuery("No active browser session.");
  await ctx.answerCbQuery();

  try {
    await ctx.reply("Clicking Purchase / Start Membership and waiting for the result…");
    const result = await purchase(job.page);

    if (result.state === "success") {
      await ctx.reply(
        [
          "Subscription purchased successfully.",
          `Email: ${job.email}`,
          `Username: ${job.username}`,
          `Password: ${job.password}`,
          `Page: ${result.title || result.url}`
        ].join("\n")
      );
      await closeJob(ctx.from.id);
      return;
    }

    if (result.state === "error") {
      armJobTimer(ctx.from.id, job);
      await ctx.reply(
        [
          "The checkout reported a payment error/decline.",
          result.message ? `Detected: ${result.message}` : "",
          "Open the same browser, update the payment details if needed, then press the button below to resubmit on the same page."
        ].filter(Boolean).join("\n"),
        Markup.inlineKeyboard([
          Markup.button.callback("Resubmit on same page", "purchase"),
          Markup.button.callback("Cancel", "cancel_job")
        ])
      );
      return;
    }

    if (result.state === "join") {
      const profile = job.profile;
      await ctx.reply("Returned to the join page. Restarting from the first step with the same details…");
      await closeJob(ctx.from.id);

      const restarted = await prepareSignup(
        profile,
        async m => ctx.reply(`• ${m}`),
        { fillPayment: false }
      );
      jobs.set(ctx.from.id, restarted);
      armJobTimer(ctx.from.id, restarted);
      await sendCheckoutReady(
        ctx,
        restarted,
        "Checkout is ready again. Your account details were reused; enter/review the payment details in the browser before purchasing."
      );
      return;
    }

    armJobTimer(ctx.from.id, job);
    await ctx.reply(
      [
        "No final success/error page was detected yet.",
        "The browser has been left open so you can check it and press Purchase again when ready.",
        `Page: ${result.title || result.url}`
      ].join("\n"),
      Markup.inlineKeyboard([
        Markup.button.callback("Check / submit again", "purchase"),
        Markup.button.callback("Cancel", "cancel_job")
      ])
    );
  } catch (e) {
    const current = jobs.get(ctx.from.id);
    if (current) armJobTimer(ctx.from.id, current);
    await ctx.reply(
      `Purchase step failed: ${e?.message || String(e)}`,
      Markup.inlineKeyboard([
        Markup.button.callback("Try again", "purchase"),
        Markup.button.callback("Cancel", "cancel_job")
      ])
    );
  }
});

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    return void res.end(JSON.stringify({ ok: true }));
  }
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("Telegram Playwright bot is running.");
});

server.listen(APP_PORT, "0.0.0.0", () => console.log(`Node app listening on ${APP_PORT}`));

await bot.launch({ dropPendingUpdates: true });
console.log("Telegram long polling started.");

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
