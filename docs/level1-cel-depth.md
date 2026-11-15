# Level 1 comic depth pass

Stick City's streets now read as inked, cel-shaded solids rather than tinted
roof decals. Geometry, footprints, collisions, placement, destruction keys and
the embedded Blender roof kit are unchanged: this pass changes how the faces
that already existed are toned, outlined and shadowed.

![before and after](previews/level1-cel-depth-before-after.png)

Morning light across a courtyard district:
[previews/level1-cel-depth-morning.png](previews/level1-cel-depth-morning.png)

## What changed

- **Cel tones.** `CityBuildings3D.draw()` snaps each face's diffuse term to
  shade / mid / lit (`celBand`, `CEL_WALL`, `CEL_ROOF`, `CEL_TRIM`). Shade leans
  cool and lit leans warm. `drawMassSides()` applies the same three bands to
  every other mass in Level 1.
- **Ink.** Each roof-kit building gets one batched silhouette stroke painted
  before its fills (the fills cover the inner half of the line), ink on wall
  corners and eaves, and a thin line on large roof planes (`f.ink`, `f.hull`).
  `drawMassSides()` strokes the wall quads it already draws.
- **Roof-shaped shadows.** `CityBuildings3D.drawShadow()` drops every roof and
  wall vertex to the ground along the sun at its own height, so ridges throw
  gables and chimneys throw notches. The path is in world space, cached per
  building, and rebuilt only when the sun moves. Other block buildings use a
  hulled shadow in the same tone and length (`CEL_SHADOW_REACH`).
- **One sun caster.** In Level 1 the 2D pass owns sun shadows even when the
  WebGL light rig is running (`celCityScene()`, `uSunCast`). The rig skips its
  shadow ray march there and keeps relief shading, specular and lamp shadows.
- **Figure shadows.** Humanoids cast a shadow of their actual pose
  ([preview](previews/level1-figure-shadows.png)):
  - Where the Blender model draws the figure, `celFigureCast3D()` sends the
    same posed snapshot through `Player3D.draw()` once more with a `cast`
    matrix that drops every vertex along the sun at its own height. The shadow
    is the model, so cover, reloads, strides and falls match by construction.
  - It is rendered at 0.4 resolution and blitted as four offset taps, which
    is the soft edge. No Canvas blur filter is used.
  - Where the shadow reaches a visible wall face, a second cast with a fold
    matrix paints it up that face, clipped to the face and flushed after the
    building is drawn (`celFigureWalls`, `celFigureWallFlush`).
  - Figures the model does not draw (prone or stunned enemies, civilians)
    fall back to `celFigureSkeleton()`, a capsule set blended across
    standing, crouch, prone and knockdown, with layered soft fills.
- **Building shadows shade figures, part by part.** `celFigureShadeBoxes()`
  hands Player3D the four nearest building footprints and roof heights in the
  actor's frame. The fragment shader walks each fragment's ray toward the sun
  and shades it only if the ray enters a box below its roof, so a figure
  crossing a shadow edge is darkened up to that edge and no further
  ([preview](previews/level1-figure-shade.png)). The cast pass runs the same
  test at the ground point and drops only the part of the figure's own shadow
  that lands inside a building's. Edges ramp over about five units. Figures the
  model does not draw use `celFigureShade()`, a whole-figure fade.
- **Colours.** The city's ground palette (`BIOMES[1].pal`) is unchanged. Roof-kit
  material colours are saturated once per building plan (`vivid`).

All of it is gated on `currentLevel === 1 && currentBiome === 1`; other levels
draw exactly as before.

## Cost

Measured in headless Chromium with software rasterisation, 900x1400, eleven
roof-kit buildings on a panning camera: the shadow plus depth-sorted mass
passes went from about 10.2 ms to about 11.5 ms median. This is one stage on
one host, not whole-game FPS, and it has not been measured on a phone. The
light rig's sun march no longer runs in Level 1, which is not included in that
figure.

## Checks

```sh
node tools/check-city3d.js
node tools/check-city3d-props.js
node tools/check-city3d-browser.cjs
node tools/check-depth.js
node tools/check-render.js
node tools/check-lighting.js
node tools/check-frame.js
node tools/visual-world.js 1 600 7800 0.8 hour=15
```

`check-city3d-browser.cjs` allows the ink band outside the height mask (its
silhouette tolerance went from 0.5% to 4% of the building's pixels).
`check-depth.js` (136/143), `check-civic-terrace.js` and
`check-city-districts.js` fail identically before and after this change.
Blender was not available in this session, so the roof kit was not re-exported;
`CITY3D_ASSET` is untouched.
