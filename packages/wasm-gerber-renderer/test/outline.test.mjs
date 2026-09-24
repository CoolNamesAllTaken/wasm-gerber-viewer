import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  boardCutouts,
  boardOutline,
  gerberExtents,
  outlineContours,
  pickBoard,
  signedArea,
} from "../outline.js";

const mm = (value) => String(Math.round(value * 1e6));
const header = "%FSLAX46Y46*%\n%MOMM*%\n%ADD10C,0.1*%\nD10*\nG01*\n";
// A stroke per edge, in shuffled order and directions, as exporters write them.
const segment = ([x1, y1], [x2, y2]) => `X${mm(x1)}Y${mm(y1)}D02*\nX${mm(x2)}Y${mm(y2)}D01*\n`;

test("stitches shuffled strokes into the board, flattens arcs and finds cutouts", () => {
  // 40 x 30 board whose top-right corner is a 5 mm radius arc, with a 4 x 2 slot.
  const text =
    header +
    segment([40, 0], [0, 0]) +
    segment([0, 30], [35, 30]) +
    segment([0, 0], [0, 30]) +
    segment([40, 25], [40, 0]) +
    // counter-clockwise arc from (40,25) to (35,30) about (35,25), mode on its own line
    `X${mm(40)}Y${mm(25)}D02*\nG03*\nX${mm(35)}Y${mm(30)}I${mm(-5)}J0D01*\nG01*\n` +
    segment([10, 10], [14, 10]) +
    segment([14, 12], [10, 12]) +
    segment([14, 10], [14, 12]) +
    segment([10, 12], [10, 10]) +
    "M02*\n";
  const contours = outlineContours(text);
  assert.equal(contours.length, 2);
  const board = pickBoard(contours);
  const cornerArea = 25 - (Math.PI * 25) / 4;
  assert.ok(Math.abs(board.area - (1200 - cornerArea)) < 0.05, `area ${board.area}`);
  assert.deepEqual(board.bounds, { minX: 0, maxX: 40, minY: 0, maxY: 30 });
  const arcPoint = board.points.find(([x, y]) => x > 35 && x < 40 && y > 25 && y < 30);
  assert.ok(arcPoint && Math.abs(Math.hypot(arcPoint[0] - 35, arcPoint[1] - 25) - 5) < 1e-6);

  const outline = boardOutline(text);
  assert.ok(signedArea(outline.outer) > 0, "outer is counter-clockwise");
  assert.equal(outline.holes.length, 1);
  assert.ok(signedArea(outline.holes[0]) < 0, "holes are clockwise");
  assert.ok(Math.abs(Math.abs(signedArea(outline.holes[0])) - 8) < 1e-9);
});

test("an outline drawn twice is one board, and duplicated slots are one cutout", () => {
  const square = segment([0, 0], [10, 0]) + segment([10, 0], [10, 10]) + segment([10, 10], [0, 10]) + segment([0, 10], [0, 0]);
  const slot = segment([2, 2], [4, 2]) + segment([4, 2], [4, 3]) + segment([4, 3], [2, 3]) + segment([2, 3], [2, 2]);
  const contours = outlineContours(header + square + square + slot + slot + "M02*\n");
  assert.equal(contours.length, 4);
  assert.equal(contours[0].points.length, 4, "a closed loop stops instead of going round again");
  const board = pickBoard(contours);
  assert.equal(boardCutouts(contours, board).length, 1);
});

test("pickBoard prefers the loop matching a stated board size over a sheet border", () => {
  const sheet = segment([-100, -100], [200, -100]) + segment([200, -100], [200, 100]) + segment([200, 100], [-100, 100]) + segment([-100, 100], [-100, -100]);
  const board = segment([0, 0], [20, 0]) + segment([20, 0], [20, 15]) + segment([20, 15], [0, 15]) + segment([0, 15], [0, 0]);
  const text = header + sheet + board + "M02*\n";
  assert.equal(boardOutline(text).bounds.maxX, 200, "largest loop without a size");
  const picked = boardOutline(text, { width: 20, height: 15 });
  assert.deepEqual(picked.bounds, { minX: 0, maxX: 20, minY: 0, maxY: 15 });
  assert.equal(picked.holes.length, 0);
  assert.deepEqual(gerberExtents(text), { minX: -100, maxX: 200, minY: -100, maxY: 100 });
});

test("reads the KiCad demo Edge_Cuts export", () => {
  const text = readFileSync(
    new URL("../../../examples/board-diff/base/pic_programmer-Edge_Cuts.gbr", import.meta.url),
    "utf8",
  );
  const outline = boardOutline(text);
  assert.ok(outline);
  assert.equal(outline.holes.length, 0);
  assert.ok(Math.abs(outline.bounds.minX - 73.66) < 1e-6 && Math.abs(outline.bounds.maxY + 40.64) < 1e-6);
  assert.equal(boardOutline("%FSLAX46Y46*%\n%MOMM*%\nM02*\n"), null);
});
