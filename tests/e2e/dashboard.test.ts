import { expect, test } from "../fixtures";

test.describe("System dashboard", () => {
  test("worker reports online and queue counts update as jobs are enqueued", async ({
    page,
  }) => {
    await page.goto("/");
    await page.goto("/system");
    await expect(page.getByText("Worker online")).toBeVisible({
      timeout: 30_000,
    });

    // Baseline counts.
    const countBefore = await readCompleted(page);

    // Enqueue 3 text jobs via the API, sharing the browser's cookie jar.
    for (let i = 0; i < 3; i++) {
      const res = await page.request.post("/api/jobs", {
        data: { prompt: `dashboard probe ${i}`, type: "TEXT" },
      });
      expect(res.ok()).toBe(true);
    }

    await expect
      .poll(async () => await readCompleted(page), { timeout: 180_000 })
      .toBeGreaterThan(countBefore);
  });
});

async function readCompleted(page: import("@playwright/test").Page): Promise<number> {
  const stat = page.locator("div", { hasText: /^Completed$/ }).first();
  await stat.waitFor({ state: "visible" });
  const text = await stat.locator("..").innerText();
  const match = text.match(/Completed\s+(\d+)/);
  return match ? Number(match[1]) : 0;
}
