import type { FrameBounds } from "./index.js";

export type OutlinePoint = [number, number];
export type OutlineContour = { points: OutlinePoint[]; area: number; bounds: FrameBounds };
export type BoardOutline = { outer: OutlinePoint[]; holes: OutlinePoint[][]; bounds: FrameBounds };
export type OutlineOptions = { tolerance?: number; width?: number | null; height?: number | null };

export declare const OUTLINE_TOLERANCE_MM: number;
export declare function signedArea(points: ReadonlyArray<readonly [number, number]>): number;
export declare function outlineContours(text: string, options?: { tolerance?: number }): OutlineContour[];
export declare function pickBoard(
  contours: OutlineContour[],
  options?: { width?: number | null; height?: number | null },
): OutlineContour | null;
export declare function boardCutouts(
  contours: OutlineContour[],
  board: OutlineContour,
  options?: { tolerance?: number },
): OutlineContour[];
export declare function boardOutline(text: string, options?: OutlineOptions): BoardOutline | null;
export declare function gerberExtents(text: string): FrameBounds | null;
