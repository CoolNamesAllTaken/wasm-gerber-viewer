export type Hole = {
  x: number;
  y: number;
  /** Millimeters. */
  diameter: number;
  plated: boolean;
  /** Far end of a routed slot; `null` for a round hole. */
  x2: number | null;
  y2: number | null;
  /** Filled-and-capped: no opening; skipped by `projectHoles()`. */
  filled?: boolean;
  [key: string]: unknown;
};

/** Any hole-like object: `d` is accepted as an alias of `diameter`. */
export type HoleLike = {
  x: number;
  y: number;
  diameter?: number;
  d?: number;
  plated?: boolean;
  x2?: number | null;
  y2?: number | null;
  filled?: boolean;
};

export type Point = [number, number];
export type ProjectedHole<H = HoleLike> = [near: Point, far: Point | null, radius: number, hole: H];

export declare function parseExcellon(text: string, options?: { plated?: boolean }): Hole[];
export declare function distinctHoles<H extends HoleLike>(holes: H[]): H[];
export declare function diffHoles<H extends HoleLike>(
  baseHoles: H[],
  headHoles: H[],
  options?: { tolerance?: number },
): { added: H[]; removed: H[]; unchanged: H[]; changed: boolean };
export declare function projectHoles<H extends HoleLike>(
  holes: H[],
  project: (x: number, y: number) => Point,
  pixelsPerMm: number,
  options?: { minRadius?: number },
): ProjectedHole<H>[];
export declare function slotPath(x1: number, y1: number, x2: number, y2: number, radius: number): string;
export declare function circlePath(x: number, y: number, radius: number): string;
export declare function holesPath(projected: ProjectedHole<unknown>[]): string;
export declare function drillShape(
  near: Point,
  far: Point | null,
  radius: number,
  doc?: Document,
): SVGCircleElement | SVGPathElement;
export declare function holeMask(projected: ProjectedHole<unknown>[], width: number, height: number): string;
export declare function applyHoleMask(element: HTMLElement | SVGElement, mask: string): void;
export declare function cutHoles(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  projected: ProjectedHole<unknown>[],
): void;
export declare function holesToGerber(holes: HoleLike[]): string;
