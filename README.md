# Unclickable

Turn any rendered HTML element into a playful target that refuses to be clicked. It can dodge smoothly, teleport, disappear, fade away, redirect an attempted click, or combine those actions.

Unclickable has no dependencies and injects no stylesheet. Your project owns the element's appearance; the library controls only interaction, positioning, opacity, and the temporary layout placeholder.

## Demo

Open `index.html` through a local web server with either Python:

```sh
python -m http.server 8765
```

Or Node.js:

```sh
npx serve .
```

Then open the local URL printed in your terminal.

The playground lets you test every action and combination, floating or reflow movement, axis and trigger constraints, container expansion, layout preservation, collision settings, timing, distances, redirect targets, reduced-motion behavior, callbacks, and the random-action pool against a working form. A live code panel turns the selected settings into a ready-to-copy example.

## Add it to a project

Copy `unclickable.js` into your project and import it:

```js
import { makeUnclickable } from "./unclickable.js";

makeUnclickable("#no-button", {
  container: document.querySelector("#choice-area"),
  mode: ["fade", "teleport"],
});
```

Use a module script in plain HTML:

```html
<script type="module" src="./app.js"></script>
```

After a tagged release, it can also be imported through jsDelivr:

```js
import { makeUnclickable } from "https://cdn.jsdelivr.net/gh/AzkabanAdmin/unclickable@v1.5.1/unclickable.js";
```

Pin a release version in production instead of using the latest branch.

## Development and testing

Install the development dependencies, then run the Chromium behavior suite:

```sh
npm install
npx playwright install chromium
npm test
```

The tests cover initialization, click blocking and redirection, cleanup and DOM restoration, reduced-motion behavior, callback failures, option validation, and repeated initialization. GitHub Actions runs the same suite for every push and pull request.

## Basic Yes/No example

```html
<div id="choice-area">
  <button id="yes-button">Yes</button>
  <button id="no-button">No</button>
</div>
```

```js
import { makeUnclickable } from "./unclickable.js";

const noButton = makeUnclickable("#no-button", {
  container: document.querySelector("#choice-area"),
  mode: "dodge",
});
```

The container needs some free space if the element should change position. Unclickable stays put rather than intentionally overlap an obstacle when no safe destination exists.

## Actions

| Action | Behavior |
| --- | --- |
| `dodge` | Smoothly moves to a collision-free destination. |
| `teleport` | Instantly jumps to a collision-free destination. (`move` remains a compatibility alias.) |
| `vanish` | Instantly disappears, waits for the pointer to leave its bounds, then instantly returns. |
| `fade` | Fades out, waits for the pointer to leave its bounds, then fades in. |
| `redirect` | Calls `.click()` on another enabled control. Redirect happens only on a press attempt. |
| `random` | Chooses one action from `randomModes`, avoiding an immediate repeat when possible. |

`redirect` produces a synthetic activation, not a trusted physical mouse event. Browsers intentionally prevent JavaScript from fabricating trusted input.

## Combine actions

Pass an array to run compatible actions during the same escape:

```js
mode: ["fade", "teleport"]       // fade out, teleport, fade in
mode: ["vanish", "teleport"]    // disappear, teleport, reappear
mode: ["fade", "dodge"]     // fade out, move smoothly, fade in
mode: ["redirect", "dodge"] // activate another control and escape
```

Choose only one movement action (`teleport` or `dodge`) and one visibility action (`vanish` or `fade`) per combination.

## Inputs and composite controls

The target can be a button, input, radio/checkbox label, link, or any other visible `HTMLElement`. For a labeled radio or checkbox, target the wrapper so the entire choice escapes together:

```html
<div id="answer-row">
  <label><input type="radio" name="answer" value="yes"> Yes</label>
  <label id="no-option">
    <input type="radio" name="answer" value="no"> No
  </label>
</div>
```

```js
makeUnclickable("#no-option", {
  container: document.querySelector("#answer-row"),
  mode: ["fade", "teleport"],
});
```

Descendant form controls are removed from keyboard navigation while the controller is active and restored by `destroy()`.

## Options

```js
const controller = makeUnclickable("#no-option", {
  container: document.querySelector("#answer-row"),
  mode: ["fade", "teleport"],
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
  redirectTarget: "#yes-button",
  onAttempt: (event, instance) => {},
  onMode: (mode, instance) => {},
  onEscape: (mode, instance) => {},
});
```

