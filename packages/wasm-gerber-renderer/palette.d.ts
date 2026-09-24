import type { RGBColor } from "./index.js";

export type ColorInput = string | RGBColor | readonly number[];

export declare const SUBSTRATE_COLOR: string;
export declare const COPPER_COLOR: string;
export declare const MASK_COLORS: Readonly<Record<string, string>>;
export declare const SILK_COLORS: Readonly<Record<string, string>>;
export declare const FINISH_COLORS: Readonly<Record<string, string>>;

export type LayerStyle = { readonly color: RGBColor; readonly alpha: number };
export declare const LAYER_STYLES: Readonly<{
  outline: LayerStyle;
  copper: LayerStyle;
  mask: LayerStyle;
  paste: LayerStyle;
  silk: LayerStyle;
  fab: LayerStyle;
  doc: LayerStyle;
  drill: LayerStyle;
}>;

export declare function parseHexColor(hex: string): RGBColor | null;
export declare function toHexColor(color: readonly number[]): string;
export declare function resolveColor(
  value: ColorInput | null | undefined,
  table?: Readonly<Record<string, string>>,
): RGBColor | null;
export declare function maskColor(value: ColorInput | null | undefined): RGBColor | null;
export declare function silkColor(value: ColorInput | null | undefined): RGBColor | "none" | null;
export declare function finishColor(value: ColorInput | null | undefined): RGBColor | null;

export type BoardPaletteOptions = {
  substrate?: ColorInput;
  copper?: ColorInput;
  finish?: ColorInput;
  mask?: ColorInput;
  /** `"none"` for a board without silkscreen. */
  silk?: ColorInput | "none";
  paste?: ColorInput;
  plating?: ColorInput;
  maskAlpha?: number;
  silkAlpha?: number;
  pasteAlpha?: number;
};

export type BoardPalette = {
  substrate: RGBColor;
  copper: RGBColor;
  finish: RGBColor;
  mask: { color: RGBColor; alpha: number };
  silk: { color: RGBColor; alpha: number } | null;
  paste: { color: RGBColor; alpha: number };
  plating: RGBColor;
};

export declare function boardPalette(options?: BoardPaletteOptions): BoardPalette;
