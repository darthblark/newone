# City civilian Blender rollout

This first, bounded pass converts **CITY_CITIZEN_M** only. It uses the existing
player/human animation rig, camera projection, lighting, and Claude's Level 1
model shadows. Other NPC families can follow in separate passes.

The family keeps its seeded skin, hair, shirt and trouser colors, four clothing
styles (shirt, vest, tie, stripes), and seven hairstyles. Blender-authored cloth
details use the exact torso transform; open hair caps use the spherical head's
transform. Each civilian adds two mesh parts. Hair is at most 592 triangles;
clothing details are small shared meshes. There is no new renderer or context.

Only living, standing, unarmed city men opt in. Injured, prone, crouching,
stunned, mounted, boxing and dead characters retain their existing painters.
Rendering does not change allegiance, civilian behavior or weapon state, and
disabling/unavailable WebGL retains the native painter.

The 37 previous meshes and original runtime palette are preserved exactly.
Claude's embedded renderer changes were also synchronized into their three
source modules so later asset builds preserve the new building/shadow work.

## Assets and rebuilding

- Editable source: `assets/player/player.blend`, collection **City civilian variants**.
- Portable example: `assets/player/city-citizen-m.glb` (vest and cropped hair).
- Runtime library: `assets/player/player-mesh.json`, embedded in `game.js` for SPCK.
- Preview: [native / Blender comparison](civilian3d-preview.png).

Append or refresh this family after building the base player asset:

```sh
blender --background assets/player/player.blend --python tools/blender-city-citizen.py
python3 tools/build-player3d.py
```

The append tool updates only its own meshes, retains other source objects and
preserves the previous runtime geometry. A factory rebuild of the base player
must be followed by this append step.

## Validation

`node tools/check-npc3d-browser.cjs` exercises actual p5/Chromium WebGL rendering:
four outfits, seven hairstyles, camera angles, visible outfit differences,
one body submission per actor, Level 1 model shadows, pose/state purity,
native exclusions and renderer-disable fallback. It reports no GPU errors.
The saved report is [civilian3d-validation.json](civilian3d-validation.json).

Existing player checks (389) and enemy dispatch checks (348) pass. All three
embedded renderer source checks pass. Headless Chromium checks correctness;
Android/SPCK performance still needs device observation.
