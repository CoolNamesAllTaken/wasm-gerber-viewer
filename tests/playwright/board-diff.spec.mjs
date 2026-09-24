import { expect, test } from "@playwright/test";

// GPU pixel tests for the board/diff modules of packages/wasm-gerber-renderer:
// layer diff colors and regions, one shared frame for both revisions, the
// geometry-identical shortcut, see-through holes (renderer, CSS mask, 2D cut)
// and drill diffs. Everything runs in the page against the real WASM renderer.

const PACKAGE = "/packages/wasm-gerber-renderer/";

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => {
    throw error;
  });
  await page.goto("/tests/fixtures/benchmark.html");
  await page.evaluate(async (base) => {
    const load = (name) => import(`${base}${name}.js`);
    const [index, board, diff, drills, raster, view, layers] = await Promise.all(
      ["index", "board", "diff", "drills", "raster", "view", "layers"].map(load),
    );
    // Gerber helpers, all in millimeters (format 4.6).
    const mm = (value) => String(Math.round(value * 1e6));
    const header = "%FSLAX46Y46*%\n%MOMM*%\n%LPD*%\nG01*\n";
    const rect = (cx, cy, w, h) =>
      `${header}%ADD10R,${w}X${h}*%\nD10*\nX${mm(cx)}Y${mm(cy)}D03*\nM02*\n`;
    const circle = (cx, cy, d) =>
      `${header}%ADD10C,${d}*%\nD10*\nX${mm(cx)}Y${mm(cy)}D03*\nM02*\n`;
    const outline = (points) =>
      `${header}%ADD10C,0.1*%\nD10*\n` +
      points.map(([x, y], i) => `X${mm(x)}Y${mm(y)}D0${i ? 1 : 2}*`).join("\n") +
      `\nX${mm(points[0][0])}Y${mm(points[0][1])}D01*\nM02*\n`;
    const drill = (holes) =>
      `M48\nMETRIC\nT1C${holes[0][2].toFixed(3)}\n%\nT1\n` +
      holes.map(([x, y]) => `X${x.toFixed(3)}Y${y.toFixed(3)}`).join("\n") +
      "\nM30\n";

    const canvas = document.createElement("canvas");
    document.body.appendChild(canvas);
    const renderer = await index.createGerberRenderer(canvas);
    const pixelAt = (x, y) => {
      const { pixels } = raster.readRendererPixels(renderer, { rect: { x, y, width: 1, height: 1 } });
      return [...pixels];
    };
    // Canvas pixel of a world point in the last frame.
    const at = (x, y) => {
      const frame = renderer.lastFrame;
      const point = index.projectToCanvas(frame.view, x, y, frame.width, frame.height);
      return pixelAt(Math.floor(point.x), Math.floor(point.y));
    };
    Object.assign(window, {
      t: { index, board, diff, drills, raster, view, layers, rect, circle, outline, drill, renderer, pixelAt, at, canvas },
    });
  }, PACKAGE);
});

test("layer diff paints removed red, added green and unchanged dim in one frame", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { diff, renderer, rect, at } = window.t;
    const base = rect(5, 5, 4, 4); // x 3..7
    const head = rect(7, 5, 4, 4); // x 5..9
    const rendered = await diff.renderLayerDiff(renderer, { base, head }, {
      width: 400,
      height: 200,
      padding: 0,
      style: {
        removed: { color: [1, 0, 0], alpha: 1 },
        added: { color: [0, 1, 0], alpha: 1 },
        unchanged: { color: [0, 0, 1], alpha: 0.5 },
      },
    });
    return {
      removed: at(4, 5),
      added: at(8, 5),
      unchanged: at(6, 5),
      bounds: rendered.frame.bounds,
      view: rendered.view,
    };
  });
  expect(result.removed).toEqual([255, 0, 0, 255]);
  expect(result.added).toEqual([0, 255, 0, 255]);
  // Premultiplied: 50% blue over transparent.
  expect(result.unchanged[2]).toBeGreaterThanOrEqual(126);
  expect(result.unchanged[2]).toBeLessThanOrEqual(129);
  expect(result.unchanged[3]).toBeGreaterThanOrEqual(126);
  expect(result.unchanged.slice(0, 2)).toEqual([0, 0]);
  // The frame is fitted to the union of both revisions.
  expect(result.bounds.minX).toBeCloseTo(3, 5);
  expect(result.bounds.maxX).toBeCloseTo(9, 5);
  expect(result.view.W).toBe(400);
});

