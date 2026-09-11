export type GerberSource =
  | File
  | string
  | Blob
  | ArrayBuffer
  | Uint8Array;

export type GerberLayer =
  | GerberSource
  | {
      source: GerberSource;
      name?: string;
      color?: RGBColor;
      alpha?: number;
      visible?: boolean;
      offsetX?: number;
      offsetY?: number;
      kind?: LayerKind;
    };

export type RGBColor = [number, number, number];
export type RGBAColor = [number, number, number, number];
export type LayerKind = "gerber" | "drill";
export type CompositeMode = "blend" | "stack";
export type CompositePreset = "union" | "intersection" | "difference";

export type CompositeLayerOptions = {
  name?: string;
  color?: RGBColor | string;
  alpha?: number;
  visible?: boolean;
  inverted?: boolean;
  outlineLayerId?: number;
  preset?: CompositePreset;
  visibleAreas?: string[];
};

export type RendererOptions = {
  wasmModule?: unknown;
  wasmModuleUrl?: string | URL;
  wasmInitInput?: unknown;
  contextAttributes?: WebGLContextAttributes;
  releaseContext?: boolean;
};

export type FrameView = {
  zoomX: number;
  zoomY: number;
  offsetX: number;
  offsetY: number;
};

export type FrameBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

export type CanvasPoint = { x: number; y: number };
export type WorldPoint = { x: number; y: number };

export type FrameResult = {
  width: number;
  height: number;
  background: null | string | RGBAColor;
  bounds: FrameBounds | null;
  /** The view the frame was drawn with, flips included; `null` for an empty frame. */
  view: FrameView | null;
  /** Whether the frame background was painted onto the canvas itself. */
  backgroundPainted: boolean;
  layers: Array<{
    id: number;
    name: string;
    bounds: FrameBounds | null;
    color: RGBColor;
    alpha: number;
  }>;
};

export type FrameOptions = {
  width?: number;
  height?: number;
  clear?: boolean;
  background?: null | string | RGBAColor;
  fit?: boolean;
  padding?: number;
  flipX?: boolean;
  flipY?: boolean;
  view?: FrameView;
  preserveArcRegions?: boolean;
  arcTessellationQuality?: 0 | 1 | 2;
  minimumFeaturePixels?: number;
  renderDrills?: boolean;
  globalAlpha?: number;
  compositeMode?: CompositeMode;
  rendererOptions?: RendererOptions;
  onLayerError?: (failure: LayerFailure) => void | Promise<void>;
  layerErrorMode?: LayerErrorMode;
};

export type LayerErrorMode = "skip" | "throw";

export type LayerFailure = {
  layer: GerberLayer;
  name: string;
  error: unknown;
};

export type LayerOptions = {
  color?: RGBColor;
  alpha?: number;
  visible?: boolean;
  offsetX?: number;
  offsetY?: number;
  kind?: LayerKind;
};

export type InvertedLayerOptions = {
  name?: string;
  color?: RGBColor | string;
  alpha?: number;
  visible?: boolean;
  outlineLayerId?: number;
  offsetX?: number;
  offsetY?: number;
};

export type ExportOptions = {
  type?: "image/png" | string;
  quality?: number;
  background?: null | string | RGBAColor;
  maxBandBytes?: number;
};

export type GerberCanvas = HTMLCanvasElement;

export type BrowserPngWritable =
  | WritableStream<Uint8Array>
  | {
      write(chunk: Uint8Array): Promise<void> | void;
      close?(): Promise<void> | void;
      abort?(error?: unknown): Promise<void> | void;
    };

export declare function calculateFitView(
  bounds: FrameBounds,
  width: number,
  height: number,
  padding?: number,
): FrameView;

export declare function viewExtent(
  width: number,
  height: number,
): { viewWidth: number; viewHeight: number };

export declare function projectToCanvas(
  view: FrameView,
  x: number,
  y: number,
  width: number,
  height: number,
): CanvasPoint;

export declare function unprojectFromCanvas(
  view: FrameView,
  pixelX: number,
  pixelY: number,
  width: number,
  height: number,
): WorldPoint;

export declare function createGerberRenderer(
  canvas: GerberCanvas,
  rendererOptions?: RendererOptions,
): Promise<GerberRenderer>;

export declare function renderGerberToCanvas(
  canvas: GerberCanvas,
  layers: GerberLayer | GerberLayer[] | FileList,
  frameOptions?: FrameOptions,
): Promise<void>;

export declare function renderGerberToPng(
  canvas: GerberCanvas,
  layers: GerberLayer | GerberLayer[] | FileList,
  frameOptions?: FrameOptions,
  exportOptions?: ExportOptions,
): Promise<Blob>;

export declare function renderGerberToPngStream(
  canvas: GerberCanvas,
  writable: BrowserPngWritable,
  layers: GerberLayer | GerberLayer[] | FileList,
  frameOptions?: FrameOptions,
  exportOptions?: ExportOptions,
): Promise<void>;

export declare class GerberRenderer {
  /** The last successfully completed frame, or `null` before one exists. */
  readonly lastFrame: FrameResult | null;

  withFrame(
    frameOptions: FrameOptions,
    callback: () => void | Promise<void>,
  ): Promise<void>;

  renderLayer(layer: GerberLayer, layerOptions?: LayerOptions): Promise<number | null>;

  renderCompositeLayer(
    sourceLayerIds: number[],
    options?: CompositeLayerOptions,
  ): Promise<number | null>;

  renderInvertedLayer(
    layer: GerberLayer,
    options?: InvertedLayerOptions,
  ): Promise<number | null>;

  renderLayers(
    layers: GerberLayer | GerberLayer[] | FileList,
    options?: Pick<FrameOptions, "onLayerError" | "layerErrorMode">,
  ): Promise<{ renderedCount: number; failures: LayerFailure[] }>;

  exportPng(exportOptions?: ExportOptions): Promise<Blob>;

  exportPngStream(
    writable: BrowserPngWritable,
    exportOptions?: ExportOptions,
  ): Promise<void>;

  dispose(): void;
}
