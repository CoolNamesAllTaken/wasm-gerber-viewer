import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  boardPalette,
  finishColor,
  maskColor,
  parseHexColor,
  silkColor,
  toHexColor,
} from "../palette.js";
import { groupBoardLayers, layerRole, plotsProfile, withoutProfile } from "../layers.js";
import {
  cutHoles,
  diffHoles,
  distinctHoles,
  holeMask,
  holesPath,
  holesToGerber,
  parseExcellon,
  projectHoles,
} from "../drills.js";
import {
  boundsOf,
  fitView,
  pixelRectToWorld,
  pixelsPerUnit,
  project,
  rasterToWorld,
  sharedView,
  unionBounds,
  unproject,
  worldToPixelRect,
} from "../view.js";
import { brightnessToAlpha, flipRows, traceMask } from "../contour.js";
import {
  addLayerDiff,
  diffPatterns,
  geometryText,
  prepareDiffSources,
  summarizeDiffPixels,
} from "../diff.js";
import { addBoardLayers, faceRasterSize, selectFace } from "../board.js";

const demo = new URL("../../../examples/board-diff/", import.meta.url);
const demoFile = (revision, name) =>
  readFileSync(new URL(`${revision}/pic_programmer-${name}`, demo), "utf8");

// ── palette ──────────────────────────────────────────────────────────────────

test("palette resolves names, hex and triples, and builds a full board palette", () => {
  assert.deepEqual(parseHexColor("#ff0000"), [1, 0, 0]);
  assert.deepEqual(parseHexColor("#0f0"), [0, 1, 0]);
  assert.equal(parseHexColor("red"), null);
  assert.equal(toHexColor([1, 0.5, 0]), "#ff8000");
  assert.deepEqual(maskColor("Light Green"), maskColor("light-green"));
  assert.deepEqual(maskColor([0.1, 0.2, 0.3]), [0.1, 0.2, 0.3]);
  assert.equal(maskColor("chartreuse-ish"), null);
  assert.equal(silkColor("None"), "none");
  assert.deepEqual(finishColor("HASL lead-free"), parseHexColor("#c0c0c8"));

  const palette = boardPalette({ mask: "red", silk: "none", finish: "ENIG", maskAlpha: 2 });
  assert.deepEqual(palette.mask.color, maskColor("red"));
  assert.equal(palette.mask.alpha, 1, "alpha is clamped");
  assert.equal(palette.silk, null);
  assert.deepEqual(palette.plating, palette.finish);
  const defaults = boardPalette();
  assert.deepEqual(defaults.mask.color, maskColor("green"));
  assert.ok(defaults.silk && defaults.silk.alpha === 1);
});

// ── layers ───────────────────────────────────────────────────────────────────

const PROFILE_GERBER = `%FSLAX46Y46*%
%MOMM*%
%TA.AperFunction,Profile*%
%ADD10C,0.100000*%
%TD*%
%TA.AperFunction,SMDPad,CuDef*%
%ADD11R,1.000000X1.000000*%
%TD*%
D10*
X0Y0D02*
X10000000Y0D01*
X10000000Y10000000D01*
D11*
X5000000Y5000000D03*
D10*
G36*
X1000000Y1000000D02*
X2000000Y1000000D01*
X2000000Y2000000D01*
G37*
M02*
`;

test("withoutProfile drops only Profile strokes and stops at regions", () => {
  assert.equal(plotsProfile(PROFILE_GERBER), true);
  const stripped = withoutProfile(PROFILE_GERBER);
  assert.ok(!stripped.includes("X10000000Y0D01*"), "profile stroke removed");
  assert.ok(stripped.includes("X5000000Y5000000D03*"), "pad kept");
  assert.ok(stripped.includes("X2000000Y1000000D01*"), "region after profile selection kept");
  assert.ok(stripped.includes("%ADD10C,0.100000*%"), "aperture definitions kept");
  const plain = "%FSLAX46Y46*%\n%MOMM*%\n%ADD10C,1*%\nD10*\nX0Y0D03*\nM02*\n";
  assert.equal(withoutProfile(plain), plain);
  assert.equal(plotsProfile(plain), false);
});

