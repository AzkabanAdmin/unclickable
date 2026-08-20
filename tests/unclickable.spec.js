import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../unclickable.js", import.meta.url), "utf8");

async function loadLibrary(page, markup = '<div id="area"><button id="target">No</button><button id="other">Yes</button></div>') {
  await page.setContent(markup);
  await page.evaluate(async (moduleSource) => {
    const url = URL.createObjectURL(new Blob([moduleSource], { type: "text/javascript" }));
    window.unclickable = await import(url);
    URL.revokeObjectURL(url);
  }, source);
}

test("exports the public API and initializes a target", async ({ page }) => {
  await loadLibrary(page);
  const result = await page.evaluate(() => {
    const controller = window.unclickable.makeUnclickable("#target", { mode: "teleport" });
    return {
      hasClass: typeof window.unclickable.Unclickable === "function",
      hasFactory: typeof window.unclickable.makeUnclickable === "function",
      disabled: controller.element.getAttribute("aria-disabled"),
      tabIndex: controller.element.tabIndex,
    };
  });
  expect(result).toEqual({ hasClass: true, hasFactory: true, disabled: "true", tabIndex: -1 });
});

test("blocks a target click and redirects it when configured", async ({ page }) => {
  await loadLibrary(page);
  await page.evaluate(() => {
    window.targetClicks = 0;
    window.otherClicks = 0;
    document.querySelector("#target").addEventListener("click", () => window.targetClicks++);
    document.querySelector("#other").addEventListener("click", () => window.otherClicks++);
    window.unclickable.makeUnclickable("#target", {
      mode: "redirect",
      redirectTarget: "#other",
      duration: 0,
    });
  });
  await page.locator("#target").dispatchEvent("pointerdown");
  await page.locator("#target").dispatchEvent("click");
  await expect.poll(() => page.evaluate(() => window.otherClicks)).toBe(1);
  expect(await page.evaluate(() => window.targetClicks)).toBe(0);
});

test("destroy restores attributes, inline styles, and descendant tab order", async ({ page }) => {
  await loadLibrary(page, '<div id="area" style="position: static"><label id="target" style="color: red"><input id="child" tabindex="3">No</label></div>');
  const result = await page.evaluate(() => {
    const target = document.querySelector("#target");
    const controller = window.unclickable.makeUnclickable(target, { mode: "dodge" });
    controller.destroy();
    return {
      style: target.getAttribute("style"),
      ariaDisabled: target.getAttribute("aria-disabled"),
      tabIndex: target.getAttribute("tabindex"),
      childTabIndex: document.querySelector("#child").getAttribute("tabindex"),
      containerPosition: document.querySelector("#area").style.position,
    };
  });
  expect(result).toEqual({
    style: "color: red",
    ariaDisabled: null,
    tabIndex: null,
    childTabIndex: "3",
    containerPosition: "static",
  });
});

test("reduced-motion visitors keep a normally usable control", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await loadLibrary(page);
  const result = await page.evaluate(() => {
    let clicks = 0;
    const target = document.querySelector("#target");
    target.addEventListener("click", () => clicks++);
    const controller = window.unclickable.makeUnclickable(target);
    target.click();
    return {
      clicks,
      motionDisabled: controller.motionDisabled,
      ariaDisabled: target.getAttribute("aria-disabled"),
      tabIndex: target.getAttribute("tabindex"),
    };
  });
  expect(result).toEqual({ clicks: 1, motionDisabled: true, ariaDisabled: null, tabIndex: null });
});

test("a throwing onMode callback does not leave the controller busy", async ({ page }) => {
  await loadLibrary(page);
  const result = await page.evaluate(async () => {
    const controller = window.unclickable.makeUnclickable("#target", {
      mode: "teleport",
      duration: 0,
      onMode() { throw new Error("host callback failed"); },
    });
    let message;
    try {
      await controller.evade(null);
    } catch (error) {
      message = error.message;
    }
    return { message, busy: controller.busy };
  });
  expect(result).toEqual({ message: "host callback failed", busy: false });
});

test("rejects invalid numeric and callback options", async ({ page }) => {
  await loadLibrary(page);
  const errors = await page.evaluate(() => {
    const capture = (options) => {
      try {
        window.unclickable.makeUnclickable("#target", options);
        return null;
      } catch (error) {
        return `${error.name}: ${error.message}`;
      }
    };
    return [
      capture({ duration: Infinity }),
      capture({ padding: -1 }),
      capture({ randomModes: "dodge" }),
      capture({ onEscape: "nope" }),
    ];
  });
  expect(errors).toEqual([
    "RangeError: duration must be a finite, non-negative number.",
    "RangeError: padding must be a finite, non-negative number.",
    "TypeError: randomModes must be an array.",
    "TypeError: onEscape must be a function or null.",
  ]);
});

test("a second initialization destroys the previous controller", async ({ page }) => {
  await loadLibrary(page);
  const result = await page.evaluate(() => {
    const first = window.unclickable.makeUnclickable("#target", { mode: "dodge" });
    const second = window.unclickable.makeUnclickable("#target", { mode: "teleport" });
    return { firstDestroyed: first.destroyed, secondDestroyed: second.destroyed };
  });
  expect(result).toEqual({ firstDestroyed: true, secondDestroyed: false });
});

test("reflow joins a destination layout and destroy restores the exact origin", async ({ page }) => {
  await loadLibrary(page, `
    <form id="form">
      <div id="choices"><span id="before">Before</span><button id="target">No</button><span id="after">After</span></div>
      <div id="grid"><div id="field-a">A</div><div id="field-b">B</div></div>
    </form>
  `);

  const result = await page.evaluate(async () => {
    const target = document.querySelector("#target");
    const controller = window.unclickable.makeUnclickable(target, {
      mode: "teleport",
      layoutMode: "reflow",
      reflowContainer: "#grid",
      preserveLayout: true,
      trigger: "press",
    });

    await controller.evade(null, "press");
    const during = {
      parent: target.parentElement.id,
      position: getComputedStyle(target).position,
      placeholders: document.querySelectorAll("[data-unclickable-placeholder]").length,
    };

    controller.destroy();
    return {
      during,
      restoredParent: target.parentElement.id,
      previousId: target.previousElementSibling?.id,
      nextId: target.nextElementSibling?.id,
      placeholders: document.querySelectorAll("[data-unclickable-placeholder]").length,
    };
  });

  expect(result).toEqual({
    during: { parent: "grid", position: "static", placeholders: 1 },
    restoredParent: "choices",
    previousId: "before",
    nextId: "after",
    placeholders: 0,
  });
});
