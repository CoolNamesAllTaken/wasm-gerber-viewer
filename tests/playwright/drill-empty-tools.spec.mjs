import { expect, test } from "@playwright/test";

// KiCad 10 writes zero-diameter drill tools (`T1C0.000`, vias with no drill:
// its royalblue54L_feather demo has 180 such hits). The WASM rejects a whole
// Excellon file that has one ("Drill tool diameter must be positive"), so the
// JS layer drops those tools and their hits before the WASM sees the file.
// These pixel tests check that the real holes in such a file still render,
// through the renderer, board.js and diff.js, and that nothing is drawn where
// the zero-diameter hits were.

const PACKAGE = "/packages/wasm-gerber-renderer/";

// Real holes: a 1 mm PTH at (10, 10) and a 2.5 mm NPTH at (20, 10).
// Zero-diameter "vias" at (5, 5) and (15, 15), which must not become holes.
const KICAD_DRILL = [
  "M48",
  "; DRILL file KiCad 10.0.6 date 2026-10-07T02:16:22",
  "; FORMAT={-:-/ absolute / metric / decimal}",
  "; #@! TF.FileFunction,MixedPlating,1,2",
  "FMAT,2",
  "METRIC",
  "; #@! TA.AperFunction,Plated,PTH,ViaDrill",
  "T1C0.000",
  "; #@! TA.AperFunction,Plated,PTH,ComponentDrill",
  "T2C1.000",
  "; #@! TA.AperFunction,NonPlated,NPTH,ComponentDrill",
  "T3C2.500",
  "%",
  "G90",
  "G05",
  "T1",
  "X5.0Y5.0",
  "X15.0Y15.0",
  "T2",
  "X10.0Y10.0",
  "T3",
  "X20.0Y10.0",
  "M30",
  "",
].join("\n");

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => {
    throw error;
  });
  await page.goto("/tests/fixtures/benchmark.html");
  await page.evaluate(async ({ base, drillText }) => {
    const load = (name) => import(`${base}${name}.js`);
    const [index, board, diff, drills, raster] = await Promise.all(
      ["index", "board", "diff", "drills", "raster"].map(load),
    );
    const mm = (value) => String(Math.round(value * 1e6));
    const header = "%FSLAX46Y46*%\n%MOMM*%\n%LPD*%\nG01*\n";
    const outline = (points) =>
      `${header}%ADD10C,0.1*%\nD10*\n` +
      points.map(([x, y], i) => `X${mm(x)}Y${mm(y)}D0${i ? 1 : 2}*`).join("\n") +
      `\nX${mm(points[0][0])}Y${mm(points[0][1])}D01*\nM02*\n`;
    const pour = (x1, y1, x2, y2) =>
      `${header}G36*\nX${mm(x1)}Y${mm(y1)}D02*\nX${mm(x2)}Y${mm(y1)}D01*\nX${mm(x2)}Y${mm(y2)}D01*\n` +
      `X${mm(x1)}Y${mm(y2)}D01*\nX${mm(x1)}Y${mm(y1)}D01*\nG37*\nM02*\n`;

    const warnings = [];
    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    const renderer = await index.createGerberRenderer(canvas, {
      onWarning: (message, detail) => warnings.push({ message, detail }),
    });
    const at = (x, y) => {
      const frame = renderer.lastFrame;
      const point = index.projectToCanvas(frame.view, x, y, frame.width, frame.height);
      const { pixels } = raster.readRendererPixels(renderer, {
        rect: { x: Math.floor(point.x), y: Math.floor(point.y), width: 1, height: 1 },
      });
      return [...pixels];
    };
    // Non-background pixels in a box of `r` mm around a world point: a drill
    // layer draws a colored rim, filled with the frame background.
    const colored = (x, y, r) => {
      const frame = renderer.lastFrame;
      const a = index.projectToCanvas(frame.view, x - r, y - r, frame.width, frame.height);
      const b = index.projectToCanvas(frame.view, x + r, y + r, frame.width, frame.height);
      const rx = Math.floor(Math.min(a.x, b.x));
      const ry = Math.floor(Math.min(a.y, b.y));
      const rect = { x: rx, y: ry, width: Math.ceil(Math.abs(b.x - a.x)), height: Math.ceil(Math.abs(b.y - a.y)) };
      const { pixels } = raster.readRendererPixels(renderer, { rect });
      let count = 0;
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i] || pixels[i + 1] || pixels[i + 2]) count += 1;
      return count;
    };
    Object.assign(window, {
      t: { index, board, diff, drills, raster, renderer, canvas, at, colored, outline, pour, warnings, drillText },
    });
  }, { base: PACKAGE, drillText: KICAD_DRILL });
});