| Option | Default | Meaning |
| --- | --- | --- |
| `container` | Parent element | Floating movement boundary. It must contain the target. Ignored by reflow placement. |
| `mode` | `"random"` | One action, `"random"`, or a compatible action array. |
| `randomModes` | All actions | Pool used by random mode. |
| `trigger` | `"both"` | React on `"approach"`, `"press"`, or `"both"`. |
| `axis` | `"both"` | Floating movement on `"both"` axes, only `"x"`, or only `"y"`. |
| `padding` | `10` | Minimum distance in pixels from the container edge. |
| `duration` | `360` | Dodge/fade duration in milliseconds. |
| `dangerRadius` | `90` | Pointer proximity that triggers an approach escape. |
| `minimumTravel` | `36` | Preferred minimum relocation distance. Shorter safe moves are allowed in tight spaces. |
| `avoidCollisions` | `true` | Avoid visible obstacles and collision paths. |
| `collisionPadding` | `8` | Extra clearance around the escaping element. |
| `obstacles` | Automatic | Selector, iterable, or callback. By default, sibling layout branches between the target and container are obstacles. |
| `expandContainer` | `0` | In float mode, climb this many ancestors above the chosen/default container. `true` means one level. |
| `layoutMode` | `"float"` | `"float"` uses free positioning; `"reflow"` joins another flex/grid layout and moves its neighbors naturally. |
| `reflowContainer` | Movement container | Element, document selector, or callback resolving to the flex/grid container used by reflow mode. |
| `preserveLayout` | `true` | Leave an invisible placeholder in the original flex/grid/layout slot. |
| `respectReducedMotion` | `true` | Disable all prank behavior when reduced motion is requested, leaving the target normally usable. |
| `redirectTarget` | Automatic | Element, document selector, or `(instance) => element` for redirect. |

Constrain any movement action to one axis:

```js
mode: "dodge",
axis: "x" // slide left or right only
```

```js
mode: ["fade", "teleport"],
axis: "y" // fade, jump vertically, fade back in
```

## Float and reflow layouts

The layout modes intentionally use separate controls:

- `float` uses `container`, `expandContainer`, `axis`, `padding`, `minimumTravel`, and collision options.
- `reflow` uses `reflowContainer`; the browser's flex/grid algorithm prevents overlap and positions neighboring items.
- `mode`, `trigger`, visibility actions, timing, callbacks, redirect, and `preserveLayout` apply to both.

This separation prevents container expansion and collision settings from appearing to control reflow when they do not.

### Float inside flex and grid

The target remains a normal flex/grid item when the page first loads. Unclickable switches it to absolute positioning only on its first escape.

- With `preserveLayout: true`, an invisible placeholder keeps its original slot.
- With `preserveLayout: false`, flex/grid closes the abandoned slot normally.
- Unclickable does not change the container's `display`, grid tracks, flex direction, or gap.

The container becomes a positioning context (`position: relative`) only when it was previously `static`. Its original inline position is restored by `destroy()`.

### Reflow instead of getting trapped

Dense forms may have no collision-free pixel space. Reflow mode moves the target into a real flex/grid slot instead of floating it over other fields:

```js
makeUnclickable("#no-option", {
  mode: "teleport",
  layoutMode: "reflow",
  reflowContainer: ".form-grid",
  preserveLayout: false,
});
```

`teleport` changes slots instantly. `dodge` animates between slots while the browser reflows neighboring elements and grows the destination container normally. Collision avoidance is inherent because the target remains a normal layout item. Axis constraints apply to floating movement and are ignored by reflow mode.

With `preserveLayout: true`, an invisible placeholder reserves the target's first slot. With `false`, the original row closes as soon as the target joins the destination layout. Calling `destroy()` returns the target to its exact original DOM location and restores its styles.

### Expand floating movement into a larger parent

Keep the target in its normal compact flex row while allowing it to escape into a larger form:

```js
makeUnclickable("#no-option", {
  container: "#answer-row",
  expandContainer: 2,
  mode: ["fade", "teleport"],
});
```

The movement boundary becomes the ancestor two levels above `#answer-row`. The smaller row is not stretched or removed. Intermediate ancestors temporarily allow visible overflow so they do not clip the escape; `destroy()` restores their inline overflow values. Nested sibling sections inside the expanded boundary are automatically treated as obstacles, so the target uses open space instead of covering form fields.

## Reduced motion

When `respectReducedMotion` is `true` and the visitor has requested reduced motion, Unclickable does not attach its blocking interaction behavior. The element stays in its original layout and remains normally clickable, focusable, and usable. Set the option to `false` only when movement is still appropriate for that experience.

## Runtime controls

```js
const controller = makeUnclickable("#no-button");

controller.setMode("vanish");
controller.setMode(["fade", "teleport"]);
controller.evade();
controller.destroy();
```

`destroy()` cancels the behavior and restores original inline styles, ARIA state, tab order, descendant tab order, container positioning, and layout placeholder.

## Appropriate use

This library is designed for jokes, demos, games, easter eggs, and playful low-stakes interactions. Do not use it to obstruct consent choices, accessibility controls, purchases, account deletion, privacy settings, or other consequential decisions. Always provide a real accessible path to important actions.

## License

MIT
