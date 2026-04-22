import { expect, test } from "../fixtures";

test.describe("Chat tab (text streaming)", () => {
  test("submits a text prompt, streams a response, and renders token + cost", async ({
    page,
  }) => {
    await page.goto("/");

    await expect(
      page.getByRole("navigation").getByRole("link", { name: "Chat" })
    ).toBeVisible();

    const textarea = page.getByPlaceholder("Your prompt");
    await textarea.fill("Say hello in one sentence.");
    await page.getByRole("button", { name: /send/i }).click();

    // Assistant bubble appears and accumulates text.
    const bubbles = page.locator("div.rounded-lg");
    await expect(bubbles.last()).toContainText(/.+/, { timeout: 60_000 });

    // Token / cost summary is rendered after completion.
    await expect(page.getByText(/total \d+/)).toBeVisible({ timeout: 120_000 });
    await expect(page.getByText(/\$0\./)).toBeVisible();
  });
});