test("layerRole reads X2 file functions, KiCad names and Protel extensions", () => {
  assert.deepEqual(layerRole("x.gbr", "%TF.FileFunction,Copper,L1,Top*%\n"), {
    role: "copper",
    side: "top",
    index: 1,
  });
  assert.deepEqual(layerRole("x.gbr", "%TF.FileFunction,Soldermask,Bot*%\n"), {
    role: "mask",
    side: "bottom",
  });
  assert.equal(layerRole("", "%TF.FileFunction,Profile,NP*%").role, "outline");
  assert.deepEqual(layerRole("board-B_Silkscreen.gbr"), { role: "silk", side: "bottom" });
  assert.deepEqual(layerRole("board-In2_Cu.g3"), { role: "copper", side: "inner", index: 3 });
  assert.deepEqual(layerRole("board-Edge_Cuts.gm1"), { role: "outline", side: null });
  assert.deepEqual(layerRole("board.GTS"), { role: "mask", side: "top" });
  assert.deepEqual(layerRole("board.g4"), { role: "copper", side: "inner", index: 4 });
  assert.deepEqual(layerRole("board-NPTH.drl"), { role: "drill", side: null, plated: false });
  assert.equal(layerRole("readme.txt").role, "other");
});

test("groupBoardLayers sorts the KiCad demo export into a board", () => {
  const names = [
    "top_layer.gbr",
    "bottom_layer.gbr",
    "F_Mask.gbr",
    "B_Mask.gbr",
    "F_Silkscreen.gbr",
    "B_Silkscreen.gbr",
    "Edge_Cuts.gbr",
    "PTH.drl",
    "NPTH.drl",
  ];
  const files = names.map((name) => {
    const content = demoFile("base", name);
    return { name: `pic_programmer-${name}`, source: content, content };
  });
  const board = groupBoardLayers(files);
  // The copper files carry custom layer names; only X2 attributes identify them.
  assert.equal(board.top.copper.name, "pic_programmer-top_layer.gbr");
  assert.equal(board.bottom.copper.name, "pic_programmer-bottom_layer.gbr");
  assert.equal(board.top.mask.name, "pic_programmer-F_Mask.gbr");
  assert.equal(board.bottom.silk.name, "pic_programmer-B_Silkscreen.gbr");
  assert.equal(board.outline.name, "pic_programmer-Edge_Cuts.gbr");
  assert.deepEqual(
    board.drills.map((drill) => [drill.name, drill.plated]),
    [
      ["pic_programmer-PTH.drl", true],
      ["pic_programmer-NPTH.drl", false],
    ],
  );
  assert.deepEqual(board.other, []);
  const face = selectFace(board, "bottom");
  assert.equal(face.copper, board.bottom.copper);
  assert.equal(face.drills.length, 2);
});

// ── drills ───────────────────────────────────────────────────────────────────

test("parseExcellon reads KiCad decimal files with plating comments", () => {
  const pth = parseExcellon(demoFile("base", "PTH.drl"));
  const npth = parseExcellon(demoFile("base", "NPTH.drl"), { plated: false });
  assert.ok(pth.length > 100);
  assert.ok(pth.every((hole) => hole.plated === true && hole.diameter > 0));
  assert.ok(npth.length >= 4);
  assert.ok(npth.every((hole) => hole.plated === false));
  assert.ok(npth.some((hole) => hole.x === 77.47 && hole.y === -135.89));
  const moved = diffHoles(npth, parseExcellon(demoFile("head", "NPTH.drl"), { plated: false }));
  assert.equal(moved.changed, true);
  assert.deepEqual(moved.removed.map((hole) => [hole.x, hole.y]), [[77.47, -135.89]]);
  assert.deepEqual(moved.added.map((hole) => [hole.x, hole.y]), [[80.47, -133.89]]);
  assert.equal(moved.unchanged.length, npth.length - 1);
});

