# Final helix → merch grid · Option 1

**This is the approved animation from video 1.** Use this folder for the website integration.

The helix feeds into flat product images. The reveal moves downwards with eased timing, intact white block characters next to the photo edge, and braille below. The renderer measures the website's existing image positions and sizes; it does not supply or replace the shop layout.

## Preview

Serve this folder with your usual local HTTP server and open [index.html](index.html). No install, build step or import map is needed. The preview includes product images and play, pause and scrub controls.

## Add to the website

Copy this folder into the website's static assets, for example `/animations/tempo/`. Keep the relative paths intact. `index.html` and `example-assets/` are preview-only and can be omitted from production.

```js
import { createTempoMerchTransition } from "/animations/tempo/index.js";

const transition = await createTempoMerchTransition({
  root: document.querySelector("[data-merch-grid]"),
  images: "[data-product-image]",
  onComplete: () => { /* Show the website's product labels here. */ },
});

// Connect this to the website's existing grid-view trigger.
await transition.play();

// Call on route exit or component unmount:
// transition.destroy();
```

Initialisation shows the bundled helix. Remove or hide the website's previous helix when this layer takes over. The final real images are restored automatically when the reveal finishes.

- The grid must be laid out before initialisation. `visibility: hidden` is fine during preparation; `display: none` is not. Keep labels hidden until completion or drive them with `onUpdate`.
- Images must be same-origin or CORS-readable. For a CDN, set `crossorigin="anonymous"` before `src` and allow the website origin in the image response headers. Use decoded, eager images for this transition.
- Standard `object-fit` and `object-position` are supported. Keep animated image elements flat and untransformed. CSS filters and non-rectangular clipping are not reproduced on the canvas.
- The container is measured again on resize. Call `await transition.refresh()` after changing products or layout without a container resize. An `images: () => ...` provider can return the current image elements.
- Call `transition.destroy()` on unmount. If initialisation finishes after unmount, immediately destroy the returned instance as well. Catch preparation errors and reveal the normal grid as a fallback.
- Reduced-motion preferences show the completed grid immediately. The overlay does not intercept clicks.

## Files

| File | Purpose |
| --- | --- |
| [index.js](index.js) | Entry point; loads the approved option 1 defaults |
| [settings.json](settings.json) | Exact motion and texture settings from video 1 |
| [index.html](index.html) | Minimal working integration and preview |
| `runtime/` | Animation, cell reveal and particle renderer |
| `presets/` | Original helix configuration |
| `vendor/` | Existing Three.js r160 runtime and its MIT licence |
| [index.d.ts](index.d.ts) | TypeScript declarations |

`pause()`, `seek(seconds)`, `showHelix()`, `cancel()` and `destroy()` are available on the returned instance. `onUpdate(state)` supplies `time`, `duration`, `progress` and `phase`. Optional `options` overrides merge with [settings.json](settings.json), including nested `reveal` values. Leave them unset to use the approved version.

This folder includes its runtime dependencies. It does not import the Tempo editor, experimental variations UI or anything outside the folder. Keep the bundled Three.js version for visual consistency.
