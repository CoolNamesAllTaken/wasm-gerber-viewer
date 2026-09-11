import assert from "node:assert/strict";
import test from "node:test";

import { GerberRenderer } from "../index.js";

const GERBER = "%FSLAX24Y24*%\n%MOMM*%\n%ADD10C,0.5*%\nD10*\nX0Y0D02*\nX100000Y0D01*\nM02*\n";

function makeGl(events) {
  return {
    FRAMEBUFFER: 0x8d40,
    COLOR_BUFFER_BIT: 0x4000,
    bindFramebuffer() {},
    viewport() {},
    getContextAttributes() {
      return { premultipliedAlpha: true };
    },
    clearColor(...color) {
      events.push(["clearColor", color]);
    },
    clear() {
      events.push(["clear"]);
    },
  };
}

function makeProcessor(events) {
  let nextLayerId = 0;
  const boundaries = new Map();
  return class Processor {
    init() {}
    clear() {}
    free() {}
    add_layer() {
      const id = nextLayerId;
      nextLayerId += 1;
      boundaries.set(id, { min_x: 0, max_x: 10, min_y: 0, max_y: 1 });
      return id;
    }
    get_layer_boundary(id) {
      return boundaries.get(id);
    }
    add_composite_layer_with_bounds(sourceIds, _bits, inverted, minX, maxX, minY, maxY) {
      const id = nextLayerId;
      nextLayerId += 1;
      boundaries.set(id, { min_x: minX, max_x: maxX, min_y: minY, max_y: maxY });
      events.push(["composite", Array.from(sourceIds), inverted]);
      return id;
    }
    set_composite_bounds() {}
    get_composite_error() {
      return "";
    }
    render_with_clear(_ids, _colors, _zx, _zy, _ox, _oy, _alpha, clear) {
      events.push(["render", { clear }]);
    }
    render_with_clear_and_blend_modes(_ids, _colors, _modes, _zx, _zy, _ox, _oy, _alpha, clear) {
      events.push(["render", { clear }]);
    }
  };
}

function makeRenderer(events, { convertToBlob } = {}) {
  const canvas = {
    width: 4,
    height: 2,
    getContext() {
      return makeGl(events);
    },
    async convertToBlob() {
      events.push(["convertToBlob"]);
      return convertToBlob ? convertToBlob() : new Blob(["png"], { type: "image/png" });
    },
  };
  return new GerberRenderer(
    canvas,
    { releaseContext: false },
    { GerberProcessor: makeProcessor(events) },
  );
}

test("a transparent frame still lets the processor clear the canvas", async () => {
  const events = [];
  const renderer = makeRenderer(events);

  await renderer.withFrame({ width: 4, height: 2 }, async () => {
    await renderer.renderLayer(GERBER, { color: [1, 0, 0] });
  });

  assert.deepEqual(
    events.filter(([kind]) => kind === "render"),
    [["render", { clear: true }]],
  );
  assert.equal(events.some(([kind]) => kind === "clearColor"), false);
  assert.equal(renderer.lastFrame.backgroundPainted, false);
  assert.equal(renderer.lastFrame.background, null);
});

test("a frame background is painted on the live canvas before the layers", async () => {
  const events = [];
  const renderer = makeRenderer(events);

  await renderer.withFrame(
    { width: 4, height: 2, background: "#05070c", compositeMode: "stack" },
    async () => {
      await renderer.renderLayer(GERBER, { color: [1, 0, 0] });
    },
  );

  const clearIndex = events.findIndex(([kind]) => kind === "clearColor");
  const renderIndex = events.findIndex(([kind]) => kind === "render");
  assert.ok(clearIndex >= 0, "the canvas was cleared to a color");
  assert.ok(clearIndex < renderIndex, "the background is under the layers");
  assert.deepEqual(events[clearIndex][1], [5 / 255, 7 / 255, 12 / 255, 1]);
  assert.deepEqual(events[renderIndex][1], { clear: false });
  assert.equal(renderer.lastFrame.backgroundPainted, true);
  assert.equal(renderer.lastFrame.background, "#05070c");
});

