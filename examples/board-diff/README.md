# Board diff demo

`index.html` renders two revisions of a board with `wasm-gerber-renderer/board`
and compares them layer by layer with `wasm-gerber-renderer/diff`. Serve the
repository root and open `/examples/board-diff/`:

```bash
npm run build:wasm --prefix packages/wasm-gerber-renderer   # or put a release build in wasm/pkg/
node scripts/static-server.mjs                              # http://127.0.0.1:4173/examples/board-diff/
```

## The data

`base/` and `head/` are Gerber and Excellon exports of the `pic_programmer`
demo project that ships with KiCad 10.0.6 (`share/kicad/demos/pic_programmer`),
made with `kicad-cli pcb export gerbers` and `kicad-cli pcb export drill
--excellon-separate-th`. The demo is KiCad's; see the KiCad project for its
license terms.

`head/` was exported after three edits to the board file:

- mounting hole P101 moved from (77.47, 135.89) to (80.47, 133.89) mm;
- the first two F.Cu and first four B.Cu track segments deleted;
- the F.Cu track from (141.986, 87.63) to (145.1, 90.744) widened from 0.8 to 1.5 mm.

The two Edge_Cuts files, like the B_Silkscreen ones, differ only in their
creation timestamps, which the diff reports as identical geometry without
rendering them.
