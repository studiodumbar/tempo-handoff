import type { HelixGridInput, HelixGridTransition } from "./runtime/helixGridReveal.js";

export type TempoMerchInput = Omit<HelixGridInput, "source" | "emitterSource">;
export type { HelixGridTransition, HelixGridState, HelixGridOptionsInput } from "./runtime/helixGridReveal.js";
export function createTempoMerchTransition(input: TempoMerchInput): Promise<HelixGridTransition>;
