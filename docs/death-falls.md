# Death falls

A body used to reach the floor seven frames (about a ninth of a second) after
the killing shot, and a figure drawn by the 3D model was swapped on that same
frame for the flat 2D corpse painter, already partly lying down. Deaths now
take a little under a second, timed by two falls authored in Blender, and a
model-drawn figure goes down as the model: from the pose it was last drawn in
to the same corpse it has always come to rest as.

Before (top of each pair) and after, every 4 frames at 60 Hz, real `draw()`
frames in Stick City. The last column is the same corpse in both:

![Before and after](previews/death-falls-before-after.png)

## The falls in Blender

`assets/player/player.blend` carries two actions on `PlayerRig`, keyed at the
game's 60 Hz simulation rate:

| action | what happens | floor contact | at rest |
|---|---|---|---|
| `Death_Fall_Backward` | shot from the front: recoil, knees unlock, sits back with the arms flung up, lands on the back, the head last | frame 40 | frame 54 |
| `Death_Fall_Forward` | shot from behind or running: head drops, knees buckle, kneels, topples onto the chest, legs slide out | frame 37 | frame 54 |

Each key is posed from a few body controls (pelvis position and pitch, spine,
chest, neck, arm raise, sweep and elbow) with the legs solved by two-bone IK to
authored ankle targets, and Blender's Bezier curves make the in-betweens. The
actions are ordinary F-curves and can be edited in Blender.

![The two falls from the side](../assets/player/player-falls-side.png)
![The same frames from overhead, as the game sees them](../assets/player/player-falls-top.png)

```sh
blender --background assets/player/player.blend --python tools/blender-falls.py -- --save
python3 tools/build-player3d.py
```

`tools/blender-falls.py` authors the actions (`--save` writes them into the
`.blend`), samples them every frame into `assets/player/player-falls.json`, and
renders the two contact sheets above (`--skip-renders` to leave those out).
`build-player3d.py` embeds the JSON in `game.js` as `PLAYER3D_FALLS`.

## What the game takes from Blender: timing

A corpse ends in its own rest pose (its arm and leg archetypes, its limb
springs, a hand held over the wound), so the Blender end pose is never copied.
What is exported is each part's progress along its own path, from standing (0)
to lying (1), and it may overshoot and come back:

| channel | meaning |
|---|---|
| `projected` | the pelvis-to-head distance seen from above: the 2D painters' progress (`fP`) |
| `pelvisDrop`, `pelvisTravel` | how far the pelvis has come down, and along the fall |
| `torso`, `head` | the spine and the neck rotating toward the floor (the head lags, then whips) |
| `thigh*`, `shin*` | each leg bone's turn toward its rest (a buckle runs it backward first) |
| `armSweep*`, `armRaise*`, `foreSweep*`, `foreRaise*` | each arm bone's swing out from hanging and raise toward the chest's front, in the chest's frame, as radians away from a straight interpolation (the reach and the flail) |

## Every humanoid death: the clock

`figureFallTiming()` gives a death fall its action: `FORWARD` when the body
lands face down, `BACKWARD` otherwise. `figureFallProgress()` reads
`projected` at the fall's age, so the 2D painters (every humanoid the native
painter draws, citizens and townsfolk included) collapse on the same curve.
Contact is the action's contact frame, the fall ends at its settle frame, and
the limb springs run as long. Weapon force still shoves the body further; it
does not change how long the fall takes. A punch stun keeps its own buckle,
and a death resumed from a stun or a leg injury starts at the age where the
curve reaches the progress it already had (`figureFallAgeFor()`).

## A model-drawn figure: the fall on the model

`player3DFallCapture()` copies, at death, the pose the model drew on the
previous frame (`_player3DLiveSnapshots`), for the player and for every enemy
`enemy3DLivingEligible()` lets the model draw. A figure the native painter was
drawing (stunned, leg-injured, mounted, boxing, a citizen) keeps the native
fall, and so do wall slumps, sword and blast deaths, particle-beam deaths and
bodies coming apart.

`player3DFallSkeleton()` blends that pose into the corpse rig at progress 1
(`player3DCorpseSkeleton()`, the joints the native painter and the stamp have
always drawn):

- the pelvis drops and travels by its channels;
- the torso and head turn as quaternions, slerped by `torso` and `head`, which
  also carry the turn from the living facing to the corpse's yaw;
- the legs turn bone by bone in the plane between where they were and where
  they rest;
- the arms interpolate their sweep and raise in the chest's frame and add
  Blender's departure, so whatever archetype the corpse drew, the arms reach
  and flail on the way;
- limbs pair by side: the corpse rig numbers them in its own lying frame, so on
  its back its arm 0 is the living figure's right arm;
- nothing goes below the height it rests at, or below where it started.

At frame 0 the blend is the living pose; at the settle frame it is exactly
the corpse rig. The falling body keeps the living figure's pinhole camera and,
in a cel level, casts its own shadow, which shortens to nothing as it lands.
Its weapon goes down from the hand to where the corpse's dropped weapon lies,
a hat that comes off rolls off the head to where the corpse lays it, bare
heads keep their hair, and wounds ride the falling chest and head
(`fatalWoundPoint()`).

Once it has settled, the player keeps its 3D corpse (the same pose, so there
is nothing to swap) and an enemy hands over to its native painter in a
12-frame cross-fade on the floor (`PLAYER3D_FALL_FADE`). A body is not stamped
into the ground until the hand-over is done.

The corpse frame was also corrected: a body on its back now faces the sky. The
3D corpse resolved a lying torso's frame toward the floor in both cases, so a
face-up player corpse showed the back of its head with the jetpack lying on
its chest.

## Cost

A falling model costs about what the same figure cost alive a moment earlier,
for under a second. Twelve model-drawn enemies shot on the same frame, real
`draw()` in headless Chromium on SwiftShader (the GPU emulated on the CPU, so
only the comparison means anything), median frame time:

| | alive | falling | handing over | lying |
|---|---|---|---|---|
| before | 12.2 / 13.1 ms | 8.4 / 8.6 ms | 4.8 / 4.0 ms | 4.2 / 5.1 ms |
| after | 12.9 / 13.2 ms | 12.1 / 11.5 ms | 13.5 / 14.2 ms | 4.8 / 4.3 ms |

A body that has come to rest casts no shadow while it hands over, which keeps
the cross-fade (both painters at once) to the living figures' cost.

## Checks

```sh
node tools/check-death-fall.js            # timing, start and end continuity, floor, hand-over, retirement
node tools/check-falls-and-footwork.js    # the clock (asserts the Blender curve, not the old 0.15 a frame)
node tools/check-corpse.js                # settle and freeze
node tools/check-humanoid-corpse-standard.js
node tools/check-leg-injury-corpse.js     # resumed falls
node tools/check-fatal-wounds.js
node tools/check-player3d-corpses.js
node tools/check-player3d-corpse-browser.cjs
```
