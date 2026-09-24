import type { FrameBounds, FrameView } from "./index.js";
export {
  calculateFitView,
  projectToCanvas,
  unprojectFromCanvas,
  viewExtent,
} from "./index.js";

/** A view with the frame size it was made for. */
export type SizedView = FrameView & {
  viewWidth: number;
  viewHeight: number;
  W: number;
  H: number;
};

export type PixelRect = { x: number; y: number; width: number; height: number };
export type ProjectOptions = { flip?: boolean; scale?: number };

export declare function fitView(
  bounds: FrameBounds,
  width: number,
  height: number,
  padding?: number,
): SizedView;
export declare function withFrameSize(view: FrameView, width: number, height: number): SizedView;
export declare function frameView(view: FrameView): FrameView;
export declare function project(
  view: SizedView,
  x: number,
  y: number,
  options?: ProjectOptions,
): [number, number];
export declare function unproject(
  view: SizedView,
  px: number,
  py: number,
  options?: ProjectOptions,
): [number, number];
export declare function pixelsPerUnit(view: SizedView): number;
export declare function boundsOf(points: ReadonlyArray<readonly [number, number]>): FrameBounds | null;
export declare function unionBounds(
  ...bounds: Array<FrameBounds | null | undefined | Array<FrameBounds | null | undefined>>
): FrameBounds | null;
export declare function padBounds(bounds: FrameBounds, margin: number): FrameBounds;
export declare function padBounds(bounds: null, margin: number): null;
export declare function sharedView(
  bounds: Array<FrameBounds | null | undefined>,
  width: number,
  height: number,
  padding?: number,
): SizedView;
export declare function rasterToWorld(
  bounds: FrameBounds,
  width: number,
  height: number,
  px: number,
  py: number,
): [number, number];
export declare function pixelRectToWorld(view: SizedView, rect: PixelRect): FrameBounds;
export declare function worldToPixelRect(view: SizedView, bounds: FrameBounds): PixelRect;
