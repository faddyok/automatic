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
    s.step = "tree";
    return void ctx.reply("Tree:");
  }

  if (s.step === "tree") {
    s.data.tree = v;
    s.step = "fruit";
    return void ctx.reply("Fruit:");
  }

  if (s.step === "fruit") {
    s.data.fruit = v;
    s.step = "flower";
    return void ctx.reply("Flower:");
  }

  if (s.step === "flower") {
    s.data.flower = v;
    s.step = "country";
    return void ctx.reply("Country:");
  }

  if (s.step === "country") {
    s.data.country = v; s.step = "zip"; return void ctx.reply("ZIP / postal code:");
  }

  if (s.step === "zip") {
    s.data.postalCode = v; s.step = "confirm";
    await ctx.reply(
      `Email: ${s.data.email}\nName: ${s.data.firstName} ${s.data.lastName}\nTree: ${s.data.tree}\nFruit: ${s.data.fruit}\nFlower: ${s.data.flower}\nCountry: ${s.data.country}\nZIP: ${s.data.postalCode}`,
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
    job.timer = setTimeout(() => closeJob(ctx.from.id), TTL * 60_000);
    jobs.set(ctx.from.id, job);

    const viewer = PUBLIC_BASE_URL
      ? `${PUBLIC_BASE_URL}/novnc/vnc.html?autoconnect=true&resize=scale&path=websockify`
      : "(Set PUBLIC_BASE_URL in Railway first)";

    await ctx.reply(
      [
        "Checkout is ready.",
        "",
        `Username: ${job.username}`,
        `Password: ${job.password}`,
        "",
        "Open the temporary browser:",
        viewer,
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
    await ctx.reply("Clicking Purchase / Start Membership…");
    const result = await purchase(job.page);
    await ctx.reply(
      [
        "Purchase button clicked.",
        `Email: ${job.email}`,
        `Username: ${job.username}`,
        `Password: ${job.password}`,
        `Page: ${result.title || result.url}`
      ].join("\n")
    );
  } catch (e) {
    await ctx.reply(`Purchase step failed: ${e?.message || String(e)}`);
  } finally {
    await closeJob(ctx.from.id);
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
