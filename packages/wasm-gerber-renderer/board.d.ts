import type { FrameBounds, FrameOptions, FrameResult, FrameView, GerberRenderer, GerberSource } from "./index.js";
import type { BoardPalette, BoardPaletteOptions } from "./palette.js";

/** A layer: a source, or `{ source, name }`. */
export type BoardLayerSource = GerberSource | { source: GerberSource; name?: string };

export type BoardFaceLayers = {
  copper?: BoardLayerSource | null;
  mask?: BoardLayerSource | null;
  silk?: BoardLayerSource | null;
  paste?: BoardLayerSource | null;
};

/** One face, or a grouped board (`groupBoardLayers()`) with `top`/`bottom`. */
export type BoardDescription = BoardFaceLayers & {
  outline?: BoardLayerSource | null;
  drills?: BoardLayerSource | BoardLayerSource[] | null;
  top?: BoardFaceLayers;
  bottom?: BoardFaceLayers;
};

export type BoardLayerOptions = {
  side?: "top" | "bottom";
  palette?: BoardPalette | BoardPaletteOptions;
  /** Board-shaped laminate under everything (default true). */
  substrate?: boolean;
  /** Finish color on copper in mask openings (default true). */
  finish?: boolean;
  /** Remove silkscreen from mask openings and outside the outline (default true). */
  clipSilk?: boolean;
  /** Draw solder paste (default false). */
  paste?: boolean;
  /** Draw drill files; with no frame background holes are transparent (default true). */
  holes?: boolean;
  /** Drop `.AperFunction,Profile` strokes from face layers (default true). */
  stripProfile?: boolean;
};

export type BoardLayerIds = {
  outline: number | null;
  substrate: number | null;
  copper: number | null;
  mask: number | null;
  finish: number | null;
  silk: number | null;
  paste: number | null;
  drills: number[];
};

export declare const FACE_ROLES: readonly ["copper", "mask", "silk", "paste"];

export declare function selectFace(
  board: BoardDescription,
  side?: "top" | "bottom",
): {
  outline: BoardLayerSource | null;
  copper: BoardLayerSource | null;
  mask: BoardLayerSource | null;
  silk: BoardLayerSource | null;
  paste: BoardLayerSource | null;
  drills: BoardLayerSource[];
};

export declare function addBoardLayers(
  renderer: GerberRenderer,
  board: BoardDescription,
  options?: BoardLayerOptions,
): Promise<BoardLayerIds>;

export type RenderBoardOptions = BoardLayerOptions &
  Omit<FrameOptions, "compositeMode"> & {
    /** Mirror a bottom face as seen from below (default true). */
    mirror?: boolean;
  };

export declare function renderBoard(
  renderer: GerberRenderer,
  board: BoardDescription,
  options?: RenderBoardOptions,
): Promise<{ frame: FrameResult | null; ids: BoardLayerIds }>;

export declare function faceRasterSize(
  bounds: FrameBounds,
  options?: { pxPerMm?: number; minPx?: number; maxPx?: number; maxTextureSize?: number },
): { width: number; height: number; pxPerMm: number };

export declare function renderFaceRaster(
  renderer: GerberRenderer,
  board: BoardDescription,
  options: BoardLayerOptions & {
    bounds: FrameBounds;
    width?: number;
    height?: number;
    pxPerMm?: number;
    minPx?: number;
    maxPx?: number;
    maxTextureSize?: number;
    /** CSS color to flatten onto (default: palette substrate); `false` keeps transparency. */
    flatten?: string | false;
  },
): Promise<{
  canvas: HTMLCanvasElement | OffscreenCanvas;
  width: number;
  height: number;
  bounds: FrameBounds;
  view: FrameView;
}>;
