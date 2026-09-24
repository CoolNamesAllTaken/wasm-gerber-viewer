// Benchmark the layer diff on a synthetic 4-layer, 100 x 100 mm board at 4K.
//
//     node scripts/benchmark-board-diff-4k.mjs
//
// Environment:
//   BOARD_DIFF_BENCHMARK_CHANNEL   browser channel ("chromium" default, or "chrome")
//   BOARD_DIFF_BENCHMARK_HEADLESS  "0" to show the browser (default headless)
//   BOARD_DIFF_BENCHMARK_ARGS      extra Chromium flags, e.g. "--use-angle=gl --enable-gpu"
//   BOARD_DIFF_BENCHMARK_PORT      static server port (default 4185)
//   BOARD_DIFF_BENCHMARK_WIDTH / _HEIGHT  frame size (default 3840 x 2160)
//
// Prints the WebGL renderer string (a software renderer such as SwiftShader
// is reported as such -- its timings say nothing about a real GPU) and, per
// layer, the time to render the diff overlay and to analyze it (classification
// frame + one readback + region extraction), plus the whole-board analysis.
// `plainTwoLayerMs` is the baseline: both revisions drawn as ordinary layers.
import { spawn } from "node:child_process";

import { chromium } from "playwright";

import { classifyWebGlRenderer } from "./webgl-renderer-classification.mjs";

const port = Number(process.env.BOARD_DIFF_BENCHMARK_PORT ?? 4185);
const baseUrl = `http://127.0.0.1:${port}`;
const channel = process.env.BOARD_DIFF_BENCHMARK_CHANNEL ?? "chromium";
const headless = process.env.BOARD_DIFF_BENCHMARK_HEADLESS !== "0";
const args = (process.env.BOARD_DIFF_BENCHMARK_ARGS ?? "").split(/\s+/).filter(Boolean);
const width = Number(process.env.BOARD_DIFF_BENCHMARK_WIDTH ?? 3840);
const height = Number(process.env.BOARD_DIFF_BENCHMARK_HEIGHT ?? 2160);

const server = spawn(process.execPath, ["scripts/static-server.mjs"], {
  cwd: process.cwd(),
  env: { ...process.env, GERBER_VIEWER_TEST_PORT: String(port) },
  stdio: ["ignore", "ignore", "inherit"],
});

