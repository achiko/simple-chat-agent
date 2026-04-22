import { expect, test } from "../fixtures";

test.describe("History tab", () => {
  test("shows completed jobs with prompt + status", async ({ page, request }) => {
    // Prime a guest session by visiting root.
    await page.goto("/");
    // Enqueue a job directly via the API.
    const res = await request.post("/api/jobs", {
      data: { prompt: "Say 'history test' and nothing else.", type: "TEXT" },
    });
    expect(res.ok()).toBe(true);

    await page.goto("/history");
    await expect(
      page.getByText("Say 'history test' and nothing else.")
    ).toBeVisible({ timeout: 60_000 });

    // Eventually the row reports COMPLETED or FAILED.
    await expect(page.getByText(/COMPLETED|FAILED/)).toBeVisible({
      timeout: 180_000,
    });
  });
});