test("parseExcellon handles implied decimals, inches, G85 and rout slots", () => {
  const lz = parseExcellon("M48\nMETRIC,LZ\nT01C0.800\n%\nT01\nX010000Y020000\nX1Y2\nM30\n");
  assert.deepEqual(lz.map((hole) => [hole.x, hole.y]), [
    [10, 20],
    [100, 200],
  ]);
  const tz = parseExcellon("M48\nMETRIC,TZ\nT01C0.8\n%\nT01\nX10000Y2000\nM30\n");
  assert.deepEqual(tz.map((hole) => [hole.x, hole.y]), [[10, 2]]);
  const inch = parseExcellon("M48\nINCH\nT1C0.0394\n%\nT1\nX1.0Y-0.5\nM30\n");
  assert.ok(Math.abs(inch[0].x - 25.4) < 1e-9 && Math.abs(inch[0].y + 12.7) < 1e-9);
  assert.ok(Math.abs(inch[0].diameter - 1.00076) < 1e-6);

  const g85 = parseExcellon("M48\nMETRIC\nT1C1.0\n%\nT1\nX1.0Y2.0G85X5.0\nM30\n");
  assert.deepEqual([g85[0].x, g85[0].y, g85[0].x2, g85[0].y2], [1, 2, 5, 2]);
  const rout = parseExcellon(
    "M48\nMETRIC\nT1C1.0\n%\nT1\nG00X1.0Y1.0\nM15\nG01X1.0Y4.0\nM16\nG05\nX9.0Y9.0\nM30\n",
  );
  assert.deepEqual(
    rout.map((hole) => [hole.x, hole.y, hole.x2, hole.y2]),
    [
      [1, 1, 1, 4],
      [9, 9, null, null],
    ],
  );
  const twice = distinctHoles([...rout, { ...rout[0], x: 1, y: 4, x2: 1, y2: 1 }]);
  assert.equal(twice.length, 2, "a slot listed from either end is one slot");
});

test("hole projection, masks, canvas cuts and Gerber conversion", () => {
  const holes = [
    { x: 0, y: 0, diameter: 2, plated: true, x2: null, y2: null },
    { x: 5, y: 0, diameter: 1, plated: false, x2: 5, y2: 3 },
    { x: 9, y: 9, diameter: 1, plated: true, filled: true },
  ];
  const projected = projectHoles(holes, (x, y) => [x * 10, -y * 10], 10);
  assert.equal(projected.length, 2, "filled holes have no opening");
  assert.deepEqual(projected[0].slice(0, 3), [[0, -0], null, 10]);
  assert.deepEqual(projected[1][1], [50, -30]);

  const path = holesPath(projected);
  assert.match(path, /^M10\.00,0\.00 A10\.00,10\.00/);
  assert.match(path, /L55\.00,-30\.00/);
  const mask = holeMask(projected, 100, 50);
  assert.ok(mask.startsWith('url("data:image/svg+xml,'));
  assert.ok(decodeURIComponent(mask).includes('<mask id="m"'));
  assert.equal(holeMask([], 10, 10), "");

  const calls = [];
  const context = new Proxy(
    { globalCompositeOperation: "source-over" },
    {
      get(target, key) {
        if (key in target) return target[key];
        return (...args) => calls.push([key, ...args]);
      },
      set(target, key, value) {
        target[key] = value;
        calls.push(["set", key, value]);
        return true;
      },
    },
  );
  cutHoles(context, projected);
  assert.ok(calls.some(([name, key, value]) => name === "set" && key === "globalCompositeOperation" && value === "destination-out"));
  assert.equal(context.globalCompositeOperation, "source-over");
  assert.equal(calls.filter(([name]) => name === "arc").length, 3);

  const gerber = holesToGerber(holes);
  assert.match(gerber, /%ADD10C,2\.000000\*%/);
  assert.match(gerber, /X0Y0D03\*/);
  assert.match(gerber, /X5000000Y0D02\*\nX5000000Y3000000D01\*/);
  assert.match(gerber, /M02\*\n$/);
});

// ── view ─────────────────────────────────────────────────────────────────────

