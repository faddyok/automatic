import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const DEFAULT_LANDING_URL =
  "https://landing.brazzersnetwork.com/?ats=eyJhIjoyODc2NDUsImMiOjU2NTA2NDU4LCJuIjoxNCwicyI6OTAsImUiOjg4MDMsInAiOjMzOX0%3D&atc=Autocampaign_Default&apb=23e52e0c40074a70%7Cbrazzers";

function generatePassword() {
  // Site-friendly: upper, lower, digit, symbol, plus random material.
  const random = crypto.randomBytes(12).toString("base64url");
  return `Bz!7a${random}`;
}

async function clickFirst(candidates, description, perCandidateTimeout = 2500) {
  let lastError;

  for (const locator of candidates) {
    try {
      await locator.first().waitFor({
        state: "visible",
        timeout: perCandidateTimeout
      });
      await locator.first().click({ timeout: perCandidateTimeout });
      return;
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(
    `Could not find/click ${description}. The page layout may have changed.${lastError ? ` Last error: ${lastError.message}` : ""}`
  );
}

async function fillFirst(candidates, value, description, perCandidateTimeout = 2000) {
  let lastError;

  for (const locator of candidates) {
    try {
      await locator.first().waitFor({
        state: "visible",
        timeout: perCandidateTimeout
      });
      await locator.first().fill(value);
      return;
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(
    `Could not fill ${description}.${lastError ? ` Last error: ${lastError.message}` : ""}`
  );
}

async function chooseCountry(page, country) {
  const selectCandidates = [
    page.locator('select[name*="country" i]'),
    page.locator('select[id*="country" i]')
  ];

  for (const locator of selectCandidates) {
    try {
      if (await locator.first().isVisible({ timeout: 1200 })) {
        await locator.first().selectOption({ label: country });
        return true;
      }
    } catch {
      // Try custom dropdown below.
    }
  }

  const customDropdownCandidates = [
    page.getByRole("combobox", { name: /country/i }),
    page.locator('[role="combobox"]').filter({ hasText: /United States|country/i }),
    page.getByText(/United States/i)
  ];

  for (const locator of customDropdownCandidates) {
    try {
      await locator.first().waitFor({ state: "visible", timeout: 1200 });
      await locator.first().click();
      const option = page.getByRole("option", { name: new RegExp(`^${escapeRegExp(country)}$`, "i") });
      if (await option.first().isVisible({ timeout: 1500 })) {
        await option.first().click();
        return true;
      }
      const textOption = page.getByText(new RegExp(`^${escapeRegExp(country)}$`, "i"));
      if (await textOption.first().isVisible({ timeout: 1500 })) {
        await textOption.first().click();
        return true;
      }
    } catch {
      // Keep trying.
    }
  }

  return false;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function safeScreenshot(page, label = "checkout") {
  const screenshotPath = path.join(
    os.tmpdir(),
    `${label}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}.png`
  );

  try {
    await page.screenshot({
      path: screenshotPath,
      fullPage: false
    });
    return screenshotPath;
  } catch {
    return null;
  }
}

export async function runSignup(profile, onStatus = async () => {}) {
  // Deliberate safety guard: never accept payment credentials through env vars.
  const forbiddenPaymentVars = [
    "CARD_NUMBER",
    "CARD_CVV",
    "CVV",
    "CARD_EXPIRY",
    "CARD_EXP",
    "CARD_SECURITY_CODE"
  ];

  if (forbiddenPaymentVars.some((name) => process.env[name])) {
    throw new Error(
      "Raw payment-card environment variables are not supported. Remove them before running."
    );
  }

  const landingUrl = process.env.LANDING_URL || DEFAULT_LANDING_URL;
  const headless = process.env.HEADLESS !== "false";
  const password = generatePassword();

  const browser = await chromium.launch({
    headless,
    args: ["--disable-dev-shm-usage"]
  });

  let page;
  let screenshotPath = null;

  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      locale: "en-US"
    });

    page = await context.newPage();
    page.setDefaultTimeout(12000);
    page.setDefaultNavigationTimeout(30000);

    await onStatus("Opening landing page");
    await page.goto(landingUrl, { waitUntil: "domcontentloaded" });

    await onStatus('Clicking "FREE WEEK IS BACK" promotion');
    await clickFirst(
      [
        page.getByRole("link", { name: /free week/i }),
        page.getByRole("button", { name: /free week/i }),
        page.getByText(/free week is back/i),
        page.locator('a:has(img[alt*="free" i])'),
        page.locator('a[href*="join" i]').first()
      ],
      '"FREE WEEK IS BACK" promotion',
      3000
    );

    await onStatus("Waiting for email step");
    await page.locator('input[type="email"], input[placeholder*="email" i]').first()
      .waitFor({ state: "visible", timeout: 15000 });

    await fillFirst(
      [
        page.locator('input[type="email"]'),
        page.locator('input[placeholder*="email" i]'),
        page.locator('input[name*="email" i]')
      ],
      profile.email,
      "email"
    );

    await onStatus("Submitting email");
    await clickFirst(
      [
        page.getByRole("button", { name: /continue to start/i }),
        page.getByRole("link", { name: /continue to start/i }),
        page.getByText(/continue to start/i)
      ],
      '"CONTINUE TO START"'
    );

    await onStatus("Waiting for membership choices");
    await page.getByText(/FREE 7 DAYS/i).first()
      .waitFor({ state: "visible", timeout: 15000 });

    await onStatus("Selecting credit card as checkout method");
    // Selecting the checkout method itself is okay; no card credentials are entered.
    await clickFirst(
      [
        page.getByRole("button", { name: /credit card/i }),
        page.getByRole("link", { name: /credit card/i }),
        page.getByText(/^Credit Card$/i)
      ],
      "Credit Card payment-method selector"
    ).catch(async () => {
      // Some versions render Credit Card as preselected and not clickable.
      await onStatus("Credit Card appears to be preselected");
    });

    await onStatus("Selecting FREE 7 DAYS offer");
    await clickFirst(
      [
        page.getByRole("button", { name: /free 7 days/i }),
        page.getByRole("link", { name: /free 7 days/i }),
        page.getByText(/FREE 7 DAYS/i)
      ],
      "FREE 7 DAYS offer",
      3000
    );

    // Some layouts navigate immediately after clicking the plan. Others require a CTA.
    await page.waitForTimeout(800);

    if (!/probiller/i.test(page.url())) {
      await onStatus("Continuing to checkout");
      await clickFirst(
        [
          page.getByRole("button", { name: /get access/i }),
          page.getByRole("link", { name: /get access/i }),
          page.getByRole("button", { name: /start membership/i }),
          page.getByRole("button", { name: /^continue$/i }),
          page.getByText(/get access/i)
        ],
        "checkout/Get Access button",
        2500
      ).catch(async () => {
        // It may already be navigating.
      });
    }

    await onStatus("Waiting for secure checkout page");
    await Promise.race([
      page.waitForURL(/probiller/i, { timeout: 20000 }).catch(() => null),
      page.locator('input[placeholder*="Card Number" i], input[name*="card" i]').first()
        .waitFor({ state: "visible", timeout: 20000 }).catch(() => null)
    ]);

    const reachedPaymentPage =
      /probiller/i.test(page.url()) ||
      await page.locator('input[placeholder*="Card Number" i], input[name*="card" i]')
        .first()
        .isVisible()
        .catch(() => false);

    if (!reachedPaymentPage) {
      throw new Error("Did not reach the secure checkout page.");
    }

    await onStatus("Filling non-payment checkout fields");

    await fillFirst(
      [
        page.locator('input[placeholder*="Password" i]'),
        page.locator('input[name*="password" i]')
      ],
      password,
      "password"
    );

    await fillFirst(
      [
        page.locator('input[placeholder*="First Name" i]'),
        page.locator('input[name*="first" i]')
      ],
      profile.firstName,
      "first name"
    );

    await fillFirst(
      [
        page.locator('input[placeholder*="Last Name" i]'),
        page.locator('input[name*="last" i]')
      ],
      profile.lastName,
      "last name"
    );

    const countryChanged = await chooseCountry(page, profile.country);
    if (!countryChanged) {
      await onStatus("Country selector was not changed automatically; verify it manually");
    }

    await fillFirst(
      [
        page.locator('input[placeholder*="Zip" i]'),
        page.locator('input[placeholder*="Postal" i]'),
        page.locator('input[name*="zip" i]'),
        page.locator('input[name*="postal" i]')
      ],
      profile.postalCode,
      "ZIP/postal code"
    );

    // Explicitly stop here. Do not fill Card Number / Expiration / CVV and do not submit.
    await onStatus("Secure payment page reached; stopping before card entry");

    if (process.env.SEND_CHECKOUT_SCREENSHOT !== "false") {
      screenshotPath = await safeScreenshot(page, "payment-page");
    }

    return {
      email: profile.email,
      password,
      reachedPaymentPage: true,
      checkoutUrl: page.url(),
      screenshotPath
    };
  } catch (error) {
    if (page && !screenshotPath && process.env.SEND_CHECKOUT_SCREENSHOT !== "false") {
      screenshotPath = await safeScreenshot(page, "error");
    }

    if (screenshotPath) {
      error.screenshotPath = screenshotPath;
    }

    throw error;
  } finally {
    await browser.close();
  }
}
