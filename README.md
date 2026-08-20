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

## Add it to a project

Copy `unclickable.js` into your project and import it:

```js
import { makeUnclickable } from "./unclickable.js";

makeUnclickable("#no-button", {
  container: document.querySelector("#choice-area"),
  mode: ["fade", "move"],
});
```

Use a module script in plain HTML:

```html
<script type="module" src="./app.js"></script>
```

After a tagged release, it can also be imported through jsDelivr:

```js
import { makeUnclickable } from "https://cdn.jsdelivr.net/gh/AzkabanAdmin/unclickable@v1.2.0/unclickable.js";
```

Pin a release version in production instead of using the latest branch.

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
| `move` | Instantly jumps to a collision-free destination. |
| `vanish` | Instantly disappears, waits for the pointer to leave its bounds, then instantly returns. |
| `fade` | Fades out, waits for the pointer to leave its bounds, then fades in. |
| `redirect` | Calls `.click()` on another enabled control. Redirect happens only on a press attempt. |
| `random` | Chooses one action from `randomModes`, avoiding an immediate repeat when possible. |

`redirect` produces a synthetic activation, not a trusted physical mouse event. Browsers intentionally prevent JavaScript from fabricating trusted input.

## Combine actions

Pass an array to run compatible actions during the same escape:

```js
mode: ["fade", "move"]       // fade out, teleport, fade in
mode: ["vanish", "move"]    // disappear, teleport, reappear
mode: ["fade", "dodge"]     // fade out, move smoothly, fade in
mode: ["redirect", "dodge"] // activate another control and escape
```

Choose only one movement action (`move` or `dodge`) and one visibility action (`vanish` or `fade`) per combination.

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
  mode: ["fade", "move"],
});
```

Descendant form controls are removed from keyboard navigation while the controller is active and restored by `destroy()`.

## Options

```js
const controller = makeUnclickable("#no-option", {
  container: document.querySelector("#answer-row"),
  mode: ["fade", "move"],
  randomModes: ["dodge", "move", "vanish", "fade", "redirect"],
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
| `container` | Parent element | Movement boundary. It must contain the target. |
| `mode` | `"random"` | One action, `"random"`, or a compatible action array. |
| `randomModes` | All actions | Pool used by random mode. |
| `trigger` | `"both"` | React on `"approach"`, `"press"`, or `"both"`. |
| `axis` | `"both"` | Allow movement on `"both"` axes, only `"x"`, or only `"y"`. Applies to `move` and `dodge`. |
| `padding` | `10` | Minimum distance in pixels from the container edge. |
| `duration` | `360` | Dodge/fade duration in milliseconds. |
| `dangerRadius` | `90` | Pointer proximity that triggers an approach escape. |
| `minimumTravel` | `36` | Preferred minimum relocation distance. Shorter safe moves are allowed in tight spaces. |
| `avoidCollisions` | `true` | Avoid visible obstacles and collision paths. |
| `collisionPadding` | `8` | Extra clearance around the escaping element. |
| `obstacles` | Automatic | Selector, iterable, or callback. By default, sibling layout branches between the target and container are obstacles. |
| `expandContainer` | `0` | Climb this many ancestors above the chosen/default container. `true` means one level. |
| `preserveLayout` | `true` | Leave an invisible placeholder in the original flex/grid/layout slot. |
| `respectReducedMotion` | `true` | Make animations instant when reduced motion is requested. |
| `redirectTarget` | Automatic | Element, document selector, or `(instance) => element` for redirect. |

Constrain any movement action to one axis:

```js
mode: "dodge",
axis: "x" // slide left or right only
```

```js
mode: ["fade", "move"],
axis: "y" // fade, jump vertically, fade back in
```

## Flex and grid layouts

The target remains a normal flex/grid item when the page first loads. Unclickable switches it to absolute positioning only on its first escape.

- With `preserveLayout: true`, an invisible placeholder keeps its original slot.
- With `preserveLayout: false`, flex/grid closes the abandoned slot normally.
- Unclickable does not change the container's `display`, grid tracks, flex direction, or gap.

The container becomes a positioning context (`position: relative`) only when it was previously `static`. Its original inline position is restored by `destroy()`.

### Expand into a larger parent

Keep the target in its normal compact flex row while allowing it to escape into a larger form:

```js
makeUnclickable("#no-option", {
  container: "#answer-row",
  expandContainer: 2,
  mode: ["fade", "move"],
});
```

The movement boundary becomes the ancestor two levels above `#answer-row`. The smaller row is not stretched or removed. Intermediate ancestors temporarily allow visible overflow so they do not clip the escape; `destroy()` restores their inline overflow values. Nested sibling sections inside the expanded boundary are automatically treated as obstacles, so the target uses open space instead of covering form fields.

## Runtime controls

```js
const controller = makeUnclickable("#no-button");

controller.setMode("vanish");
controller.setMode(["fade", "move"]);
controller.evade();
controller.destroy();
```

`destroy()` cancels the behavior and restores original inline styles, ARIA state, tab order, descendant tab order, container positioning, and layout placeholder.

## Appropriate use

This library is designed for jokes, demos, games, easter eggs, and playful low-stakes interactions. Do not use it to obstruct consent choices, accessibility controls, purchases, account deletion, privacy settings, or other consequential decisions. Always provide a real accessible path to important actions.

## License

MIT
