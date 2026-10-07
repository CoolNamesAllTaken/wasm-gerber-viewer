import assert from "node:assert/strict";
import test from "node:test";

import { prepareDiffSources } from "../diff.js";
import { dropEmptyTools, holesToGerber, parseExcellon, withoutEmptyTools } from "../drills.js";
import { parseDrillLayerPayload, prepareDrillContent } from "../shared.js";
import { loadWasmModule } from "./helpers/wasm-module.mjs";

// What KiCad 10 writes for a board with undrilled vias (its royalblue54L_feather
// demo): a `T1C0.000` tool whose hits the WASM refuses along with the whole file.
const KICAD_DRILL = [
  "M48",
  "; DRILL file KiCad 10.0.6 date 2026-10-07T02:16:22",
  "; FORMAT={-:-/ absolute / metric / decimal}",
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
].join("\n");

const CLEANED = [
  "M48",
  "; DRILL file KiCad 10.0.6 date 2026-10-07T02:16:22",
  "; FORMAT={-:-/ absolute / metric / decimal}",
  "FMAT,2",
  "METRIC",
  "; #@! TA.AperFunction,Plated,PTH,ViaDrill",
  "; #@! TA.AperFunction,Plated,PTH,ComponentDrill",
  "T2C1.000",
  "; #@! TA.AperFunction,NonPlated,NPTH,ComponentDrill",
  "T3C2.500",
  "%",
  "G90",
  "G05",
  "T2",
  "X10.0Y10.0",
  "T3",
  "X20.0Y10.0",
  "M30",
].join("\n");

test("dropEmptyTools drops a zero-diameter tool and its hits and keeps the rest byte for byte", () => {
  const result = dropEmptyTools(KICAD_DRILL);
  assert.equal(result.text, CLEANED);
  assert.deepEqual(result.dropped, [{ tool: 1, diameter: 0, hits: 2 }]);
  assert.equal(result.warning, "Dropped a drill tool with no diameter (T1C0) and 2 hits");
  assert.equal(withoutEmptyTools(KICAD_DRILL), CLEANED);
});

test("dropEmptyTools returns a file without such tools unchanged", () => {
  const text = "M48\nMETRIC\nT1C0.3\n%\nT1\nX1Y1\nM30\n";
  const result = dropEmptyTools(text);
  assert.equal(result.text, text);
  assert.deepEqual(result.dropped, []);
  assert.equal(result.warning, null);
  assert.equal(withoutEmptyTools(""), "");
});

test("dropEmptyTools handles negative diameters, other tool parameters, CRLF and leading zeros", () => {
  const text = [
    "M48", "INCH,LZ", "T01F200S65C-0.010", "T02C0.0400", "%",
    "T01", "X010000Y010000", "X020000Y010000", "T02", "X030000Y010000", "M30",
  ].join("\r\n");
  const result = dropEmptyTools(text);
  assert.equal(result.text, ["M48", "INCH,LZ", "T02C0.0400", "%", "T02", "X030000Y010000", "M30"].join("\r\n"));
  assert.deepEqual(result.dropped, [{ tool: 1, diameter: -0.01, hits: 2 }]);
});

test("dropEmptyTools drops rout moves and G85 slots of an empty tool but keeps mode changes", () => {
  const text = [
    "M48", "METRIC", "T1C0", "T2C0.8", "%",
    "T1", "G00X1Y1", "M15", "G01X2Y1", "M16", "X3Y3G85X4Y3", "G05",
    "T2", "X5Y5", "M30",
  ].join("\n");
  const result = dropEmptyTools(text);
  assert.equal(result.text, ["M48", "METRIC", "T2C0.8", "%", "G05", "T2", "X5Y5", "M30"].join("\n"));
  assert.deepEqual(parseExcellon(result.text), parseExcellon(text));
});

test("dropEmptyTools drops a zero-diameter tool defined in the body", () => {
  const text = ["M48", "METRIC", "T2C0.8", "%", "T1C0.000", "X1Y1", "T2", "X5Y5", "M30"].join("\n");
  assert.equal(withoutEmptyTools(text), ["M48", "METRIC", "T2C0.8", "%", "T2", "X5Y5", "M30"].join("\n"));
});

test("parseExcellon leaves out zero-diameter hits and says so; holesToGerber flashes only real holes", () => {
  const warnings = [];
  const holes = parseExcellon(KICAD_DRILL, { onWarning: (message) => warnings.push(message) });
  assert.deepEqual(holes.map(({ x, y, diameter, plated }) => [x, y, diameter, plated]), [
    [10, 10, 1, true],
    [20, 10, 2.5, false],
  ]);
  assert.deepEqual(warnings, ["Left out 2 drill hits of tools with no diameter"]);
  const gerber = holesToGerber(holes);
  assert.equal(gerber.match(/D03\*/g).length, 2);
  assert.doesNotMatch(gerber, /C,0\.000000/);
});

test("prepareDrillContent cleans the text and reports to the first handler, or console.warn", (t) => {
  const heard = [];
  const text = prepareDrillContent(KICAD_DRILL, "board.drl", undefined, (message, detail) => heard.push([message, detail]));
  assert.equal(text, CLEANED);
  assert.deepEqual(heard, [[
    "board.drl: Dropped a drill tool with no diameter (T1C0) and 2 hits",
    { name: "board.drl", dropped: [{ tool: 1, diameter: 0, hits: 2 }] },
  ]]);

  const warn = t.mock.method(console, "warn", () => {});
  assert.equal(prepareDrillContent(KICAD_DRILL, null), CLEANED);
  assert.equal(warn.mock.callCount(), 1);
  assert.match(warn.mock.calls[0].arguments[0], /^wasm-gerber-renderer: Dropped a drill tool/);
  assert.equal(prepareDrillContent(CLEANED, "x.drl"), CLEANED);
  assert.equal(warn.mock.callCount(), 1);
});

test("prepareDiffSources converts a drill file with a zero-diameter tool and passes the warning on", async () => {
  const heard = [];
  const [prepared] = await prepareDiffSources({ source: KICAD_DRILL, name: "board.drl" }, {
    onWarning: (message) => heard.push(message),
  });
  assert.equal(prepared.kind, "gerber");
  assert.equal(prepared.empty, false);
  assert.equal(prepared.source.match(/D03\*/g).length, 2);
  assert.deepEqual(heard, ["board.drl: Left out 2 drill hits of tools with no diameter"]);
});

test("the WASM rejects a zero-diameter tool; parseDrillLayerPayload drops it and parses the real holes", async (t) => {
  const wasmModule = await loadWasmModule();
  if (!wasmModule) {
    t.skip("wasm/pkg is not built");
    return;
  }
  assert.throws(() => wasmModule.parse_drill_layer(KICAD_DRILL, 0, 0), /diameter must be positive/);
  const parsed = parseDrillLayerPayload(wasmModule, KICAD_DRILL, 0, 0);
  // The bounds cover the two real holes only (the drill outline adds its rim).
  assert.ok(parsed.bounds.minX > 8 && parsed.bounds.maxX < 22, JSON.stringify(parsed.bounds));
  assert.ok(parsed.bounds.minY > 8 && parsed.bounds.maxY < 12, JSON.stringify(parsed.bounds));
});