test("both revisions share one frame: base-only extents do not shift head pixels", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { diff, renderer, rect, circle, view } = window.t;
    // The head grows a far-away feature; the union frame must hold both.
    const base = rect(5, 5, 4, 4);
    const head = `${circle(40, 5, 2).replace("M02*\n", "")}%ADD11R,4X4*%\nD11*\nX5000000Y5000000D03*\nM02*\n`;
    const report = await diff.analyzeLayerDiff(renderer, { base, head }, { width: 500, height: 100, padding: 0 });
    const rendered = await diff.renderLayerDiff(renderer, { base, head }, { width: 500, height: 100, padding: 0 });
    const measured = await diff.measureLayers(renderer, [base, head]);
    const expected = view.fitView(measured.bounds, 500, 100, 0);
    return { report, renderedView: rendered.view, expected };
  });
  // analyze and render resolve the same view, and it is the union fit.
  for (const key of ["zoomX", "zoomY", "offsetX", "offsetY"]) {
    expect(result.report.view[key]).toBeCloseTo(result.renderedView[key], 9);
    expect(result.renderedView[key]).toBeCloseTo(result.expected[key], 9);
  }
  // Only the new circle changed; the unchanged square contributes nothing.
  expect(result.report.changed).toBe(true);
  expect(result.report.removedPixels).toBe(0);
  expect(result.report.regions).toHaveLength(1);
  const [region] = result.report.regions;
  expect(region.kind).toBe("added");
  const pixelMm = result.report.pixelSizeMm;
  expect(Math.abs(region.world.minX - 39)).toBeLessThanOrEqual(2 * pixelMm);
  expect(Math.abs(region.world.maxX - 41)).toBeLessThanOrEqual(2 * pixelMm);
  expect(Math.abs(region.world.minY - 4)).toBeLessThanOrEqual(2 * pixelMm);
  expect(Math.abs(region.world.maxY - 6)).toBeLessThanOrEqual(2 * pixelMm);
});

test("analyzeLayerDiff reports regions in pixels and world units, flips included", async ({ page }) => {
  const reports = await page.evaluate(async () => {
    const { diff, renderer, rect } = window.t;
    const base = rect(5, 5, 4, 4);
    const head = rect(25, 5, 2, 2);
    const options = { width: 600, height: 200, padding: 0, mergeDistance: 4 };
    return [
      await diff.analyzeLayerDiff(renderer, { base, head }, options),
      await diff.analyzeLayerDiff(renderer, { base, head }, { ...options, flipX: true }),
    ];
  });
  for (const report of reports) {
    expect(report.changed).toBe(true);
    expect(report.identical).toBe(false);
    expect(report.regions.map((region) => region.kind).sort()).toEqual(["added", "removed"]);
    const removed = report.regions.find((region) => region.kind === "removed");
    const added = report.regions.find((region) => region.kind === "added");
    const tolerance = 2 * report.pixelSizeMm;
    expect(Math.abs(removed.world.minX - 3)).toBeLessThanOrEqual(tolerance);
    expect(Math.abs(removed.world.maxX - 7)).toBeLessThanOrEqual(tolerance);
    expect(Math.abs(added.world.minX - 24)).toBeLessThanOrEqual(tolerance);
    expect(Math.abs(added.world.maxX - 26)).toBeLessThanOrEqual(tolerance);
    expect(removed.removedPixels).toBeGreaterThan(added.addedPixels);
  }
  // Mirrored, the removal is on the right of the canvas instead of the left.
  const [plain, mirrored] = reports;
  const plainRemoved = plain.regions.find((region) => region.kind === "removed").pixels;
  const mirroredRemoved = mirrored.regions.find((region) => region.kind === "removed").pixels;
  expect(plainRemoved.x).toBeLessThan(300);
  expect(mirroredRemoved.x).toBeGreaterThan(300);
});

