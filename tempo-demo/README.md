# TEMPO website handoff

This folder is the website interaction reference. The procedural animation source is in [`tempo-app`](../tempo-app).

## Animation updates

**Star emit** has been rebuilt from the supplied recording, with six rotating lines and staggered outward block trails.

- [Geometry and editable defaults](../tempo-app/src/starEmit.js).
- [Shared renderer](../tempo-app/src/particles.js): use the GPU `modeId == 40` branch and its CPU `id === 40` counterpart, together with the registration in [modes.js](../tempo-app/src/modes.js).
- [Matching project preset](../tempo-app/presets/star-emit.tempo.json), including the canvas, camera, glyph settings and animation parameters.

**Sonar** now defaults to `spin: 0.25` in the `sonar` entry in [modes.js](../tempo-app/src/modes.js). This rotates around Y at 0.25 radians per second. Existing clips with a saved spin override should also be set to `0.25`.

**Image reveal** now defaults to the tested cell-by-cell photo reveal for Merch and imported images in Motion.

- [Default reveal settings JSON](../tempo-app/presets/tempo-reveal-settings.json). Merge this object into the image clip's `params`; the same settings apply to every product image.
- Motion loads this JSON through [imageReveal.js](../tempo-app/src/imageReveal.js), so the handoff file is also the app's source of defaults. Saved per-clip overrides still take precedence.
- Use the existing [photo.js](../tempo-app/src/photo.js) cell-grid mask and compositing: `cellReveal` is 1.3 seconds from the start of the incoming transition, with zero delay, overlapping block-size bands and staggered cells. Each revealed cell covers its braille trace. A straight horizontal wipe will not reproduce this effect from the JSON alone.

This file contains reveal parameters, not a complete `.tempo.json` project or the particle flight/scene settings. Visual's still-image workflow continues to open images as braille.

## Preview

From the repository root, run `cd tempo-app` then `npm start`. Open `http://localhost:8484` and select **star emit** or **sonar** from Featured. To see the matched star composition, open Motion and load the project preset above.
