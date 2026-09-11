import {
  calculateFitView,
  createGerberRenderer,
  projectToCanvas,
  unprojectFromCanvas,
  viewExtent,
  type FrameBounds,
  type FrameResult,
  type FrameView,
  type InvertedLayerOptions,
} from "../../index.js";

declare const canvas: HTMLCanvasElement;
declare const maskGerber: string;
declare const boardBounds: FrameBounds;

async function overlay(): Promise<void> {
  const renderer = await createGerberRenderer(canvas, { wasmInitInput: "/renderer.wasm" });
  const view: FrameView = calculateFitView(boardBounds, canvas.width, canvas.height, 24);
  const inverted: InvertedLayerOptions = { color: "#00a81c", alpha: 0.8, name: "Mask" };

  await renderer.withFrame({ view, flipX: true, background: "#05070c" }, async () => {
    const id: number | null = await renderer.renderInvertedLayer(maskGerber, inverted);
    if (id === null) throw new Error("mask skipped");
  });

  const frame: FrameResult | null = renderer.lastFrame;
  if (!frame || !frame.view) return;
  const pixel = projectToCanvas(frame.view, 12.5, -20, frame.width, frame.height);
  const world = unprojectFromCanvas(frame.view, pixel.x, pixel.y, frame.width, frame.height);
  const extent = viewExtent(frame.width, frame.height);
  console.log(pixel.x, world.y, extent.viewWidth, frame.backgroundPainted);
}

void overlay;
