export type TracedPoint = [number, number];
export type TracedShape = { outer: TracedPoint[]; holes: TracedPoint[][] };

export declare function traceLayer(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  minArea?: number,
): TracedShape[];
export declare function traceMask(
  solid: Uint8Array,
  width: number,
  height: number,
  minArea?: number,
): TracedShape[];
export declare function flipRows<T extends Uint8Array | Uint8ClampedArray>(
  pixels: T,
  width: number,
  height: number,
): T;
export declare function brightnessToAlpha<T extends Uint8Array | Uint8ClampedArray>(pixels: T): T;