test("view helpers round-trip through the renderer's projection", () => {
  const bounds = { minX: 10, maxX: 110, minY: -80, maxY: -20 };
  const view = fitView(bounds, 1000, 600, 0);
  assert.equal(view.W, 1000);
  const [left, top] = project(view, 10, -20);
  assert.ok(Math.abs(top) < 1e-9, "top edge at y=0");
  assert.ok(left >= 0);
  for (const options of [{}, { flip: true }, { scale: 2 }, { flip: true, scale: 2 }]) {
    const [px, py] = project(view, 42, -33, options);
    const [x, y] = unproject(view, px, py, options);
    assert.ok(Math.abs(x - 42) < 1e-9 && Math.abs(y + 33) < 1e-9, JSON.stringify(options));
  }
  assert.ok(Math.abs(pixelsPerUnit(view) - 10) < 1e-9, "60 mm span on 600 px");
  const rect = worldToPixelRect(view, { minX: 20, maxX: 30, minY: -40, maxY: -30 });
  const back = pixelRectToWorld(view, rect);
  assert.ok(Math.abs(back.minX - 20) < 1e-9 && Math.abs(back.maxY + 30) < 1e-9);
  const flipped = { ...view, zoomX: -view.zoomX, offsetX: -view.offsetX };
  const mirrored = pixelRectToWorld(flipped, rect);
  assert.ok(mirrored.minX < mirrored.maxX, "flipped views still give sorted bounds");

  assert.deepEqual(boundsOf([[1, 2], [3, -4]]), { minX: 1, maxX: 3, minY: -4, maxY: 2 });
  assert.deepEqual(unionBounds(null, { minX: 0, maxX: 1, minY: 0, maxY: 1 }, [{ minX: -1, maxX: 0, minY: 0, maxY: 2 }]), {
    minX: -1,
    maxX: 1,
    minY: 0,
    maxY: 2,
  });
  const shared = sharedView([bounds, { minX: 0, maxX: 5, minY: 0, maxY: 5 }], 800, 800);
  assert.equal(shared.W, 800);
  assert.deepEqual(rasterToWorld(bounds, 100, 60, 0, 0), [10, -20]);
  assert.deepEqual(rasterToWorld(bounds, 100, 60, 100, 60), [110, -80]);
});

// ── contour ──────────────────────────────────────────────────────────────────

test("traceMask finds a ring's outline and its hole; helpers flip and lift alpha", () => {
  const size = 20;
  const solid = new Uint8Array(size * size);
  for (let y = 4; y < 16; y += 1) {
    for (let x = 4; x < 16; x += 1) {
      const inside = x >= 8 && x < 12 && y >= 8 && y < 12;
      solid[y * size + x] = inside ? 0 : 1;
    }
  }
  const shapes = traceMask(solid, size, size, 4);
  assert.equal(shapes.length, 1);
  assert.equal(shapes[0].holes.length, 1);
  const pixels = new Uint8ClampedArray([1, 2, 3, 0, 9, 0, 0, 0]);
  flipRows(pixels, 1, 2);
  assert.deepEqual([...pixels], [9, 0, 0, 0, 1, 2, 3, 0]);
  brightnessToAlpha(pixels);
  assert.deepEqual([pixels[3], pixels[7]], [9, 3]);
});

// ── diff (pure parts) ────────────────────────────────────────────────────────

test("diffPatterns classifies every union of base and head sources", () => {
  assert.deepEqual(diffPatterns(1, 1), { removed: ["10"], added: ["01"], unchanged: ["11"] });
  const many = diffPatterns(2, 1);
  assert.deepEqual(many.removed.sort(), ["100", "010", "110"].sort());
  assert.deepEqual(many.added, ["001"]);
  assert.deepEqual(many.unchanged.sort(), ["101", "011", "111"].sort());
  assert.throws(() => diffPatterns(0, 1), RangeError);
  assert.throws(() => diffPatterns(7, 6), RangeError);
});

