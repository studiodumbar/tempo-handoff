const controls = {
  photo: { min: 0, max: 1, step: 0.01 },
  cellReveal: { min: 0, max: 4, step: 0.05 },
  cellDelay: { min: 0, max: 4, step: 0.05 },
  // Each weight sets the band's share of both the image and the reveal time.
  cell1x1: { min: 0.1, max: 6, step: 0.1 },
  cell2x2: { min: 0.1, max: 6, step: 0.1 },
  cell3x3: { min: 0.1, max: 6, step: 0.1 },
  cell4x4: { min: 0.1, max: 6, step: 0.1 },
  cell5x5: { min: 0.1, max: 6, step: 0.1 },
  cellOverlap: { min: 0, max: 1, step: 0.02 },
  cellWobble: { min: 0, max: 1, step: 0.02 },
  cellStagger: { min: 0, max: 1, step: 0.01 },
  // Clearing beyond the cutout in glyph cells removes overhanging edge marks.
  cellBleed: { min: 0, max: 4, step: 0.1 },
};

let defaultsPromise;

/** Motion reads the handoff JSON directly so defaults cannot drift from it. */
export async function imageRevealParams() {
  defaultsPromise ??= fetch(new URL("../presets/tempo-reveal-settings.json", import.meta.url))
    .then((response) => {
      if (!response.ok) throw new Error(`Image reveal settings: ${response.status}`);
      return response.json();
    });
  const defaults = await defaultsPromise;
  return Object.fromEntries(Object.entries(controls).map(([key, spec]) =>
    [key, { value: defaults[key], ...spec }]));
}
