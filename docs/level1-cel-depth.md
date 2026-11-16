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
  hands Player3D the four nearest building footprints and shadow heights in
  the actor's frame. The fragment shader takes the ground point each fragment
  is drawn over, walks its ray toward the sun and shades it if the ray enters
  a box below that height -- which is exactly the region the building's shadow
  is painted on. A figure crossing a shadow edge is therefore darkened up to
  the painted edge and no further
  ([preview](previews/level1-figure-shade.png)). The cast pass runs the same
  test and drops only the part of the figure's own shadow that lands inside a
  building's. Edges ramp over about five units, centred on the painted edge.
  Figures the model does not draw use `celFigureShade()`, a whole-figure fade.
  - The test is deliberately made on the ground, not at the height of the body
    part. Heights here are not one scale: a figure casts as 21 units tall and
    a small office block is 17 to 26, so the true 3D test put a figure's head
    and shoulders above most shadows and it stood fully lit inside them.
  - `_celShadeHeight()` is the height the painted shadow is thrown from: the
    highest level running round all four sides of the roof (parapet or eave),
    found once per plan by `_celPlanEdgeHeight()`.
- **Buildings stand in storeys.** Through the generic formula nearly every
  block in the city was 17 to 26 units tall: one flat shelf, about as high as
  the figures walking past it, with shadows barely longer than theirs. In
  Level 1 `buildingRise()` now sorts block buildings into two, three and four
  storeys (`CITY_RISE_STOREY` 27 / 33 / 39, with a little jitter), capped at
  `CITY_RISE_TOP` (40) and at 28% of the footprint so a narrow building does
  not lean further than it is wide. Nothing is made lower than it was, a
  preset `_rise` is untouched and warehouses stay low. 40 through the lean is
  85 units, inside `BUILDING_GAP_MIN`, so a tall wall still cannot reach its
  neighbour. The roof kit's facade carries one row of windows per storey (up
  to four), and `CEL_SHADOW_REACH` came down from 2.3 to 2.0 so the taller
  blocks do not put a whole street in shade
  ([before / after](previews/level1-storeys-before-after.png)).
- **Walls, then the street, then roofs.** A building used to be one entry in
  the depth sort, keyed on its south edge, so it was either wholly under a
  figure or wholly over them. Somebody pressed against a south wall sorted
  after the building, and since a figure is wider than its collision circle
  their hands and gun were painted on top of the roof. Somebody beside a wall
  the lean turns toward the camera sorted before it and was cut in half by
  that wall. A wall is only drawn when it faces the camera, so a figure
  overlapping it is always in front of it; a roof is above every head, so a
  figure overlapping it is always under it. In Level 1 `drawDepthSorted()`
  therefore paints every split building's walls and facade first, then the
  ordinary sorted pass, then the roofs
  ([before / after](previews/level1-roof-order-before-after.png)).
  - `_massPart` selects the part (0 whole, 1 walls, 2 roof).
    `CityBuildings3D.draw(b, g, part, edge)` and the generic block branch of
    `drawBuildings()` are the two painters that honour it, and they set
    `_splitMass` on the records they draw, so nothing drawn by any other
    branch can be split by mistake. A building is whole on the first frame it
    is seen and split from the second.
  - Wall blood and wall corpses go down with the walls only.
  - The roof's edge line over a figure is a stroke, and strokes are the
    expensive kind of drawing: laid on every roof it added about a third to
    the pass. It is drawn only on roofs with a figure inside the reach of
    their lean (`_roofEdge`), which measured back at the old cost.
  - A figure's shadow on the wall of a split building is painted as soon as it
    is queued (`celFigureWallFlushNow()`), so it lies under the figure that
    casts it.
  - Other levels keep the one-piece order. `tools/check-depth.js` asserts the
    schedule in both.
- **Shadow colour.** Shadows use the game's original sky-derived tone
  (`celShadowRGB()`, the biome sky at about a third), not the indigo the first
  version of this pass introduced. Only their strength and shape are new.
- **Trim.** The shade lookup samples a lattice round each figure, so the
  building that shades the ground a figure's shadow lands on is found
  whichever side it is on. A wall already in another building's shadow takes
  no figure shadow.
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