let browser;
try {
  await waitForServer(baseUrl);
  browser = await chromium.launch({
    headless,
    args,
    ...(channel === "chromium" ? {} : { channel }),
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(0);
  await page.goto(`${baseUrl}/tests/fixtures/benchmark.html`, { waitUntil: "domcontentloaded" });
  const result = await page.evaluate(
    async ({ width, height }) => {
      const base = "/packages/wasm-gerber-renderer/";
      const { createGerberRenderer } = await import(`${base}index.js`);
      const { analyzeBoardDiff, analyzeLayerDiff, renderLayerDiff } = await import(`${base}diff.js`);

      // A deterministic pseudo-random board: per layer ~2500 pads and ~1500
      // tracks over 100 x 100 mm. The head revision moves 20 pads, drops 10
      // tracks and adds 10 on every layer.
      let seed = 1;
      const random = () => {
        seed = (seed * 16807) % 2147483647;
        return (seed - 1) / 2147483646;
      };
      const mm = (value) => String(Math.round(value * 1e6));
      function layer(index) {
        const pads = [];
        const tracks = [];
        for (let i = 0; i < 2500; i += 1) pads.push([random() * 100, random() * 100, random() < 0.5 ? 10 : 11]);
        for (let i = 0; i < 1500; i += 1) {
          const x = random() * 100;
          const y = random() * 100;
          tracks.push([x, y, x + (random() - 0.5) * 20, y + (random() - 0.5) * 20]);
        }
        const text = (padList, trackList) =>
          [
            "%FSLAX46Y46*%",
            "%MOMM*%",
            `%TF.FileFunction,Copper,L${index + 1},${index === 0 ? "Top" : index === 3 ? "Bot" : "Inr"}*%`,
            "%ADD10C,0.8*%",
            "%ADD11R,1.2X0.6*%",
            "%ADD12C,0.25*%",
            "G01*",
            ...padList.flatMap(([x, y, code]) => [`D${code}*`, `X${mm(x)}Y${mm(y)}D03*`]),
            "D12*",
            ...trackList.flatMap(([x1, y1, x2, y2]) => [`X${mm(x1)}Y${mm(y1)}D02*`, `X${mm(x2)}Y${mm(y2)}D01*`]),
            "M02*",
            "",
          ].join("\n");
        const headPads = pads.map((pad, i) => (i % 125 === 0 ? [pad[0] + 0.7, pad[1], pad[2]] : pad));
        const headTracks = tracks.filter((_, i) => i % 150 !== 0);
        for (let i = 0; i < 10; i += 1) {
          const x = random() * 100;
          const y = random() * 100;
          headTracks.push([x, y, x + 5, y + 5]);
        }
        return { base: text(pads, tracks), head: text(headPads, headTracks) };
      }
      const layers = ["F.Cu", "In1.Cu", "In2.Cu", "B.Cu"].map((name, index) => ({ name, ...layer(index) }));

      const canvas = document.createElement("canvas");
      const renderer = await createGerberRenderer(canvas);
      const gl = renderer.getContext();
      const info = gl.getExtension("WEBGL_debug_renderer_info");
      const rendererName = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      const readback = new Uint8Array(4);
      const finish = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, readback);

      // Warm up: wasm compile, shader compile.
      await analyzeLayerDiff(renderer, layers[0], { width: 256, height: 256 });

      let t = performance.now();
      const board = await analyzeBoardDiff(renderer, layers, { width, height });
      const boardMs = performance.now() - t;
      const view = { zoomX: board.view.zoomX, zoomY: board.view.zoomY, offsetX: board.view.offsetX, offsetY: board.view.offsetY };

      const perLayer = [];
      for (const pair of layers) {
        // Baseline: the same two revisions drawn as two ordinary layers.
        t = performance.now();
        await renderer.withFrame({ width, height, view, compositeMode: "stack" }, async () => {
          await renderer.renderLayer(pair.base);
          await renderer.renderLayer(pair.head);
        });
        finish();
        const plainMs = performance.now() - t;
        t = performance.now();
        await renderLayerDiff(renderer, pair, { width, height, view });
        finish(); // wait for the GPU, not just the command submission
        const renderMs = performance.now() - t;
        t = performance.now();
        const report = await analyzeLayerDiff(renderer, pair, { width, height, view });
        const analyzeMs = performance.now() - t;
        perLayer.push({
          name: pair.name,
          plainTwoLayerMs: Math.round(plainMs),
          renderMs: Math.round(renderMs),
          analyzeMs: Math.round(analyzeMs),
          regions: report.regions.length,
          changed: report.changed,
        });
      }
      renderer.dispose();
      return { rendererName, width, height, boardMs: Math.round(boardMs), perLayer };
    },
    { width, height },
  );
  const { softwareRenderer, hardwareRendererVerified } = classifyWebGlRenderer("", result.rendererName);
  const kind = softwareRenderer ? "SOFTWARE -- not a GPU measurement" : hardwareRendererVerified ? "hardware" : "unverified";
  console.log(`WebGL renderer: ${result.rendererName} (${kind})`);
  console.log(`Frame: ${result.width} x ${result.height}`);
  console.table(result.perLayer);
  console.log(`analyzeBoardDiff (measure + 4 layers): ${result.boardMs} ms`);
} finally {
  await browser?.close();
  server.kill();
}

async function waitForServer(url) {
  const deadline = Date.now() + 30_000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { method: "HEAD" });
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Benchmark server did not start: ${lastError ?? "timeout"}`);
}
