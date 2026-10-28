# TEMPO website handoff

This folder is the website interaction reference. The procedural animation source is in [`tempo-app`](../tempo-app).

## Animation updates

**Star emit** has been rebuilt from the supplied recording, with six rotating lines and staggered outward block trails.

- [Geometry and editable defaults](../tempo-app/src/starEmit.js).
- [Shared renderer](../tempo-app/src/particles.js): use the GPU `modeId == 40` branch and its CPU `id === 40` counterpart, together with the registration in [modes.js](../tempo-app/src/modes.js).
- [Matching project preset](../tempo-app/presets/star-emit.tempo.json), including the canvas, camera, glyph settings and animation parameters.
- [Synchronised comparison video](animation-updates/star-emit-comparison.mp4): original reference on the left, current implementation on the right. Some glyph placement still differs.

**Sonar** now defaults to `spin: 0.25` in the `sonar` entry in [modes.js](../tempo-app/src/modes.js). This rotates around Y at 0.25 radians per second. Existing clips with a saved spin override should also be set to `0.25`.

## Preview

From the repository root, run `cd tempo-app` then `npm start`. Open `http://localhost:8484` and select **star emit** or **sonar** from Featured. To see the matched star composition, open Motion and load the project preset above.
