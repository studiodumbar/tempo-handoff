export interface CellRevealSettings {
  cellReveal: number;
  cellDelay: number;
  cell1x1: number;
  cell2x2: number;
  cell3x3: number;
  cell4x4: number;
  cell5x5: number;
  cellOverlap: number;
  cellWobble: number;
  cellStagger: number;
  cellBlockScale: number;
  cellTileAspect: number;
}

export interface HelixGridOptions {
  renderStyle: "reference" | "patches";
  flowBlockShape: "characters" | "tiles" | "glyphs";
  flowCharacterScale: number;
  flowCharacterGap: number;
  flowEdgeRows: number;
  flowTileLead: number;
  flowBrightness: number;
  flowBlocks: number;
  flowBlockCoverage: number;
  flowBarWidth: number;
  flowDensity: number;
  flowFlightSize: number;
  flowGatherRows: number;
  flowThreshold: number;
  flowGapFill: number;
  flowRowGap: number;
  motion: "tangent" | "arc" | "vortex" | "turbulent";
  order: "reading" | "rows" | "columns" | "snake" | "centre" | "edges";
  revealEase: "flow" | "balanced" | "ease-out" | "linear";
  revealEaseAmount: number;
  revealDirection: "cells" | "down" | "centre";
  releaseMode: "sweep-x" | "sweep-y" | "cross" | "radial" | "random" | "blocks";
  scatterMode: "directional" | "radial" | "random" | "blocks";
  windup: number;
  release: number;
  whipTurns: number;
  whipSoft: number;
  whipDuration: number;
  whipPeak: number;
  whipSharpness: number;
  buildDirection: "release" | "down";
  scatter: number;
  turbulence: number;
  inertia: number;
  drag: number;
  settle: number;
  cluster: number;
  seed: number;
  cellSpread: number;
  pathAmount: number;
  morph: number;
  hold: number;
  itemStagger: number;
  cellWidth: number;
  cellAspect: number;
  dotSize: number;
  blockMix: number;
  patchDensity: number;
  blockLead: number;
  frontWeight: number;
  gatherTime: number;
  gatherSpread: number;
  textureDensity: number;
  ink: string;
  maxDpr: number;
  reveal: CellRevealSettings;
}

export type HelixGridOptionsInput = Partial<Omit<HelixGridOptions, "reveal">> & {
  reveal?: Partial<CellRevealSettings>;
};

export interface HelixGlyph {
  x: number;
  y: number;
  /** Row-major bits in a two-column, four-row braille cell. */
  mask: number;
  alpha: number;
  qmask?: number;
  cellWidth?: number;
  cellHeight?: number;
  gapX?: number;
  gapY?: number;
  dotRadius?: number;
  gapFill?: number;
}

export interface HelixGridState {
  time: number;
  duration: number;
  progress: number;
  phase: "helix" | "whip" | "forming" | "braille" | "photo" | "complete";
  imageCount: number;
  glyphCount: number;
  items: Array<{ formation: number; reveal: number }>;
}

export interface HelixGridInput {
  root: HTMLElement;
  images?: string | Iterable<HTMLImageElement> | (() => Iterable<HTMLImageElement>);
  options?: HelixGridOptionsInput;
  source?: (time: number, width: number, height: number, pose?: { rotation: number; angularVelocity: number }) => HelixGlyph[];
  emitterSource?: (time: number, width: number, height: number, pose: { rotation: number; angularVelocity: number }) => Array<{ x: number; y: number; vx?: number; vy?: number }>;
  onUpdate?: (state: HelixGridState) => void;
  onComplete?: () => void;
  onError?: (error: Error, image: HTMLImageElement | null) => void;
}

export const HELIX_GRID_DEFAULTS: Readonly<HelixGridOptions>;
export const HELIX_GRID_VARIATIONS: ReadonlyArray<{
  id: string;
  name: string;
  description: string;
  options: HelixGridOptionsInput;
}>;
export function createHelixGridTransition(input: HelixGridInput): Promise<HelixGridTransition>;
export function captureCanvasGlyphs(source: HTMLCanvasElement, width: number, height: number, cellWidth?: number): HelixGlyph[];

export class HelixGridTransition {
  constructor(input: HelixGridInput);
  readonly canvas: HTMLCanvasElement;
  readonly options: HelixGridOptions;
  readonly duration: number;
  readonly releaseStart: number;
  readonly referenceActive: boolean;
  readonly blockDelay: number;
  readonly time: number;
  play(): Promise<{ cancelled: boolean }>;
  pause(): void;
  seek(seconds: number): void;
  showHelix(): void;
  refresh(): Promise<void>;
  setOptions(options: HelixGridOptionsInput): Promise<void>;
  cancel(): void;
  destroy(): void;
}