test("unchanged geometry: timestamps are skipped, re-encodings render identical pixels", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { diff, renderer, rect } = window.t;
    const base = rect(5, 5, 4, 4);
    const stamped = `%TF.CreationDate,2026-01-01T00:00:00*%\nG04 exported again*\n${base}`;
    // Same square, different aperture number and a region instead of a flash.
    const region =
      "%FSLAX46Y46*%\n%MOMM*%\n%LPD*%\nG01*\nG36*\nX3000000Y3000000D02*\nX7000000Y3000000D01*\n" +
      "X7000000Y7000000D01*\nX3000000Y7000000D01*\nX3000000Y3000000D01*\nG37*\nM02*\n";
    return {
      stamped: await diff.analyzeLayerDiff(renderer, { base, head: stamped }, { width: 200, height: 200 }),
      region: await diff.analyzeLayerDiff(renderer, { base, head: region }, { width: 200, height: 200 }),
      absent: await diff.analyzeLayerDiff(renderer, { base, head: null }, { width: 200, height: 200 }),
    };
  });
  expect(result.stamped).toMatchObject({ changed: false, identical: true, regions: [] });
  expect(result.region.identical).toBe(false);
  expect(result.region.changed).toBe(false);
  expect(result.region.unchangedPixels).toBeGreaterThan(1000);
  expect(result.absent.changed).toBe(true);
  expect(result.absent.addedPixels).toBe(0);
  expect(result.absent.regions).toHaveLength(1);
  expect(result.absent.regions[0].kind).toBe("removed");
});

test("drill layers diff as holes: a moved hole is one removal and one addition", async ({ page }) => {
  const report = await page.evaluate(async () => {
    const { diff, renderer, drill } = window.t;
    const base = { source: drill([[10, 10, 1], [20, 10, 1]]), name: "b-NPTH.drl" };
    const head = { source: drill([[10, 10, 1], [23, 12, 1]]), name: "b-NPTH.drl" };
    return diff.analyzeLayerDiff(renderer, { base, head }, { width: 400, height: 200, padding: 10, mergeDistance: 2 });
  });
  expect(report.changed).toBe(true);
  expect(report.regions.map((region) => region.kind).sort()).toEqual(["added", "removed"]);
  const removed = report.regions.find((region) => region.kind === "removed").world;
  const added = report.regions.find((region) => region.kind === "added").world;
  expect((removed.minX + removed.maxX) / 2).toBeCloseTo(20, 0);
  expect((added.minX + added.maxX) / 2).toBeCloseTo(23, 0);
  expect((added.minY + added.maxY) / 2).toBeCloseTo(12, 0);
});

