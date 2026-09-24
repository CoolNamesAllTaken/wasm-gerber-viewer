import type { FrameBounds, FrameOptions, FrameResult, GerberRenderer, GerberSource, RGBColor } from "./index.js";
import type { PixelRect, SizedView } from "./view.js";

export type DiffSource = GerberSource | { source: GerberSource; name?: string };
/** One revision of a layer: a source, several (drawn as their union), or `null` (absent). */
export type DiffSide = DiffSource | DiffSource[] | null | undefined;
export type DiffPair = { base: DiffSide; head: DiffSide };

export type DiffClassStyle = { color: RGBColor; alpha: number };
export type DiffStyle = {
  removed?: Partial<DiffClassStyle>;
  added?: Partial<DiffClassStyle>;
  unchanged?: Partial<DiffClassStyle>;
};

export declare const DIFF_STYLE: Readonly<{
  removed: Readonly<DiffClassStyle>;
  added: Readonly<DiffClassStyle>;
  unchanged: Readonly<DiffClassStyle>;
}>;
export declare const MAX_DIFF_SOURCES: number;

export type DiffOptions = {
  style?: DiffStyle;
  /** Shorthand for `style.*.color`. */
  colors?: { removed?: RGBColor; added?: RGBColor; unchanged?: RGBColor };
  /** Draw unchanged coverage (default true). */
  showUnchanged?: boolean;
  /** Drop `.AperFunction,Profile` strokes first (default false). */
  stripProfile?: boolean;
  /** Context layers drawn first, e.g. the board outline. */
  underlay?: Array<{ source: GerberSource; name?: string; color?: RGBColor; alpha?: number }>;
};

export type AnalyzeOptions = DiffOptions & {
  cellSize?: number;
  mergeDistance?: number;
  minRegionPixels?: number;
  maxRegions?: number;
  skipIdentical?: boolean;
};

export type DiffRegion = {
  kind: "added" | "removed" | "mixed";
  addedPixels: number;
  removedPixels: number;
  /** y-down canvas pixels. */
  pixels: PixelRect;
  /** World units (usually mm). */
  world: FrameBounds | null;
};

export type DiffPixelSummary = {
  changed: boolean;
  addedPixels: number;
  removedPixels: number;
  unchangedPixels: number;
  regions: Array<Omit<DiffRegion, "world"> & { world?: FrameBounds | null }>;
  truncated: boolean;
};

export type LayerDiffReport = {
  changed: boolean;
  /** True when both revisions have the same `geometryText()`; nothing was rendered. */
  identical: boolean;
  addedPixels: number;
  removedPixels: number;
  unchangedPixels: number | null;
  regions: DiffRegion[];
  truncated: boolean;
  width: number | null;
  height: number | null;
  view: SizedView | null;
  pixelSizeMm: number | null;
};

export type PreparedDiffSource = { source: string; name?: string; kind: "gerber"; empty: boolean };

export declare function diffPatterns(
  baseCount: number,
  headCount: number,
): { removed: string[]; added: string[]; unchanged: string[] };
export declare function geometryText(text: string): string;
export declare function prepareDiffSources(
  side: DiffSide,
  options?: { stripProfile?: boolean },
): Promise<PreparedDiffSource[]>;

export declare function addLayerDiff(
  renderer: GerberRenderer,
  pair: DiffPair | { base: PreparedDiffSource[]; head: PreparedDiffSource[] },
  options?: DiffOptions & { prepared?: boolean },
): Promise<{ removed: number | null; added: number | null; unchanged: number | null }>;

export declare function renderLayerDiff(
  renderer: GerberRenderer,
  pair: DiffPair,
  options?: DiffOptions & Omit<FrameOptions, "compositeMode">,
): Promise<{
  frame: FrameResult | null;
  view: SizedView | null;
  ids: { removed: number | null; added: number | null; unchanged: number | null };
}>;

export declare function analyzeLayerDiff(
  renderer: GerberRenderer,
  pair: DiffPair,
  options?: AnalyzeOptions & Omit<FrameOptions, "compositeMode" | "background">,
): Promise<LayerDiffReport>;

export declare function summarizeDiffPixels(
  pixels: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  options?: {
    cellSize?: number;
    mergeDistance?: number;
    minRegionPixels?: number;
    maxRegions?: number;
    bottomUp?: boolean;
  },
): DiffPixelSummary;

export declare function measureLayers(
  renderer: GerberRenderer,
  sources: DiffSide,
  options?: { stripProfile?: boolean },
): Promise<{ bounds: FrameBounds | null; layers: Array<{ name: string | null; bounds: FrameBounds | null }> }>;

export declare function analyzeBoardDiff(
  renderer: GerberRenderer,
  layers: Array<{ name: string; base: DiffSide; head: DiffSide }>,
  options?: AnalyzeOptions &
    Omit<FrameOptions, "compositeMode" | "background"> & { width?: number; height?: number; padding?: number },
): Promise<{
  view: SizedView;
  bounds: FrameBounds | null;
  width: number;
  height: number;
  changed: boolean;
  layers: Array<LayerDiffReport & { name: string }>;
}>;
