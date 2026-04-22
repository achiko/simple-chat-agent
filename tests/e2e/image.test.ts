import { expect, test } from "../fixtures";

test.describe("Image generation + gallery", () => {
  test("submits an image prompt and shows it in the gallery", async ({
    page,
  }) => {
    await page.goto("/");

    await page.getByRole("button", { name: "Image" }).click();
    await page.getByPlaceholder("Your prompt").fill("A red apple on a table");
    await page.getByRole("button", { name: /send/i }).click();

    // Wait for the image to render in the chat bubble.
    await expect(page.locator('img[alt="generated"]')).toBeVisible({
      timeout: 180_000,
    });

    // The gallery tab should show a card for it.
    await page.getByRole("navigation").getByRole("link", { name: "Gallery" }).click();
    await expect(page).toHaveURL(/\/gallery/);
    await expect(page.locator("img").first()).toBeVisible({ timeout: 30_000 });
  });
});