test("geometryText ignores timestamps, comments and attributes only", () => {
  const base = demoFile("base", "Edge_Cuts.gbr");
  const head = demoFile("head", "Edge_Cuts.gbr");
  assert.notEqual(base, head, "KiCad re-exports differ in their creation date");
  assert.equal(geometryText(base), geometryText(head));
  assert.notEqual(
    geometryText(demoFile("base", "top_layer.gbr")),
    geometryText(demoFile("head", "top_layer.gbr")),
  );
  assert.equal(geometryText("G04 x*\n%TF.CreationDate,now*%\nX0Y0D03*\n"), "X0Y0D03*");
  assert.equal(geometryText("%TF.X*%X0Y0D03*\n"), "%TF.X*%X0Y0D03*", "packed lines are kept");
});

test("summarizeDiffPixels counts classes and merges nearby changes into regions", () => {
  const width = 64;
  const height = 32;
  const pixels = new Uint8Array(width * height * 4);
  const paint = (x0, y0, x1, y1, rgb) => {
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const at = (y * width + x) * 4;
        pixels.set([...rgb, 255], at);
      }
    }
  };
  paint(0, 0, 64, 32, [0, 0, 255]); // unchanged everywhere
  paint(2, 2, 6, 5, [255, 0, 0]); // removed 4x3
  paint(8, 2, 10, 4, [0, 255, 0]); // added 2x2, close to the removal
  paint(50, 20, 53, 30, [0, 255, 0]); // added, far away
  const summary = summarizeDiffPixels(pixels, width, height, { cellSize: 4, mergeDistance: 4 });
  assert.equal(summary.removedPixels, 12);
  assert.equal(summary.addedPixels, 4 + 30);
  assert.equal(summary.unchangedPixels, width * height - 12 - 34);
  assert.equal(summary.changed, true);
  assert.equal(summary.regions.length, 2);
  const [big, near] = summary.regions;
  assert.deepEqual(big, { kind: "added", addedPixels: 30, removedPixels: 0, pixels: { x: 50, y: 20, width: 3, height: 10 } });
  assert.deepEqual(near.kind, "mixed");
  assert.deepEqual(near.pixels, { x: 2, y: 2, width: 8, height: 3 });

  // bottom-up rows (raw readPixels) give the same y-down boxes
  const flipped = flipRows(new Uint8Array(pixels), width, height);
  const again = summarizeDiffPixels(flipped, width, height, { cellSize: 4, mergeDistance: 4, bottomUp: true });
  assert.deepEqual(again.regions, summary.regions);

  const quiet = summarizeDiffPixels(new Uint8Array(16 * 4), 4, 4);
  assert.deepEqual(quiet, { changed: false, addedPixels: 0, removedPixels: 0, unchangedPixels: 0, regions: [], truncated: false });
});

test("prepareDiffSources converts drill files to Gerber and can strip profiles", async () => {
  const [drill] = await prepareDiffSources({ source: demoFile("base", "NPTH.drl"), name: "x-NPTH.drl" });
  assert.equal(drill.kind, "gerber");
  assert.equal(drill.empty, false);
  assert.match(drill.source, /^%FSLAX46Y46\*%/);
  const [stripped] = await prepareDiffSources(PROFILE_GERBER, { stripProfile: true });
  assert.ok(!stripped.source.includes("X10000000Y0D01*"));
  const [empty] = await prepareDiffSources("M48\nMETRIC\nT1C1\n%\nM30\n");
  assert.equal(empty.empty, true);
  assert.deepEqual(await prepareDiffSources(null), []);
});

// ── orchestration against a recording renderer ──────────────────────────────

function recordingRenderer() {
  const calls = [];
  let next = 0;
  return {
    calls,
    async renderLayer(layer, options = {}) {
      calls.push(["layer", layer.name ?? null, options]);
      return next++;
    },
    async renderInvertedLayer(layer, options = {}) {
      calls.push(["inverted", options]);
      next += 2;
      return next++;
    },
    async renderCompositeLayer(ids, options = {}) {
      calls.push(["composite", ids, options]);
      return next++;
    },
  };
}

