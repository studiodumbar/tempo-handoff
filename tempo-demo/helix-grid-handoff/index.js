import { createHelixGridTransition } from "./runtime/helixGridReveal.js";

/**
 * The approved option 1 preset travels with the renderer so every integration
 * starts from the same motion and texture, without merging editor defaults.
 * @param {import("./index.d.ts").TempoMerchInput} input
 * @returns {Promise<import("./runtime/helixGridReveal.js").HelixGridTransition>}
 */
export async function createTempoMerchTransition(input) {
  const response = await fetch(new URL("./settings.json", import.meta.url));
  if (!response.ok) throw new Error("Could not load Tempo's approved animation settings");
  const settings = await response.json();
  return createHelixGridTransition({
    ...input,
    options: {
      ...settings,
      ...input.options,
      reveal: { ...settings.reveal, ...input.options?.reveal },
    },
  });
}
