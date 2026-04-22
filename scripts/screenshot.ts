/**
 * Capture a screenshot of the Chat tab for the README.
 * Usage: pnpm exec tsx scripts/screenshot.ts
 *
 * Assumes the app is running on :3000 and OpenAI is reachable.
 */
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

async function main() {
  const outPath = resolve("public/screenshot.png");
  await mkdir(dirname(outPath), { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  // Prime the guest session.
  await page.goto("http://localhost:3000/", { waitUntil: "networkidle" });

  // Submit a short prompt so the screenshot shows streaming output.
  await page
    .getByPlaceholder("Your prompt")
    .fill("In 2 short sentences, what is a job queue?");
  await page.getByRole("button", { name: /send/i }).click();

  // Wait for token + cost to render (confirms completion).
  await page.getByText(/total \d+/).waitFor({ timeout: 120_000 });

  // Small pause so layout settles.
  await page.waitForTimeout(500);

  await page.screenshot({ path: outPath, fullPage: false });
  console.log(`screenshot saved: ${outPath}`);

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