test("realistic board: holes and the area outside the outline are transparent", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { board, renderer, rect, outline, drill, at } = window.t;
    // An L-shaped board: 30 x 20 with the top-right 10 x 10 corner cut away.
    const edge = outline([[0, 0], [30, 0], [30, 10], [20, 10], [20, 20], [0, 20]]);
    const copper = rect(10, 10, 4, 4); // pad at (10,10), 8..12
    const mask = rect(10, 10, 5, 5); // opening 7.5..12.5
    const holes = { source: drill([[10, 10, 1.5]]), name: "b-PTH.drl" };
    // Silk: a bar across the board that runs off its left edge and into the
    // notch, and one that crosses the mask opening.
    const stroke = (x1, y1, x2, y2) =>
      `%FSLAX46Y46*%\n%MOMM*%\n%ADD10C,1*%\nD10*\nX${x1 * 1e6}Y${y1 * 1e6}D02*\nX${x2 * 1e6}Y${y2 * 1e6}D01*\n`;
    const silk = stroke(-3, 15, 25, 15) + `X${5 * 1e6}Y${11 * 1e6}D02*\nX${15 * 1e6}Y${11 * 1e6}D01*\nM02*\n`;
    const { ids } = await board.renderBoard(renderer, {
      outline: edge,
      copper,
      mask,
      silk,
      // A header-only NPTH file (KiCad writes one for boards without NPTH holes).
      drills: [holes, { source: "M48\nMETRIC\n%\nM30\n", name: "b-NPTH.drl" }],
    }, {
      width: 600,
      height: 400,
      padding: 0,
      palette: { mask: "#00ff00", maskAlpha: 1, finish: "#ffff00", substrate: "#ff00ff", silk: "#ffffff" },
    });
    const transparent = {
      hole: at(10, 10),
      notch: at(27, 17),
      outside: at(-1, -1),
      silkOffBoard: at(-2, 15),
      silkInNotch: at(23, 15),
    };
    const silkShown = { onMask: at(5, 15), beforeOpening: at(6, 11), inOpening: at(11.8, 11) };
    const shown = {
      mask: at(3, 3),
      finish: at(11.8, 10),
      pullback: at(7.8, 10), // inside the mask opening, off the copper: substrate
      boardCornerBelowNotch: at(27, 5),
    };
    // The same board on an opaque background: holes show the background.
    await board.renderBoard(renderer, { outline: edge, copper, mask, drills: [holes] }, {
      width: 600, height: 400, padding: 0, background: "#0000ff",
      palette: { mask: "#00ff00", maskAlpha: 1, finish: "#ffff00", substrate: "#ff00ff" },
    });
    return { ids, transparent, shown, silkShown, onBackground: { hole: at(10, 10), notch: at(27, 17) } };
  });
  expect(result.ids.drills).toHaveLength(1);
  expect(result.transparent.hole[3]).toBe(0);
  expect(result.transparent.notch[3]).toBe(0);
  expect(result.transparent.outside[3]).toBe(0);
  expect(result.transparent.silkOffBoard[3]).toBe(0);
  expect(result.transparent.silkInNotch[3]).toBe(0);
  expect(result.silkShown.onMask).toEqual([255, 255, 255, 255]);
  expect(result.silkShown.beforeOpening).toEqual([255, 255, 255, 255]);
  expect(result.silkShown.inOpening).toEqual([255, 255, 0, 255]); // finish, not silk
  expect(result.shown.mask).toEqual([0, 255, 0, 255]);
  expect(result.shown.finish).toEqual([255, 255, 0, 255]);
  expect(result.shown.pullback).toEqual([255, 0, 255, 255]);
  expect(result.shown.boardCornerBelowNotch).toEqual([0, 255, 0, 255]);
  expect(result.onBackground.hole).toEqual([0, 0, 255, 255]);
  expect(result.onBackground.notch).toEqual([0, 0, 255, 255]);
});

test("CSS hole mask and 2D canvas cut open the holes they are given", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { drills } = window.t;
    const holes = [
      { x: 20, y: 20, diameter: 10, plated: true },
      { x: 60, y: 20, diameter: 6, plated: false, x2: 80, y2: 20 },
    ];
    const projected = drills.projectHoles(holes, (x, y) => [x, y], 1);
    const mask = drills.holeMask(projected, 100, 40);

    // The mask image itself: white where the element stays, clear in holes.
    const image = new Image();
    image.src = mask.slice(5, -2);
    await image.decode();
    const probe = document.createElement("canvas");
    probe.width = 100;
    probe.height = 40;
    const context = probe.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const alpha = (x, y) => context.getImageData(x, y, 1, 1).data[3];
    const masked = { hole: alpha(20, 20), slotMiddle: alpha(70, 20), slotEnd: alpha(81, 20), solid: alpha(40, 5) };

    const element = document.createElement("div");
    drills.applyHoleMask(element, mask);
    const styled = element.style.maskImage.startsWith("url(") && element.style.maskSize === "100% 100%";

    const cut = document.createElement("canvas");
    cut.width = 100;
    cut.height = 40;
    const cutContext = cut.getContext("2d", { willReadFrequently: true });
    cutContext.fillStyle = "#f00";
    cutContext.fillRect(0, 0, 100, 40);
    drills.cutHoles(cutContext, projected);
    const cutAlpha = (x, y) => cutContext.getImageData(x, y, 1, 1).data[3];
    return {
      masked,
      styled,
      cut: { hole: cutAlpha(20, 20), slot: cutAlpha(75, 20), solid: cutAlpha(40, 5), op: cutContext.globalCompositeOperation },
    };
  });
  expect(result.masked.hole).toBe(0);
  expect(result.masked.slotMiddle).toBe(0);
  expect(result.masked.slotEnd).toBe(0);
  expect(result.masked.solid).toBe(255);
  expect(result.styled).toBe(true);
  expect(result.cut).toEqual({ hole: 0, slot: 0, solid: 255, op: "source-over" });
});

