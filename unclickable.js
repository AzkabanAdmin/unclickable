/**
 * Unclickable — make any rendered HTML element playfully refuse interaction.
 * Behavior is entirely JavaScript-controlled; host CSS owns the appearance.
 */

const ACTIONS = Object.freeze(["dodge", "teleport", "vanish", "fade", "redirect"]);
const FOCUSABLE_SELECTOR = "button, input, select, textarea, a[href], [tabindex]";

export class Unclickable {
  static #instances = new WeakMap();

  constructor(element, options = {}) {
    if (!(element instanceof HTMLElement)) {
      throw new TypeError("Unclickable needs a rendered HTMLElement.");
    }

    Unclickable.#instances.get(element)?.destroy();

    this.element = element;
    const requestedContainer = typeof options.container === "string"
      ? document.querySelector(options.container)
      : options.container;
    this.container = requestedContainer ?? element.parentElement;
    if (!(this.container instanceof HTMLElement)) {
      throw new TypeError("Unclickable needs an HTMLElement container.");
    }
    const requestedLayoutMode = options.layoutMode ?? "float";
    const requestedExpansion = options.expandContainer === true ? 1 : Number(options.expandContainer ?? 0);
    const expansion = requestedLayoutMode === "reflow" ? 0 : requestedExpansion;
    if (!Number.isInteger(expansion) || expansion < 0) {
      throw new RangeError("expandContainer must be true or a non-negative integer.");
    }
    this.expansion = expansion;
    for (let level = 0; level < expansion; level += 1) {
      if (!this.container.parentElement) break;
      this.container = this.container.parentElement;
    }
    if (!this.container.contains(element)) {
      throw new RangeError("The container must contain the unclickable element.");
    }

    this.options = {
      mode: "random",
      randomModes: ["dodge", "teleport", "vanish", "fade", "redirect"],
      trigger: "both",
      axis: "both",
      padding: 10,
      duration: 360,
      dangerRadius: 90,
      minimumTravel: 36,
      avoidCollisions: true,
      collisionPadding: 8,
      obstacles: null,
      expandContainer: 0,
      layoutMode: "float",
      reflowContainer: null,
      preserveLayout: true,
      respectReducedMotion: true,
      redirectTarget: null,
      redirectSelector: [
        "button:not([data-unclickable])",
        "input:not([type='hidden']):not([data-unclickable])",
        "select:not([data-unclickable])",
        "textarea:not([data-unclickable])",
        "a[href]:not([data-unclickable])",
        "[role='button']:not([data-unclickable])",
      ].join(","),
      onAttempt: null,
      onMode: null,
      onEscape: null,
      ...options,
    };

    this.options.mode = this.#normalizeMode(this.options.mode);
    if (!Array.isArray(this.options.randomModes)) {
      throw new TypeError("randomModes must be an array.");
    }
    this.options.randomModes = this.options.randomModes.map((action) => this.#normalizeAction(action));
    this.#validateOptions();
    if (Array.isArray(this.options.mode)) this.options.mode = [...new Set(this.options.mode)];
    this.options.randomModes = [...new Set(this.options.randomModes)];

    this.position = { x: 0, y: 0 };
    this.lastPointer = null;
    this.lastRandomMode = null;
    this.placeholder = null;
    this.originMarker = null;
    this.frame = 0;
    this.animationResolve = null;
    this.runId = 0;
    this.activated = false;
    this.busy = false;
    this.destroyed = false;

    this.original = {
      elementStyle: element.getAttribute("style"),
      containerPosition: this.container.style.position,
      ariaDisabled: element.getAttribute("aria-disabled"),
      tabIndex: element.getAttribute("tabindex"),
      pointerEvents: element.style.pointerEvents,
      transform: element.style.transform,
      descendantTabIndexes: [...element.querySelectorAll(FOCUSABLE_SELECTOR)]
        .map((child) => ({ child, value: child.getAttribute("tabindex") })),
      ancestorOverflows: [],
    };

    this.motionDisabled = Boolean(
      this.options.respectReducedMotion &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    );
    if (!this.motionDisabled) {
      this.originMarker = document.createComment("unclickable-origin");
      this.element.before(this.originMarker);
      this.#prepare();
      this.#bind();
    }
    Unclickable.#instances.set(element, this);
  }

  setMode(mode) {
    mode = this.#normalizeMode(mode);
    this.#validateMode(mode);
    this.options.mode = Array.isArray(mode) ? [...new Set(mode)] : mode;
    return this;
  }

  async evade(event, trigger = "press") {
    if (this.destroyed || this.busy || this.motionDisabled) return false;

    const actions = this.#resolveActions(trigger);
    if (!actions.length) return false;

    this.#activate();
    this.busy = true;
    const currentRun = ++this.runId;
    const modeLabel = actions.length === 1 ? actions[0] : [...actions];

    try {
      this.options.onMode?.(modeLabel, this);
      if (actions.includes("redirect")) this.#redirect();

      const movement = actions.includes("teleport")
        ? "teleport"
        : actions.includes("dodge") ? "dodge" : null;
      const visibility = actions.includes("fade")
        ? "fade"
        : actions.includes("vanish") ? "vanish" : null;
      const usesReflow = movement && this.options.layoutMode === "reflow";
      const target = movement && !usesReflow
        ? this.#findPosition({ requireClearPath: movement === "dodge" })
        : null;

      if (visibility) await this.#hide(visibility, currentRun);
      if (usesReflow) await this.#reflow(movement, currentRun);
      else {
        if (movement === "teleport") this.#setPosition(target, this.options.axis);
        if (movement === "dodge") await this.#animatePosition(target, currentRun);
      }
      if (visibility) {
        await this.#waitUntilPointerLeaves(currentRun);
        await this.#show(visibility, currentRun);
      }

      if (!this.#isCurrent(currentRun)) return false;
      this.options.onEscape?.(modeLabel, this);
      return true;
    } finally {
      if (this.#isCurrent(currentRun)) this.busy = false;
    }
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.runId += 1;
    this.#cancelAnimation();
    this.abortController?.abort();
    this.placeholder?.remove();
    if (this.originMarker?.parentNode) {
      this.originMarker.parentNode.insertBefore(this.element, this.originMarker.nextSibling);
      this.originMarker.remove();
    }

    if (this.original.elementStyle === null) this.element.removeAttribute("style");
    else this.element.setAttribute("style", this.original.elementStyle);
    this.container.style.position = this.original.containerPosition;
    this.#restoreAttribute(this.element, "aria-disabled", this.original.ariaDisabled);
    this.#restoreAttribute(this.element, "tabindex", this.original.tabIndex);
    for (const { child, value } of this.original.descendantTabIndexes) {
      this.#restoreAttribute(child, "tabindex", value);
    }
    for (const { ancestor, overflow } of this.original.ancestorOverflows) {
      ancestor.style.overflow = overflow;
    }
    Unclickable.#instances.delete(this.element);
  }

  #validateOptions() {
    this.#validateMode(this.options.mode);
    if (!Array.isArray(this.options.randomModes) || !this.options.randomModes.length) {
      throw new RangeError("randomModes must be a non-empty action list.");
    }
    this.#validateActionList(this.options.randomModes, "randomModes");
    if (!["both", "approach", "press"].includes(this.options.trigger)) {
      throw new RangeError('trigger must be "both", "approach", or "press".');
    }
    if (!["both", "x", "y"].includes(this.options.axis)) {
      throw new RangeError('axis must be "both", "x", or "y".');
    }
    if (!["float", "reflow"].includes(this.options.layoutMode)) {
      throw new RangeError('layoutMode must be "float" or "reflow".');
    }
    for (const name of ["padding", "duration", "dangerRadius", "minimumTravel", "collisionPadding"]) {
      const value = Number(this.options[name]);
      if (!Number.isFinite(value) || value < 0) {
        throw new RangeError(`${name} must be a finite, non-negative number.`);
      }
    }
    for (const name of ["onAttempt", "onMode", "onEscape"]) {
      if (this.options[name] !== null && typeof this.options[name] !== "function") {
        throw new TypeError(`${name} must be a function or null.`);
      }
    }
    if (typeof this.options.redirectSelector !== "string") {
      throw new TypeError("redirectSelector must be a string.");
    }
  }

  #validateMode(mode) {
    if (mode === "random") return;
    if (!Array.isArray(mode)) {
      if (!ACTIONS.includes(mode)) throw new RangeError(`Unknown mode: ${mode}`);
      return;
    }
    if (!mode.length) throw new RangeError("The mode list cannot be empty.");
    this.#validateActionList(mode, "mode");
    const movementCount = Number(mode.includes("teleport")) + Number(mode.includes("dodge"));
    const visibilityCount = Number(mode.includes("vanish")) + Number(mode.includes("fade"));
    if (movementCount > 1) throw new RangeError('Combine either "teleport" or "dodge", not both.');
    if (visibilityCount > 1) throw new RangeError('Combine either "vanish" or "fade", not both.');
  }

  #validateActionList(actions, name) {
    const invalid = actions.find((action) => !ACTIONS.includes(action));
    if (invalid !== undefined) throw new RangeError(`Unknown ${name} action: ${invalid}`);
  }