test("addLayerDiff builds hidden sources and three classifying composites", async () => {
  const renderer = recordingRenderer();
  const ids = await addLayerDiff(renderer, { base: "G04*\nM02*\n", head: ["M02*\n", "M02*\n"] }, {
    style: { added: { color: [0, 0, 1] } },
    showUnchanged: false,
  });
  const layers = renderer.calls.filter(([kind]) => kind === "layer");
  assert.equal(layers.length, 3);
  assert.ok(layers.every(([, , options]) => options.visible === false));
  const composites = renderer.calls.filter(([kind]) => kind === "composite");
  assert.deepEqual(composites.map(([, , options]) => options.name), ["Unchanged", "Removed", "Added"]);
  assert.deepEqual(composites[0][1], [0, 1, 2]);
  assert.equal(composites[0][2].visible, false);
  assert.deepEqual(composites[2][2].color, [0, 0, 1]);
  assert.deepEqual(ids, { unchanged: 3, removed: 4, added: 5 });

  const absent = recordingRenderer();
  const onlyHead = await addLayerDiff(absent, { base: null, head: "M02*\n" });
  assert.equal(onlyHead.added, 0);
  assert.equal(absent.calls.length, 1);
  assert.equal(absent.calls[0][2].alpha, 1);
});

test("addBoardLayers stacks substrate, copper, mask, finish, silk and see-through drills", async () => {
  const renderer = recordingRenderer();
  const ids = await addBoardLayers(renderer, {
    outline: { source: "M02*\n", name: "edge.gbr" },
    top: { copper: "M02*\n", mask: "M02*\n", silk: "M02*\n" },
    drills: [{ source: "M48\n%\nM30\n", name: "b-PTH.drl" }],
  }, { palette: { mask: "blue" } });
  const kinds = renderer.calls.map(([kind, name, options]) =>
    kind === "composite" ? `composite:${options.name}` : kind === "inverted" ? `inverted:${name.name}` : `layer:${options.visible === false ? "hidden" : "shown"}`,
  );
  assert.deepEqual(kinds, [
    "layer:hidden", // outline
    "layer:hidden", // outline twin
    "composite:Substrate",
    "layer:shown", // copper
    "inverted:Solder mask",
    "layer:hidden", // mask as a source
    "composite:Surface finish",
    "layer:hidden", // silk as a source
    "composite:Silkscreen",
    "layer:shown", // drill
  ]);
  const substrate = renderer.calls[2][2];
  assert.deepEqual(substrate.visibleAreas, ["00", "11"]);
  assert.equal(substrate.outlineLayerId, ids.outline);
  const mask = renderer.calls[4][1];
  assert.deepEqual(mask.color, maskColor("blue"));
  assert.equal(mask.outlineLayerId, ids.outline);
  assert.deepEqual(renderer.calls[6][1], [ids.copper, 7], "finish = copper AND the mask loaded as a source");
  // Silk on mask only, and only inside the outline: the inversion of every
  // other [silk, mask] code, clipped to the outline.
  assert.deepEqual(renderer.calls[8][2].visibleAreas, ["00", "01", "11"]);
  assert.equal(renderer.calls[8][2].inverted, true);
  assert.equal(renderer.calls[8][2].outlineLayerId, ids.outline);
  assert.equal(renderer.calls[9][1], "b-PTH.drl");
  assert.equal(ids.drills.length, 1);

  const bare = recordingRenderer();
  await addBoardLayers(bare, { copper: "M02*\n" }, { substrate: false, holes: false });
  assert.equal(bare.calls.length, 1);
});

test("faceRasterSize honors density, minimum and texture ceilings", () => {
  const small = faceRasterSize({ minX: 0, maxX: 15, minY: 0, maxY: 20 });
  assert.equal(small.width, 2048);
  assert.equal(small.height, Math.round(20 * (2048 / 15)));
  const panel = faceRasterSize({ minX: 0, maxX: 300, minY: 0, maxY: 200 }, { maxTextureSize: 4096 });
  assert.equal(panel.width, 4096);
  assert.ok(panel.height <= 4096);
  assert.ok(Math.abs(panel.width / panel.height - 1.5) < 0.01);
});