test("face raster maps board bounds linearly and flattens onto laminate", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { board, renderer, rect, outline, view } = window.t;
    const bounds = { minX: 0, maxX: 40, minY: 0, maxY: 20 };
    const face = await board.renderFaceRaster(renderer, {
      outline: outline([[0, 0], [40, 0], [40, 20], [0, 20]]),
      copper: rect(30, 5, 2, 2),
    }, { bounds, width: 400, height: 200, palette: { substrate: "#808080", mask: "#00ff00", maskAlpha: 1 } });
    const context = face.canvas.getContext("2d", { willReadFrequently: true });
    const [px, py] = [300, 150]; // raster pixel for (30, 5)
    const world = view.rasterToWorld(bounds, 400, 200, px, py);
    return { size: [face.width, face.height], world, copper: [...context.getImageData(px, py, 1, 1).data] };
  });
  expect(result.size).toEqual([400, 200]);
  expect(result.world).toEqual([30, 5]);
  // Bare copper (no mask layer given, so no mask and no finish over it).
  expect(result.copper[3]).toBe(255);
  expect(result.copper[0]).toBeGreaterThan(result.copper[2]);
});

test("the demo board diff finds exactly the changes made to the head revision", async ({ page }) => {
  test.setTimeout(180_000);
  const result = await page.evaluate(async () => {
    const { diff, renderer, layers } = window.t;
    const names = ["top_layer.gbr", "bottom_layer.gbr", "B_Silkscreen.gbr", "Edge_Cuts.gbr", "NPTH.drl"];
    const load = async (revision) =>
      layers.groupBoardLayers(
        await Promise.all(
          names.map(async (name) => {
            const content = await (await fetch(`/examples/board-diff/${revision}/pic_programmer-${name}`)).text();
            return { name: `pic_programmer-${name}`, source: content, content };
          }),
        ),
      );
    const [base, head] = await Promise.all([load("base"), load("head")]);
    const report = await diff.analyzeBoardDiff(renderer, [
      { name: "F.Cu", base: base.top.copper, head: head.top.copper },
      { name: "B.Cu", base: base.bottom.copper, head: head.bottom.copper },
      { name: "B.Silk", base: base.bottom.silk, head: head.bottom.silk },
      { name: "Edge.Cuts", base: base.outline, head: head.outline },
      { name: "NPTH", base: base.drills, head: head.drills },
    ], { width: 1024, height: 768, padding: 8 });
    return {
      changed: report.layers.map((layer) => [layer.name, layer.changed, layer.identical]),
      npth: report.layers[4].regions.map((region) => [region.kind, region.world]),
    };
  });
  expect(result.changed).toEqual([
    ["F.Cu", true, false],
    ["B.Cu", true, false],
    ["B.Silk", false, true],
    ["Edge.Cuts", false, true],
    ["NPTH", true, false],
  ]);
  // The M4 mounting hole moved from (77.47, -135.89) to (80.47, -133.89).
  const centers = result.npth.map(([kind, world]) => [kind, (world.minX + world.maxX) / 2, (world.minY + world.maxY) / 2]);
  const removed = centers.find(([kind]) => kind === "removed");
  const added = centers.find(([kind]) => kind === "added");
  const mixed = centers.find(([kind]) => kind === "mixed");
  if (mixed) {
    // 4.3 mm holes 3.6 mm apart overlap, so they may be one mixed region.
    expect(mixed[1]).toBeCloseTo(78.97, 0);
  } else {
    expect(removed[1]).toBeCloseTo(77.47, 0);
    expect(removed[2]).toBeCloseTo(-135.89, 0);
    expect(added[1]).toBeCloseTo(80.47, 0);
    expect(added[2]).toBeCloseTo(-133.89, 0);
  }
});
