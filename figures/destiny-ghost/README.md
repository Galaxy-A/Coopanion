<!-- Owner: figure.js#createGhostBody, figure.json. -->
# Ghost figure

Coopanion manifest 2 / figure API 2 pack. Figure ID: `destiny-ghost`.

The adapter uses the existing v9 static atlas without editing its pixels:
1536 x 2288, 8 columns, 11 rows, 192 x 208 per cell.

## Import

The public repository includes the adapter code and manifest, but no pixel atlas.
Provide a properly licensed `spritesheet.png` locally in this directory before use.

The project launcher supplies the parent `figures` directory through
`COOPANION_PACK_ROOTS`, so this figure is discovered without copying it into an
existing installation. For another Coopanion installation, import this directory
from its Dress up page.

`createGhostBody(base, options)` implements the published API 2 figure contract:
`step`, `layout`, `do`, `resize`, `walk`, `stopWalk`, `move`, `pointer`, `drop`,
`place`, `shift`, `set`, `cue`, `talk`, `setScheme`, `words`, `z`, and `dispose`.
The extra `snapshot` method provides local animation diagnostics.

The host advances `step(dt, draw)` in seconds. Hidden windows continue advancing
animation but do not change DOM styling until drawing resumes. The figure
creates no independent animation loop.

`layout()` reports stage coordinates for the bounding box, circular hit target,
bubble anchor, and side controls. Pointer dragging changes the hover position.
Movement to a host target emits `arrived` / `interrupted` with the host's walk ID.

## Actions

| Word | Atlas row | Behavior |
| --- | --- | --- |
| `idle` | 0 | Native six-frame, 6.6 second idle loop |
| `move` | 1 / 2 | A short right / left drift |
| `greet` | 3 | Three native greeting cycles |
| `jump` | 4 | Three native bobbing cycles |
| `error` | 5 | Three native confused cycles |
| `wait` | 6 | Three native waiting cycles |
| `scan` | 7 | Three complete 820 ms opening / scan / closing cycles |
| `inspect` | 8 | Three native inspection cycles |
| `look` | 9 / 10 | Sixteen pointer directions; holds until another action |

The host's `thinking` / nonempty `status` selects continuous scanning;
`listening` selects continuous waiting. These ambient loops end when the host
clears its state. A model's explicit `scan` is finite rather than an endless
beam. It returns to idle, or to an ambient host state that is still active.

These states are forwarded by Coopanion v0.2.19's `web/pet-app.js` through
`body-host.js` and `figure-frame.js`. The host's actual `cue` values `cheer`,
`heard`, and `perk` select greeting or inspection; character reveal calls
`talk()` without arguments. Request failures are not guaranteed to produce an
`error` cue; the error action is available for the model or caller explicitly.

The original Codex `pet.json` format is not changed by this pack.

## Rights

Adapter code: SPDX-License-Identifier `AGPL-3.0-or-later`.

The code license does not grant rights to the pixel artwork or Destiny
characters. Pixel reference: lascap / @pixearl1. Destiny / Ghost character
rights belong to Bungie and the respective rights holders.

The source artwork pages do not declare a reuse license. This local pack is
for the user's private desktop use; do not publish or redistribute the atlas
without the appropriate permission.

Source record preserved from the existing PET project:

- https://forum.makecode.com/t/need-some-help-with-a-game/13172
- https://www.reddit.com/r/PixelArt/comments/d156u2/i_did_the_ghost_from_destiny_any_criticism_is/
- Existing atlas SHA256:
  `6f2b739a8d1160514b810e9fbcc973316c681ace232d872cfb1f7e8bbd807e34`
