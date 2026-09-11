import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateFitView,
  projectToCanvas,
  unprojectFromCanvas,
  viewExtent,
} from "../index.js";
import { resolveFrameView } from "../shared.js";

const BOUNDS = { minX: 10, maxX: 30, minY: -50, maxY: -20 };

function nearly(actual, expected, epsilon = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  );
}

test("viewExtent maps a 2 x 2 view square onto the shorter canvas side", () => {
  assert.deepEqual(viewExtent(400, 200), { viewWidth: 4, viewHeight: 2 });
  assert.deepEqual(viewExtent(200, 400), { viewWidth: 2, viewHeight: 4 });
  assert.deepEqual(viewExtent(300, 300), { viewWidth: 2, viewHeight: 2 });
  assert.throws(() => viewExtent(0, 300), /width must be positive/);
  assert.throws(() => viewExtent(300, Number.NaN), /height must be finite/);
});

test("calculateFitView centers the bounds and honors padding", () => {
  const width = 800;
  const height = 500;
  const padding = 25;
  const view = calculateFitView(BOUNDS, width, height, padding);

  const center = projectToCanvas(view, 20, -35, width, height);
  nearly(center.x, width / 2);
  nearly(center.y, height / 2);

  // The bounds are 20 wide by 30 tall on a 4:2.5 frame, so height is the
  // limiting side: the top and bottom edges land exactly on the padding.
  const top = projectToCanvas(view, 20, BOUNDS.maxY, width, height);
  const bottom = projectToCanvas(view, 20, BOUNDS.minY, width, height);
  nearly(top.y, padding);
  nearly(bottom.y, height - padding);

  const left = projectToCanvas(view, BOUNDS.minX, -35, width, height);
  const right = projectToCanvas(view, BOUNDS.maxX, -35, width, height);
  assert.ok(left.x > padding);
  assert.ok(right.x < width - padding);
  // Zoom is uniform, so the projected width is the projected height scaled by 20/30.
  nearly(right.x - left.x, (bottom.y - top.y) * (20 / 30), 1e-6);
});

test("calculateFitView agrees with what fit:true resolves", () => {
  const view = calculateFitView(BOUNDS, 640, 480, 12);
  const resolved = resolveFrameView(
    { fit: true, padding: 12, flipX: false, flipY: false, view: null },
    BOUNDS,
    640,
    480,
  );
  assert.deepEqual(resolved, view);
});

test("projectToCanvas puts canvas y downward and unproject inverts it", () => {
  const width = 1000;
  const height = 400;
  const view = calculateFitView(BOUNDS, width, height, 0);

  const above = projectToCanvas(view, 20, -20, width, height);
  const below = projectToCanvas(view, 20, -50, width, height);
  assert.ok(above.y < below.y, "larger world y is higher on the canvas");

  for (const [x, y] of [[10, -50], [30, -20], [17.5, -33.25], [-100, 400]]) {
    const pixel = projectToCanvas(view, x, y, width, height);
    const world = unprojectFromCanvas(view, pixel.x, pixel.y, width, height);
    nearly(world.x, x, 1e-9);
    nearly(world.y, y, 1e-9);
  }
});

test("a flipped view mirrors the projection about the frame center", () => {
  const width = 600;
  const height = 300;
  const view = calculateFitView(BOUNDS, width, height, 0);
  const flipped = resolveFrameView(
    { fit: false, flipX: true, flipY: false, view },
    null,
    width,
    height,
  );

  const plain = projectToCanvas(view, BOUNDS.minX, BOUNDS.maxY, width, height);
  const mirrored = projectToCanvas(flipped, BOUNDS.minX, BOUNDS.maxY, width, height);
  nearly(mirrored.x, width - plain.x);
  nearly(mirrored.y, plain.y);
});

test("projection rejects views and points that are not finite", () => {
  const view = { zoomX: 1, zoomY: 1, offsetX: 0, offsetY: 0 };
  assert.throws(() => projectToCanvas(null, 0, 0, 10, 10), /view must be an object/);
  assert.throws(
    () => projectToCanvas({ ...view, zoomX: "x" }, 0, 0, 10, 10),
    /view.zoomX must be finite/,
  );
  assert.throws(() => projectToCanvas(view, Number.NaN, 0, 10, 10), /x must be finite/);
  assert.throws(
    () => unprojectFromCanvas({ ...view, zoomY: 0 }, 5, 5, 10, 10),
    /zero zoom/,
  );
});
