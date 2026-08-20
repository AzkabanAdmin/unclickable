import { expect, test } from "@playwright/test";

test("playground loads cleanly and responds to its controls", async ({ page }) => {
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("http://127.0.0.1:4173");
  await expect(page).toHaveTitle("Unclickable Playground");
  await expect(page.locator("#generated-code")).toContainText("makeUnclickable");
  await expect(page.locator("#newsletter-no-option")).toHaveAttribute("aria-disabled", "true");

  await page.locator("#mode").selectOption("teleport");
  await page.locator("#trigger").selectOption("press");
  await page.locator("#duration").fill("0");
  await page.locator("#apply").click();
  await expect(page.locator("#generated-code")).toContainText('mode: "teleport"');

  await page.locator("#newsletter-no-option").dispatchEvent("pointerdown", {
    clientX: 10,
    clientY: 10,
  });
  await expect(page.locator("#attempt-count")).toHaveText("1");
  expect(errors).toEqual([]);
});
