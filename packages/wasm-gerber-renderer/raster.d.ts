import type { GerberRenderer } from "./index.js";
import type { PixelRect } from "./view.js";

export declare function readRendererPixels(
  renderer: GerberRenderer,
  options?: { rect?: PixelRect | null; bottomUp?: boolean; into?: Uint8Array | null },
): { pixels: Uint8Array; width: number; height: number };
export declare function hasInk(canvas: HTMLCanvasElement | OffscreenCanvas, minShare?: number): boolean;
export declare function copyScaled(
  source: CanvasImageSource & { width: number; height: number },
  maxPx?: number,
): HTMLCanvasElement | OffscreenCanvas | null;
export declare function flattenOnto(
  source: CanvasImageSource & { width: number; height: number },
  color: string,
): HTMLCanvasElement | OffscreenCanvas;