test("a translucent background is premultiplied for the drawing buffer", async () => {
  const events = [];
  const renderer = makeRenderer(events);

  await renderer.withFrame({ width: 4, height: 2, background: [1, 0, 0, 0.2] }, async () => {
    await renderer.renderLayer(GERBER);
  });

  const [, color] = events.find(([kind]) => kind === "clearColor");
  assert.deepEqual(color, [0.2, 0, 0, 0.2]);
});

test("an empty frame clears to the background too", async () => {
  const events = [];
  const renderer = makeRenderer(events);

  await renderer.withFrame({ width: 4, height: 2, background: [1 / 255, 2 / 255, 3 / 255, 1] }, async () => {});

  const [, color] = events.find(([kind]) => kind === "clearColor");
  assert.deepEqual(color, [1 / 255, 2 / 255, 3 / 255, 1]);
  assert.equal(renderer.lastFrame.backgroundPainted, true);
  assert.equal(renderer.lastFrame.view, null);
});

test("clear:false leaves a background frame alone", async () => {
  const events = [];
  const renderer = makeRenderer(events);

  await renderer.withFrame(
    { width: 4, height: 2, background: "#ffffff", clear: false },
    async () => {
      await renderer.renderLayer(GERBER);
    },
  );

  assert.equal(events.some(([kind]) => kind === "clearColor"), false);
  assert.deepEqual(events.find(([kind]) => kind === "render")[1], { clear: false });
  assert.equal(renderer.lastFrame.backgroundPainted, false);
});

test("exporting a frame that painted its background does not composite it twice", async () => {
  const events = [];
  const OriginalOffscreenCanvas = globalThis.OffscreenCanvas;
  let offscreenCreated = 0;
  globalThis.OffscreenCanvas = class {
    constructor() {
      offscreenCreated += 1;
    }
    getContext() {
      return null;
    }
  };
  try {
    const renderer = makeRenderer(events);
    await renderer.withFrame({ width: 4, height: 2, background: "#05070c" }, async () => {
      await renderer.renderLayer(GERBER);
    });

    const blob = await renderer.exportPng();
    assert.equal(blob.type, "image/png");
    assert.equal(offscreenCreated, 0, "the canvas already holds the background");
    assert.equal(events.filter(([kind]) => kind === "convertToBlob").length, 1);
  } finally {
    globalThis.OffscreenCanvas = OriginalOffscreenCanvas;
  }
});

test("renderInvertedLayer composites the layer against itself, inverted", async () => {
  const events = [];
  const renderer = makeRenderer(events);
  let id = null;

  await renderer.withFrame({ width: 4, height: 2 }, async () => {
    id = await renderer.renderInvertedLayer(
      { source: GERBER, name: "Mask" },
      { color: [0, 0.5, 0], alpha: 0.9 },
    );
  });

  assert.equal(id, 2);
  const composite = events.find(([kind]) => kind === "composite");
  assert.deepEqual(composite, ["composite", [0, 1], true]);
  const layers = renderer.lastFrame.layers;
  assert.equal(layers.length, 3);
  assert.equal(layers[2].name, "Mask (inverted)");
  assert.deepEqual(layers[2].color, [0, 0.5, 0]);
  assert.equal(layers[2].alpha, 0.9);
});

test("renderInvertedLayer refuses drills and must run inside a frame", async () => {
  const events = [];
  const renderer = makeRenderer(events);

  await assert.rejects(
    renderer.renderInvertedLayer(GERBER),
    /must be called inside withFrame/,
  );
  await assert.rejects(
    renderer.withFrame({ width: 4, height: 2 }, async () => {
      await renderer.renderInvertedLayer({ source: "M48\nT1C0.3\n%\nT1\nX0Y0\nM30\n", kind: "drill" });
    }),
    /Drill rendering requires an updated WASM renderer|ordinary Gerber layers/,
  );
});
