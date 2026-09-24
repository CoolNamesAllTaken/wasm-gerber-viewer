export type LayerRoleName =
  | "copper"
  | "mask"
  | "silk"
  | "paste"
  | "outline"
  | "drill"
  | "fab"
  | "doc"
  | "other";

export type LayerSide = "top" | "bottom" | "inner" | null;

export type LayerRole = {
  role: LayerRoleName;
  side: LayerSide;
  /** Copper layer number (1 = top) when known. */
  index?: number | null;
  /** For drill files, when the file says. */
  plated?: boolean;
};

export declare const LAYER_ROLES: readonly LayerRoleName[];

export declare function plotsProfile(text: string): boolean;
export declare function withoutProfile(text: string): string;
export declare function layerRole(name?: string, content?: string): LayerRole;

export type BoardFile<S = unknown> = { name: string; source?: S; content?: string };
export type BoardEntry<S = unknown> = { name: string; source: S };
export type BoardFace<S = unknown> = {
  copper: BoardEntry<S> | null;
  mask: BoardEntry<S> | null;
  silk: BoardEntry<S> | null;
  paste: BoardEntry<S> | null;
  fab: BoardEntry<S> | null;
};
export type GroupedBoard<S = unknown> = {
  outline: BoardEntry<S> | null;
  top: BoardFace<S>;
  bottom: BoardFace<S>;
  inner: Array<BoardEntry<S> & { index: number | null }>;
  drills: Array<BoardEntry<S> & { plated: boolean | null }>;
  other: BoardEntry<S>[];
};

export declare function groupBoardLayers<S = unknown>(files: BoardFile<S>[]): GroupedBoard<S>;