  #normalizeMode(mode) {
    return Array.isArray(mode)
      ? mode.map((action) => this.#normalizeAction(action))
      : this.#normalizeAction(mode);
  }

  #normalizeAction(action) {
    return action === "move" ? "teleport" : action;
  }

  #prepare() {
    if (this.options.layoutMode === "float" && getComputedStyle(this.container).position === "static") {
      this.container.style.position = "relative";
    }
    Object.assign(this.element.style, { touchAction: "none", userSelect: "none" });
    this.element.setAttribute("aria-disabled", "true");
    this.element.tabIndex = -1;
    for (const { child } of this.original.descendantTabIndexes) child.tabIndex = -1;

    if (this.expansion > 0) {
      for (
        let ancestor = this.element.parentElement;
        ancestor && ancestor !== this.container;
        ancestor = ancestor.parentElement
      ) {
        this.original.ancestorOverflows.push({ ancestor, overflow: ancestor.style.overflow });
        ancestor.style.overflow = "visible";
      }
    }
  }

  #activate() {
    if (this.activated) return;
    if (this.options.layoutMode === "reflow") {
      this.activated = true;
      return;
    }
    const elementRect = this.element.getBoundingClientRect();
    const origin = this.#containerOrigin();
    this.position = {
      x: elementRect.left - origin.x,
      y: elementRect.top - origin.y,
    };

    if (this.options.preserveLayout) this.#createPlaceholder(elementRect);

    Object.assign(this.element.style, {
      position: "absolute",
      left: "0px",
      top: "0px",
      margin: "0px",
      transform: `translate3d(${this.position.x}px, ${this.position.y}px, 0)`,
      willChange: "transform, opacity",
    });
    this.activated = true;
  }

  #createPlaceholder(rect) {
    const computed = getComputedStyle(this.element);
    const placeholder = document.createElement("span");
    placeholder.setAttribute("aria-hidden", "true");
    placeholder.dataset.unclickablePlaceholder = "";
    Object.assign(placeholder.style, {
      display: computed.display === "block" ? "block" : "inline-block",
      visibility: "hidden",
      pointerEvents: "none",
      boxSizing: "border-box",
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      marginTop: computed.marginTop,
      marginRight: computed.marginRight,
      marginBottom: computed.marginBottom,
      marginLeft: computed.marginLeft,
      flex: "0 0 auto",
      gridColumn: computed.gridColumn,
      gridRow: computed.gridRow,
    });
    this.element.before(placeholder);
    this.placeholder = placeholder;
  }

  #bind() {
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    this.element.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.lastPointer = { x: event.clientX, y: event.clientY };
      this.options.onAttempt?.(event, this);
      if (this.options.trigger !== "approach") this.evade(event, "press");
    }, { capture: true, signal });

    this.element.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
    }, { capture: true, signal });

    window.addEventListener("pointermove", (event) => {
      this.lastPointer = { x: event.clientX, y: event.clientY };
      if (this.busy || this.options.trigger === "press") return;
      const rect = this.element.getBoundingClientRect();
      const distance = Math.hypot(
        event.clientX - (rect.left + rect.width / 2),
        event.clientY - (rect.top + rect.height / 2),
      );
      if (distance <= this.options.dangerRadius) this.evade(event, "approach");
    }, { passive: true, signal });

    window.addEventListener("resize", () => {
      if (!this.activated || this.options.layoutMode === "reflow") return;
      this.#setPosition(this.position);
    }, { signal });
  }

  #resolveActions(trigger) {
    let actions;
    if (this.options.mode === "random") {
      const available = this.options.randomModes.filter((action) =>
        trigger === "press" || action !== "redirect"
      );
      if (!available.length) return trigger === "approach" ? ["dodge"] : [];
      const choices = available.length > 1
        ? available.filter((action) => action !== this.lastRandomMode)
        : available;
      const selected = choices[Math.floor(Math.random() * choices.length)];
      this.lastRandomMode = selected;
      actions = [selected];
    } else {
      actions = Array.isArray(this.options.mode) ? [...this.options.mode] : [this.options.mode];
      if (trigger === "approach") actions = actions.filter((action) => action !== "redirect");
    }
    return actions.length ? actions : trigger === "approach" ? ["dodge"] : [];
  }

  #bounds() {
    const padding = Math.max(0, Number(this.options.padding) || 0);
    return {
      minX: padding,
      minY: padding,
      maxX: Math.max(padding, this.container.clientWidth - this.element.offsetWidth - padding),
      maxY: Math.max(padding, this.container.clientHeight - this.element.offsetHeight - padding),
    };
  }

  #findPosition({ requireClearPath }) {
    const bounds = this.#bounds();
    const start = { ...this.position };
    let best = start;
    let bestScore = -Infinity;

    for (let attempt = 0; attempt < 100; attempt += 1) {
      const candidate = {
        x: this.options.axis === "y"
          ? start.x
          : bounds.minX + Math.random() * (bounds.maxX - bounds.minX),
        y: this.options.axis === "x"
          ? start.y
          : bounds.minY + Math.random() * (bounds.maxY - bounds.minY),
      };
      const overlap = this.#collisionArea(candidate);
      const distance = Math.hypot(candidate.x - start.x, candidate.y - start.y);
      const pathClear = !requireClearPath || this.#pathIsClear(candidate);
      if (!pathClear) continue;

      const score = distance - overlap * 1000;
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
      if (overlap === 0 && distance >= Math.max(0, this.options.minimumTravel)) return candidate;
    }
    return this.#collisionArea(best) === 0 ? best : start;
  }

  #pathIsClear(target) {
    for (let step = 1; step <= 20; step += 1) {
      const progress = step / 20;
      if (this.#collisionArea({
        x: this.position.x + (target.x - this.position.x) * progress,
        y: this.position.y + (target.y - this.position.y) * progress,
      }) > 0) return false;
    }
    return true;
  }

  #collisionArea(position) {
    if (!this.options.avoidCollisions) return 0;
    const gap = Math.max(0, Number(this.options.collisionPadding) || 0);
    const origin = this.#containerOrigin();
    const moving = {
      left: origin.x + position.x - gap,
      top: origin.y + position.y - gap,
      right: origin.x + position.x + this.element.offsetWidth + gap,
      bottom: origin.y + position.y + this.element.offsetHeight + gap,
    };

    let total = 0;
    for (const obstacle of this.#obstacles()) {
      const rect = obstacle.getBoundingClientRect();
      const width = Math.max(0, Math.min(moving.right, rect.right) - Math.max(moving.left, rect.left));
      const height = Math.max(0, Math.min(moving.bottom, rect.bottom) - Math.max(moving.top, rect.top));
      total += width * height;
    }
    return total;
  }

  #obstacles() {
    let candidates;
    const configured = this.options.obstacles;
    if (typeof configured === "function") candidates = configured(this);
    else if (typeof configured === "string") candidates = this.container.querySelectorAll(configured);
    else if (configured && Symbol.iterator in Object(configured)) candidates = configured;
    else candidates = this.#defaultObstacles();

    return [...candidates].filter((item) =>
      item instanceof HTMLElement &&
      item !== this.element &&
      !this.element.contains(item) &&
      !item.contains(this.element) &&
      item !== this.placeholder &&
      !item.hasAttribute("data-unclickable-placeholder") &&
      getComputedStyle(item).display !== "none" &&
      getComputedStyle(item).visibility !== "hidden"
    );
  }

  #defaultObstacles() {
    const obstacles = [];
    const visit = (parent) => {
      for (const child of parent.children) {
        if (
          child === this.element ||
          child === this.placeholder ||
          child.hasAttribute("data-unclickable-placeholder")
        ) continue;

        // Follow only the branch containing the target. Each sibling branch is
        // represented by its outer box, avoiding duplicate nested collisions.
        if (child.contains(this.element)) visit(child);
        else obstacles.push(child);
      }
    };
    visit(this.container);
    return obstacles;
  }

  #containerOrigin() {
    const rect = this.container.getBoundingClientRect();
    return {
      x: rect.left + this.container.clientLeft - this.container.scrollLeft,
      y: rect.top + this.container.clientTop - this.container.scrollTop,
    };
  }

  #setPosition(position, axis = "both") {
    const bounds = this.#bounds();
    this.position = {
      x: axis === "y" ? position.x : Math.min(bounds.maxX, Math.max(bounds.minX, position.x)),
      y: axis === "x" ? position.y : Math.min(bounds.maxY, Math.max(bounds.minY, position.y)),
    };
    this.element.style.transform = `translate3d(${this.position.x}px, ${this.position.y}px, 0)`;
  }

  #animatePosition(target, runId) {
    const duration = this.#duration();
    if (duration === 0) {
      this.#setPosition(target, this.options.axis);
      return Promise.resolve();
    }
    const start = { ...this.position };
    const startedAt = performance.now();
    return this.#animate((now) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 4);
      this.#setPosition({
        x: start.x + (target.x - start.x) * eased,
        y: start.y + (target.y - start.y) * eased,
      }, this.options.axis);
      return progress >= 1 || !this.#isCurrent(runId);
    });
  }

  async #reflow(movement, runId) {
    const destination = this.#resolveReflowContainer();
    const startRect = this.element.getBoundingClientRect();

    if (!this.placeholder && this.options.preserveLayout && this.originMarker.parentNode) {
      this.#createPlaceholder(startRect);
    }

    const siblings = [...destination.children].filter((child) =>
      child !== this.element &&
      child !== this.placeholder &&
      !child.contains(this.element) &&
      !child.hasAttribute("data-unclickable-placeholder")
    );
    const slots = [...siblings, null];
    let reference = slots[Math.floor(Math.random() * slots.length)];
    if (siblings.length > 1 && reference === this.element.nextElementSibling) {
      reference = slots[(slots.indexOf(reference) + 1) % slots.length];
    }
    destination.insertBefore(this.element, reference);

    if (movement !== "dodge" || this.#duration() === 0) return;
    const endRect = this.element.getBoundingClientRect();
    const deltaX = startRect.left - endRect.left;
    const deltaY = startRect.top - endRect.top;
    const duration = this.#duration();
    const startedAt = performance.now();
    this.element.style.willChange = "transform, opacity";

    await this.#animate((now) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 4);
      this.element.style.transform = `translate3d(${deltaX * (1 - eased)}px, ${deltaY * (1 - eased)}px, 0)`;
      return progress >= 1 || !this.#isCurrent(runId);
    });
    if (this.#isCurrent(runId)) this.element.style.transform = this.original.transform;
  }

  #resolveReflowContainer() {
    let destination = this.options.reflowContainer ?? this.container;
    if (typeof destination === "string") destination = document.querySelector(destination);
    if (typeof destination === "function") destination = destination(this);
    if (!(destination instanceof HTMLElement)) {
      throw new TypeError("reflowContainer must resolve to an HTMLElement.");
    }
    if (this.element.contains(destination)) {
      throw new RangeError("reflowContainer cannot be inside the unclickable element.");
    }
    return destination;
  }

  async #hide(type, runId) {
    if (type === "fade" && this.#duration() > 0) await this.#animateOpacity(1, 0, runId);
    else this.element.style.opacity = "0";
    if (this.#isCurrent(runId)) this.element.style.pointerEvents = "none";
  }

  async #show(type, runId) {
    if (!this.#isCurrent(runId)) return;
    this.element.style.pointerEvents = this.original.pointerEvents;
    if (type === "fade" && this.#duration() > 0) await this.#animateOpacity(0, 1, runId);
    else this.element.style.opacity = "1";
  }

  #animateOpacity(from, to, runId) {
    const duration = this.#duration() / 2;
    const startedAt = performance.now();
    return this.#animate((now) => {
      const progress = Math.min(1, (now - startedAt) / Math.max(1, duration));
      this.element.style.opacity = String(from + (to - from) * progress);
      return progress >= 1 || !this.#isCurrent(runId);
    });
  }

  #animate(step) {
    this.#cancelAnimation();
    return new Promise((resolve) => {
      this.animationResolve = resolve;
      const tick = (now) => {
        if (step(now)) {
          this.animationResolve = null;
          resolve();
        }
        else this.frame = requestAnimationFrame(tick);
      };
      this.frame = requestAnimationFrame(tick);
    });
  }

  #cancelAnimation() {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    if (this.animationResolve) {
      const resolve = this.animationResolve;
      this.animationResolve = null;
      resolve();
    }
  }

  #waitUntilPointerLeaves(runId) {
    return this.#animate(() => !this.#isCurrent(runId) || !this.#pointerIsOverElement());
  }

  #pointerIsOverElement() {
    if (!this.lastPointer) return false;
    const rect = this.element.getBoundingClientRect();
    return this.lastPointer.x >= rect.left && this.lastPointer.x <= rect.right &&
      this.lastPointer.y >= rect.top && this.lastPointer.y <= rect.bottom;
  }

  #redirect() {
    let target = this.options.redirectTarget;
    if (typeof target === "string") target = document.querySelector(target);
    if (typeof target === "function") target = target(this);
    if (!target) {
      const candidates = [...this.container.querySelectorAll(this.options.redirectSelector)]
        .filter((item) => item !== this.element && !("disabled" in item && item.disabled) &&
          item.getAttribute("aria-disabled") !== "true");
      target = candidates[Math.floor(Math.random() * candidates.length)];
    }
    if (target instanceof HTMLElement) target.click();
  }

  #duration() {
    return Math.max(0, Number(this.options.duration) || 0);
  }

  #isCurrent(runId) {
    return !this.destroyed && runId === this.runId;
  }

  #restoreAttribute(element, name, value) {
    if (value === null) element.removeAttribute(name);
    else element.setAttribute(name, value);
  }
}

export function makeUnclickable(elementOrSelector, options = {}) {
  const element = typeof elementOrSelector === "string"
    ? document.querySelector(elementOrSelector)
    : elementOrSelector;
  if (!element) throw new RangeError(`No element found for: ${elementOrSelector}`);
  return new Unclickable(element, options);
}

export default makeUnclickable;
