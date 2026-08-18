import crypto from "node:crypto";
import { chromium } from "playwright";

const DEFAULT_LANDING_URL ="https://landing.brazzersnetwork.com/?ats=eyJhIjoyODc2NDUsImMiOjU2NTA2NDU4LCJuIjoxNCwicyI6OTAsImUiOjg4MDMsInAiOjMzOX0%3D&atc=Autocampaign_Default&apb=a0c0d05cbba04769%7Cbrazzers";


function password16() {
  // Exactly 16 chars. Includes upper/lower/digit/symbol.
  const tail = crypto.randomBytes(8).toString("hex").slice(0, 12);
  return `Aa7!${tail}`; // 16 characters total
}

function randomUsername() {
  return `bz${crypto.randomBytes(5).toString("hex")}`; // 12 chars
}

async function clickAny(list, label, timeout = 3000) {
  let last;
  for (const loc of list) {
    try {
      await loc.first().waitFor({ state: "visible", timeout });
      await loc.first().click({ timeout });
      return true;
    } catch (e) { last = e; }
  }
  throw new Error(`Could not click ${label}.${last ? " " + last.message : ""}`);
}

async function fillAny(list, value, label, timeout = 2500, required = true) {
  let last;
  for (const loc of list) {
    try {
      await loc.first().waitFor({ state: "visible", timeout });
      await loc.first().fill(value);
      return true;
    } catch (e) { last = e; }
  }
  if (required) throw new Error(`Could not fill ${label}.${last ? " " + last.message : ""}`);
  return false;
}

async function chooseCountry(page, country) {
  for (const loc of [
    page.locator('select[name*="country" i]'),
    page.locator('select[id*="country" i]')
  ]) {
    try {
      if (await loc.first().isVisible({ timeout: 1000 })) {
        await loc.first().selectOption({ label: country });
        return true;
      }
    } catch {}
  }
  return false;
}

export async function prepareSignup(profile, status = async () => {}) {
  const browser = await chromium.launch({
    headless: false,
    args: ["--disable-dev-shm-usage", "--start-maximized"]
  });

  const context = await browser.newContext({
    viewport: null,
    locale: "en-US"
  });

  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.setDefaultNavigationTimeout(30000);

  const password = password16();
  const username = randomUsername();

  await status("Opening promotion");
  await page.goto(process.env.LANDING_URL || DEFAULT_LANDING_URL, {
    waitUntil: "domcontentloaded"
  });

  await status("Clicking FREE WEEK IS BACK");
  await clickAny([
    page.getByRole("link", { name: /free week/i }),
    page.getByRole("button", { name: /free week/i }),
    page.getByText(/free week is back/i),
    page.locator('a:has(img[alt*="free" i])'),
    page.locator('a[href*="join" i]').first()
  ], "FREE WEEK IS BACK");

  await status("Entering email");
  await fillAny([
    page.locator('input[type="email"]'),
    page.locator('input[placeholder*="email" i]'),
    page.locator('input[name*="email" i]')
  ], profile.email, "email");

  await clickAny([
    page.getByRole("button", { name: /continue to start/i }),
    page.getByRole("link", { name: /continue to start/i }),
    page.getByText(/continue to start/i)
  ], "CONTINUE TO START");

  await status("Selecting FREE 7 DAYS");
  await page.getByText(/FREE 7 DAYS/i).first()
    .waitFor({ state: "visible", timeout: 15000 });

  await clickAny([
    page.getByRole("button", { name: /credit card/i }),
    page.getByRole("link", { name: /credit card/i }),
    page.getByText(/^Credit Card$/i)
  ], "Credit Card", 1800).catch(() => {});

  await clickAny([
    page.getByRole("button", { name: /free 7 days/i }),
    page.getByRole("link", { name: /free 7 days/i }),
    page.getByText(/FREE 7 DAYS/i)
  ], "FREE 7 DAYS");

  await page.waitForTimeout(800);

  if (!/probiller/i.test(page.url())) {
    await clickAny([
      page.getByRole("button", { name: /get access/i }),
      page.getByRole("link", { name: /get access/i }),
      page.getByRole("button", { name: /start membership/i }),
      page.getByText(/get access/i)
    ], "Get Access", 2500).catch(() => {});
  }

  await status("Waiting for secure checkout");
  await Promise.race([
    page.waitForURL(/probiller/i, { timeout: 20000 }).catch(() => null),
    page.locator('input[placeholder*="Card Number" i], input[name*="card" i]')
      .first().waitFor({ state: "visible", timeout: 20000 }).catch(() => null)
  ]);



  
const cardFrame = page.frameLocator('#tx_iframe_ccNumber');
const cvvFrame = page.frameLocator('#tx_iframe_cvv_cvv');

// Check that checkout was actually reached
const atCheckout =
  /probiller/i.test(page.url()) ||
  await cardFrame
    .locator('input[name="cardNumber"]')
    .isVisible()
    .catch(() => false);

if (!atCheckout) {
  throw new Error("Secure checkout was not reached.");
}

await status("Filling username/password/name/address");

await fillAny([
  page.locator('input[placeholder*="Password" i]'),
  page.locator('input[name*="password" i]')
], password, "password");

await fillAny([
  page.locator('input[placeholder*="Username" i]'),
  page.locator('input[name*="username" i]'),
  page.locator('input[name="username"]')
], username, "username", 1200, false);

await fillAny([
  page.locator('input[placeholder*="First Name" i]'),
  page.locator('input[name*="first" i]')
], profile.firstName, "first name");

await fillAny([
  page.locator('input[placeholder*="Last Name" i]'),
  page.locator('input[name*="last" i]')
], profile.lastName, "last name");

await chooseCountry(page, profile.country);

await fillAny([
  page.locator('input[placeholder*="Zip" i]'),
  page.locator('input[placeholder*="Postal" i]'),
  page.locator('input[name*="zip" i]'),
  page.locator('input[name*="postal" i]')
], profile.postalCode, "ZIP/postal code");


// CARD NUMBER
await cardFrame
  .locator('input[name="cardNumber"]')
  .waitFor({ state: "visible" });

await cardFrame
  .locator('input[name="cardNumber"]')
  .fill(profile.CARD_NUMBER);


// EXPIRY
await page
  .locator('input[name="cc-exp"]')
  .waitFor({ state: "visible" });

await page
  .locator('input[name="cc-exp"]')
  .fill(profile.CARD_EXPIRY);


// CVV
await cvvFrame
  .locator('input[name="Data"]')
  .waitFor({ state: "visible" });

await cvvFrame
  .locator('input[name="Data"]')
  .fill(profile.CARD_CVV);


return {
  browser,
  context,
  page,
  email: profile.email,
  username,
  password
};}

export async function purchase(page) {
  await clickAny([
    page.getByRole("button", { name: /purchase/i }),
    page.getByRole("button", { name: /start membership/i }),
    page.getByRole("button", { name: /complete purchase/i }),
    page.getByRole("button", { name: /join now/i }),
    page.getByText(/^Purchase$/i)
  ], "Purchase / Start Membership", 3500);

  await page.waitForTimeout(3000);
  return {
    url: page.url(),
    title: await page.title().catch(() => "")
  };
}