test("the WASM itself still rejects the file: the JS layer is what makes it render", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { renderer, drills, drillText } = window.t;
    const raw = (() => {
      try {
        renderer.wasmModule.parse_drill_layer(drillText, 0, 0);
        return "accepted";
      } catch (error) {
        return String(error?.message ?? error);
      }
    })();
    const cleaned = renderer.wasmModule.parse_drill_layer(drills.withoutEmptyTools(drillText), 0, 0);
    return { raw, cleaned: Boolean(cleaned?.outlineLayer && cleaned?.fillLayer) };
  });
  expect(result.raw).toMatch(/diameter must be positive/);
  expect(result.cleaned).toBe(true);
});

test("renderLayer draws the real holes of a file with a T1C0.000 tool and warns", async ({ page }, testInfo) => {
  const result = await page.evaluate(async () => {
    const { renderer, colored, warnings, drillText } = window.t;
    let id = null;
    await renderer.withFrame({ width: 500, height: 250, padding: 2, background: "#000000" }, async () => {
      id = await renderer.renderLayer({ source: drillText, name: "board.drl", kind: "drill" });
    });
    return {
      id,
      bounds: renderer.lastFrame.bounds,
      pth: colored(10, 10, 0.8),
      npth: colored(20, 10, 1.5),
      warnings,
    };
  });
  await testInfo.attach("renderLayer", { body: await page.locator("canvas").screenshot(), contentType: "image/png" });
  expect(result.id).not.toBeNull();
  // The frame fits the real holes only: the zero-diameter hits at y 5 and 15 are gone.
  expect(result.bounds.minY).toBeGreaterThan(8);
  expect(result.bounds.maxY).toBeLessThan(12);
  // Both real holes are drawn: their rims stand out from the black background.
  expect(result.pth).toBeGreaterThan(20);
  expect(result.npth).toBeGreaterThan(20);
  expect(result.warnings).toHaveLength(1);
  expect(result.warnings[0].message).toMatch(/^board\.drl: Dropped a drill tool with no diameter \(T1C0\) and 2 hits$/);
  expect(result.warnings[0].detail.dropped).toEqual([{ tool: 1, diameter: 0, hits: 2 }]);
});

test("renderBoard opens the real holes and leaves the zero-diameter vias as board", async ({ page }, testInfo) => {
  const result = await page.evaluate(async () => {
    const { board, renderer, at, outline, pour, drillText, warnings } = window.t;
    const { ids } = await board.renderBoard(renderer, {
      outline: outline([[0, 0], [30, 0], [30, 20], [0, 20]]),
      copper: pour(0, 0, 30, 20),
      mask: pour(-1, -1, -0.5, -0.5), // one tiny opening off the board: the rest is masked
      drills: [{ source: drillText, name: "board.drl" }],
    }, {
      width: 600,
      height: 400,
      padding: 1,
      background: "#0000ff",
      palette: { mask: "#00ff00", maskAlpha: 1, finish: "#ffff00", substrate: "#ff00ff", copper: "#ff8000" },
    });
    return {
      drills: ids.drills.length,
      pth: at(10, 10),
      npth: at(20, 10),
      npthEdge: at(21.1, 10), // inside the 2.5 mm hole, near its edge
      via: at(5, 5),
      via2: at(15, 15),
      board: at(3, 17),
      warnings: warnings.length,
    };
  });
  await testInfo.attach("renderBoard", { body: await page.locator("canvas").screenshot(), contentType: "image/png" });
  expect(result.drills).toBe(1);
  expect(result.pth).toEqual([0, 0, 255, 255]);
  expect(result.npth).toEqual([0, 0, 255, 255]);
  expect(result.npthEdge).toEqual([0, 0, 255, 255]);
  expect(result.board).toEqual([0, 255, 0, 255]);
  expect(result.via).toEqual(result.board);
  expect(result.via2).toEqual(result.board);
  expect(result.warnings).toBe(1);
});

test("a drill diff ignores zero-diameter tools and finds the moved real hole", async ({ page }) => {
  const report = await page.evaluate(async () => {
    const { diff, renderer, drillText } = window.t;
    const messages = [];
    const base = { source: drillText, name: "board.drl" };
    // Head: the 1 mm hole moved to (12, 12); the zero-diameter vias moved too, which must not count.
    const head = {
      source: drillText.replace("X10.0Y10.0", "X12.0Y12.0").replace("X5.0Y5.0", "X6.0Y6.0"),
      name: "board.drl",
    };
    const result = await diff.analyzeLayerDiff(renderer, { base, head }, {
      width: 400,
      height: 300,
      padding: 2,
      mergeDistance: 2,
      onWarning: (message) => messages.push(message),
    });
    return { ...result, messages };
  });
  expect(report.changed).toBe(true);
  expect(report.regions.map((region) => region.kind).sort()).toEqual(["added", "removed"]);
  const added = report.regions.find((region) => region.kind === "added").world;
  const removed = report.regions.find((region) => region.kind === "removed").world;
  expect((added.minX + added.maxX) / 2).toBeCloseTo(12, 0);
  expect((removed.minX + removed.maxX) / 2).toBeCloseTo(10, 0);
  expect(report.messages).toEqual([
    "board.drl: Left out 2 drill hits of tools with no diameter",
    "board.drl: Left out 2 drill hits of tools with no diameter",
  ]);
});
