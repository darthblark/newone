"""Author the death falls on the player rig and export their timing.

    blender --background assets/player/player.blend --python tools/blender-falls.py -- [--save] [--skip-renders]

Two keyframed actions on PlayerRig, at the game's 60 Hz simulation rate:
Death_Fall_Backward (shot from the front, onto the back) and
Death_Fall_Forward (a crumple onto the knees, then onto the face). Each key is
posed by forward kinematics from a few body controls, with the legs solved by
two-bone IK to the authored ankle targets. Blender's Bezier curves make the
in-betweens; nothing in the game samples a keyframe directly.

What the game reads is the motion's TIMING, sampled every frame into
assets/player/player-falls.json. A corpse's final pose is the game's own rest
pose (its archetype, its limb springs and its wounds), so the Blender end pose
is not copied. Each channel is that part's progress from standing (0) to lying
(1) along its own path, and can overshoot when it swings past and comes back:

  pelvisDrop      how far the pelvis has come down
  pelvisTravel    how far it has travelled along the fall
  torso, head     the spine and the neck rotating toward the floor
  thigh*, shin*   each leg bone's rotation toward its end
  armSweep*, foreSweep*   each arm bone's swing outward from hanging and
  armRaise*, foreRaise*   its raise toward the chest's front, in the chest's
                  frame, as radians away from a straight interpolation along
                  `projected` (a corpse's arms end in its own archetype)
  projected       the pelvis-to-head distance seen from above: the 2D painters' f

--save stores the actions in player.blend (as editable F-curves, with a fake
user). Without --skip-renders, side and overhead contact sheets are rendered
to assets/player/player-falls-side.png and player-falls-top.png.
"""
import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector, Quaternion

ROOT = Path(bpy.path.abspath('//')).resolve().parent.parent if bpy.data.filepath else Path.cwd()
OUT = ROOT / 'assets' / 'player'
FPS = 60

# Body controls, in degrees and metres. Pitch is about the lateral (+Y) axis:
# positive tips the top forward (+X), negative backward. Arm "flex" raises the
# arm forward from hanging, "abd" out to the side, "elbow" folds the forearm.
# Ankle targets are armature-space (x, z); the knee bends toward the body's
# front. Every key is a held pose: Blender's curves supply the motion.
BACKWARD = [
    # frame pelvis(x,z)    pitch spine chest neck head   ankle(x,z)    arm L (flex,abd,elbow)  arm R
    (0,  (0.00, 0.92),    0,    0,   0,   0,   0,  (0.00, 0.12), (4, 6, 8),     (4, 6, 8)),
    (6,  (0.04, 0.91),   -5,   -9,  -7,  15,   6,  (0.00, 0.12), (20, 12, 26),  (27, 10, 30)),
    (14, (0.01, 0.84),  -15,   -8,  -4,  19,   6,  (0.03, 0.12), (40, 24, 34),  (47, 21, 40)),
    (22, (-0.11, 0.65), -33,   -6,  -4,  23,   6,  (0.08, 0.12), (62, 36, 40),  (69, 33, 44)),
    (28, (-0.25, 0.38), -55,   -4,  -2,  27,   6,  (0.15, 0.11), (76, 48, 38),  (83, 44, 42)),
    (32, (-0.33, 0.15), -72,    0,   0,  31,   5,  (0.23, 0.10), (80, 58, 30),  (86, 53, 34)),
    (36, (-0.36, 0.13), -88,    0,   0,  33,   2,  (0.33, 0.09), (58, 68, 22),  (64, 64, 26)),
    (40, (-0.37, 0.13), -90,    0,   0,   7,   0,  (0.42, 0.08), (16, 74, 16),  (22, 71, 18)),
    (45, (-0.37, 0.14), -86,    0,   0,   3,   0,  (0.46, 0.08), (-8, 78, 14),  (-5, 75, 15)),
    (54, (-0.37, 0.13), -90,    0,   0,   4,   0,  (0.48, 0.08), (-14, 79, 12),  (-12, 76, 12)),
]
FORWARD = [
    (0,  (0.00, 0.92),    0,    0,   0,   0,   0,  (0.00, 0.12), (4, 6, 8),     (4, 6, 8)),
    (5,  (-0.02, 0.91),   4,   10,   6,  22,   4,  (0.00, 0.12), (6, 8, 22),    (8, 7, 24)),
    (12, (0.00, 0.81),    8,   14,   8,  26,   4,  (-0.03, 0.13), (14, 10, 26), (17, 9, 28)),
    (19, (0.04, 0.63),   14,   16,  10,  28,   4,  (-0.12, 0.17), (26, 12, 30), (30, 11, 32)),
    (24, (0.09, 0.50),   22,   18,  10,  26,   4,  (-0.32, 0.08), (40, 15, 22), (44, 14, 24)),
    (30, (0.23, 0.38),   55,   14,   8,  22,   2,  (-0.32, 0.08), (34, 26, 14), (38, 24, 14)),
    (34, (0.37, 0.24),   78,    8,   4,  14,   2,  (-0.41, 0.08), (14, 44, 10), (16, 42, 10)),
    (37, (0.46, 0.16),   90,    0,   0,   9,   0,  (-0.34, 0.08), (4, 60, 8),   (6, 58, 8)),
    (41, (0.52, 0.14),   90,    0,   0,   1,   0,  (-0.29, 0.08), (5, 70, 8),   (7, 68, 8)),
    (46, (0.53, 0.15),   87,    0,   0,   0,   0,  (-0.28, 0.08), (6, 76, 8),   (8, 74, 8)),
    (54, (0.54, 0.14),   90,    0,   0,   0,   0,  (-0.27, 0.08), (5, 79, 8),   (6, 77, 8)),
]
ACTIONS = {'BACKWARD': ('Death_Fall_Backward', BACKWARD), 'FORWARD': ('Death_Fall_Forward', FORWARD)}


def RY(deg):
    return Matrix.Rotation(math.radians(deg), 3, 'Y')


def RX(deg):
    return Matrix.Rotation(math.radians(deg), 3, 'X')


def rest(rig, name):
    bone = rig.data.bones[name]
    return bone.matrix_local.to_3x3(), bone.head_local.copy(), bone.tail_local.copy()


def world_pose(rig, key):
    """Armature-space rotation of every bone, plus the pelvis translation."""
    _, (px, pz), pitch, spine, chest, neck, head, (ax, az), arm_l, arm_r = key
    W = {'root': Matrix.Identity(3)}
    W['pelvis'] = RY(pitch)
    W['spine'] = W['pelvis'] @ RY(spine)
    W['chest'] = W['spine'] @ RY(chest)
    W['neck'] = W['chest'] @ RY(neck)
    W['head'] = W['neck'] @ RY(head)
    for side, sign, (flex, abd, elbow) in (('L', 1, arm_l), ('R', -1, arm_r)):
        W[f'upper_arm.{side}'] = W['chest'] @ RX(sign * abd) @ RY(-flex)
        W[f'forearm.{side}'] = W[f'upper_arm.{side}'] @ RY(-elbow)
        W[f'hand.{side}'] = W[f'forearm.{side}']
    _, pelvis_head, _ = rest(rig, 'pelvis')
    translation = Vector((px, 0, pz)) - pelvis_head
    front = W['pelvis'] @ Vector((1, 0, 0))
    for side in ('L', 'R'):
        _, hip_rest, _ = rest(rig, f'thigh.{side}')
        _, knee_rest, _ = rest(rig, f'shin.{side}')
        _, ankle_rest, _ = rest(rig, f'foot.{side}')
        hip = pelvis_head + translation + W['pelvis'] @ (hip_rest - pelvis_head)
        l1 = (knee_rest - hip_rest).length
        l2 = (ankle_rest - knee_rest).length
        target = Vector((ax, hip.y, az))
        to = target - hip
        d = max(abs(l1 - l2) + 1e-3, min(l1 + l2 - 1e-4, to.length))
        axis = to.normalized()
        along = (l1 * l1 - l2 * l2 + d * d) / (2 * d)
        height = math.sqrt(max(0.0, l1 * l1 - along * along))
        # The bend lies in the sagittal plane, on the body's front side.
        bend = Vector((-axis.z, 0, axis.x))
        if bend.dot(front) < 0:
            bend = -bend
        knee = hip + axis * along + bend * height
        ankle = hip + axis * d
        rest_thigh = (knee_rest - hip_rest).normalized()
        rest_shin = (ankle_rest - knee_rest).normalized()
        W[f'thigh.{side}'] = rest_thigh.rotation_difference((knee - hip).normalized()).to_matrix()
        W[f'shin.{side}'] = rest_shin.rotation_difference((ankle - knee).normalized()).to_matrix()
        # The foot rides the shin and points its toes as the shin goes down:
        # back along it once it lies on the floor face down (the top of the
        # foot on the ground), only a little on the back (toes up).
        shin_down = math.degrees(math.acos(max(-1.0, min(1.0, -(ankle - knee).normalized().z)))) / 90
        W[f'foot.{side}'] = W[f'shin.{side}'] @ RY((80 if pitch > 0 else 20) * min(1.0, shin_down) ** 1.5)
    return W, translation


def apply_pose(rig, key):
    W, translation = world_pose(rig, key)
    for pb in rig.pose.bones:
        R, _, _ = rest(rig, pb.name)
        parent = pb.parent.name if pb.parent else None
        delta = (W[parent].inverted() @ W[pb.name]) if parent else W[pb.name]
        basis = (R.inverted() @ delta @ R).to_quaternion()
        if pb.rotation_mode == 'QUATERNION':
            pb.rotation_quaternion = basis
        else:
            pb.rotation_euler = basis.to_euler(pb.rotation_mode)
        pb.location = (R.inverted() @ translation) if pb.name == 'pelvis' else Vector((0, 0, 0))


def author(rig, name, keys):
    action = bpy.data.actions.get(name) or bpy.data.actions.new(name)
    action.fcurves.clear()
    action.use_fake_user = True
    action['gameFps'] = FPS
    action['contract'] = 'Timing only: tools/blender-falls.py exports per-part progress to player-falls.json'
    rig.animation_data_create()
    rig.animation_data.action = action
    for key in keys:
        frame = key[0]
        apply_pose(rig, key)
        for pb in rig.pose.bones:
            path = 'rotation_quaternion' if pb.rotation_mode == 'QUATERNION' else 'rotation_euler'
            pb.keyframe_insert(data_path=path, frame=frame, group=pb.name)
            if pb.name == 'pelvis':
                pb.keyframe_insert(data_path='location', frame=frame, group=pb.name)
    for curve in action.fcurves:
        for point in curve.keyframe_points:
            point.interpolation = 'BEZIER'
            point.handle_left_type = point.handle_right_type = 'AUTO_CLAMPED'
        curve.update()
    action.frame_range = (keys[0][0], keys[-1][0])
    return action


def landmarks(rig):
    pb = rig.pose.bones
    head = pb['head']
    out = {'pelvis': pb['pelvis'].head.copy(), 'neck': pb['neck'].head.copy(),
           'head': head.head + (head.tail - head.head) * .5}
    # A bone's rest +Y runs along it, its rest +X is the body's forward and
    # its rest -Z is the body's left (+Y in the armature).
    chest = pb['chest'].matrix.to_3x3()
    out['front'], out['up'], out['left'] = chest @ Vector((1, 0, 0)), chest @ Vector((0, 1, 0)), chest @ Vector((0, 0, -1))
    for side in ('L', 'R'):
        out['shoulder' + side] = pb[f'upper_arm.{side}'].head.copy()
        out['elbow' + side] = pb[f'forearm.{side}'].head.copy()
        out['wrist' + side] = pb[f'hand.{side}'].head.copy()
        out['hip' + side] = pb[f'thigh.{side}'].head.copy()
        out['knee' + side] = pb[f'shin.{side}'].head.copy()
        out['ankle' + side] = pb[f'foot.{side}'].head.copy()
        out['toe' + side] = pb[f'foot.{side}'].tail.copy()
    return out


def plane_progress(d0, dT, d):
    """Signed rotation of d from d0, as a fraction of d0's turn to dT, in their plane."""
    d0, dT, d = d0.normalized(), dT.normalized(), d.normalized()
    total = math.acos(max(-1.0, min(1.0, d0.dot(dT))))
    if total < 1e-4:
        return 1.0, Vector((0, 0, 0))
    normal = d0.cross(dT).normalized()
    angle = math.atan2(normal.dot(d0.cross(d)), d0.dot(d))
    return angle / total, normal


def sample(rig, action, keys):
    rig.animation_data.action = action
    scene = bpy.context.scene
    first, last = keys[0][0], keys[-1][0]
    frames = []
    for f in range(first, last + 1):
        scene.frame_set(f)
        bpy.context.view_layer.update()
        frames.append(landmarks(rig))
    return frames


def channels(frames, direction):
    a, z = frames[0], frames[-1]
    ch = {}
    drop0, drop1 = a['pelvis'].z, z['pelvis'].z
    ch['pelvisDrop'] = [(drop0 - f['pelvis'].z) / (drop0 - drop1) for f in frames]
    travel = z['pelvis'].x - a['pelvis'].x
    ch['pelvisTravel'] = [(f['pelvis'].x - a['pelvis'].x) / travel for f in frames]

    def seg(name, p, q):
        d0, dT = a[q] - a[p], z[q] - z[p]
        ch[name] = [plane_progress(d0, dT, f[q] - f[p])[0] for f in frames]

    seg('torso', 'pelvis', 'neck')
    seg('head', 'neck', 'head')
    for side in ('L', 'R'):
        seg('thigh' + side, 'hip' + side, 'knee' + side)
        seg('shin' + side, 'knee' + side, 'ankle' + side)

    def flat(v):
        return math.hypot(v.x, v.y)
    p0, p1 = flat(a['head'] - a['pelvis']), flat(z['head'] - z['pelvis'])
    best, projected = 0.0, []
    for f in frames:
        best = max(best, min(1.0, (flat(f['head'] - f['pelvis']) - p0) / (p1 - p0)))
        projected.append(best)
    contact = next(i for i, v in enumerate(projected) if v >= .995)
    projected = [1.0 if i >= contact else v for i, v in enumerate(projected)]
    ch['projected'] = projected
    for side in ('L', 'R'):
        # Arms are measured in the chest's own frame, as two angles: a sweep
        # outward from hanging and a raise toward the chest's front. A
        # corpse's arms end in whichever archetype it drew, so these are not
        # progress: each is the motion's departure, in radians, from a
        # straight interpolation along `projected`. The game adds it to its
        # own interpolation from the living arm to the corpse's arm.
        out = 1 if side == 'L' else -1
        for bone, (p, q) in (('arm', ('shoulder', 'elbow')), ('fore', ('elbow', 'wrist'))):
            sweep, raise_ = [], []
            for f in frames:
                u = (f[q + side] - f[p + side]).normalized()
                raise_.append(math.asin(max(-1.0, min(1.0, u.dot(f['front'])))))
                ang = math.atan2(out * u.dot(f['left']), -u.dot(f['up']))
                if sweep and abs(ang - sweep[-1]) > math.pi:
                    ang -= math.copysign(2 * math.pi, ang - sweep[-1])
                sweep.append(ang)
            # Pointing almost straight out of the chest, a bone has no sweep
            # to speak of. Bridge those frames from their well-defined
            # neighbours rather than export the noise of a pole.
            defined = [abs(r) < 1.2 for r in raise_]
            for i, ok in enumerate(defined):
                if ok:
                    continue
                lo = max(j for j in range(i + 1) if defined[j])
                hi = min(j for j in range(i, len(sweep)) if defined[j])
                sweep[i] = sweep[lo] + (sweep[hi] - sweep[lo]) * (i - lo) / (hi - lo)
            for name, vals in (('Sweep', sweep), ('Raise', raise_)):
                v0, v1 = vals[0], vals[-1]
                ch[bone + name + side] = [v - (v0 + (v1 - v0) * e) for v, e in zip(vals, projected)]
    floor = min(f[k].z for f in frames for k in ('head', 'pelvis', 'kneeL', 'kneeR', 'ankleL', 'ankleR', 'wristL', 'wristR'))
    return {k: [round(v, 4) for v in vals] for k, vals in ch.items()}, contact, floor


def render_sheets(rig, results):
    """Side and overhead contact sheets, one row per action."""
    scene = bpy.context.scene
    # Everything changed here is put back, so --save leaves the scene as it was.
    saved = (scene.render.engine, scene.eevee.taa_render_samples, scene.render.film_transparent,
             scene.render.resolution_x, scene.render.resolution_y, scene.render.filepath, scene.camera)
    # The rig's own cel materials and presentation lights, as in the player
    # previews; the floor is a flat grey card under the fall.
    scene.render.engine = 'BLENDER_EEVEE_NEXT'
    scene.eevee.taa_render_samples = 8
    scene.render.film_transparent = False
    scene.render.resolution_x, scene.render.resolution_y = 320, 320
    cam_data = bpy.data.cameras.new('FallSheetCamera')
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = 2.6
    cam = bpy.data.objects.new('FallSheetCamera', cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    floor_mesh = bpy.data.meshes.new('FallSheetFloor')
    floor_mesh.from_pydata([(-3, -3, 0), (3, -3, 0), (3, 3, 0), (-3, 3, 0)], [], [(0, 1, 2, 3)])
    floor = bpy.data.objects.new('FallSheetFloor', floor_mesh)
    card = bpy.data.materials.new('FallSheetFloor')
    card.diffuse_color = (.42, .43, .45, 1)
    floor.data.materials.append(card)
    scene.collection.objects.link(floor)
    tiles = {}
    tmp = Path(bpy.app.tempdir or '/tmp')
    for view in ('side', 'top'):
        for kind, (name, keys, picks) in results.items():
            for i, frame in enumerate(picks):
                rig.animation_data.action = bpy.data.actions[name]
                scene.frame_set(frame)
                centre = .55 if kind == 'FORWARD' else -.3
                if view == 'side':
                    cam.location, cam.rotation_euler = (centre, -4.0, .9), (math.radians(90), 0, 0)
                else:
                    cam.location, cam.rotation_euler = (centre, 0, 5), (0, 0, 0)
                path = tmp / f'fall_{view}_{kind}_{i}.png'
                scene.render.filepath = str(path)
                bpy.ops.render.render(write_still=True)
                tiles[(view, kind, i)] = path
    (scene.render.engine, scene.eevee.taa_render_samples, scene.render.film_transparent,
     scene.render.resolution_x, scene.render.resolution_y, scene.render.filepath, scene.camera) = saved
    bpy.data.objects.remove(cam)
    bpy.data.objects.remove(floor)
    bpy.data.materials.remove(card)
    bpy.data.cameras.remove(cam_data)
    bpy.data.meshes.remove(floor_mesh)
    for view in ('side', 'top'):
        rows = list(results)
        cols = max(len(results[k][2]) for k in rows)
        sheet = bpy.data.images.new(f'fall_sheet_{view}', 320 * cols, 320 * len(rows))
        pixels = [0.0] * (320 * cols * 320 * len(rows) * 4)
        for r, kind in enumerate(reversed(rows)):
            for c in range(len(results[kind][2])):
                img = bpy.data.images.load(str(tiles[(view, kind, c)]))
                src = list(img.pixels)
                for y in range(320):
                    row0 = ((r * 320 + y) * 320 * cols + c * 320) * 4
                    pixels[row0:row0 + 320 * 4] = src[y * 320 * 4:(y + 1) * 320 * 4]
                bpy.data.images.remove(img)
        sheet.pixels = pixels
        sheet.filepath_raw = str(OUT / f'player-falls-{view}.png')
        sheet.file_format = 'PNG'
        sheet.save()
        bpy.data.images.remove(sheet)


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument('--save', action='store_true')
    parser.add_argument('--skip-renders', action='store_true')
    args = parser.parse_args(argv)
    rig = bpy.data.objects.get('PlayerRig')
    if not rig:
        raise RuntimeError('Open assets/player/player.blend: PlayerRig is missing')
    previous = rig.animation_data.action if rig.animation_data else None
    data = {'schemaVersion': 1, 'fps': FPS,
            'source': 'assets/player/player.blend: Death_Fall_Backward, Death_Fall_Forward (tools/blender-falls.py)',
            'falls': {}}
    results = {}
    for kind, (name, keys) in ACTIONS.items():
        action = author(rig, name, keys)
        frames = sample(rig, action, keys)
        ch, contact, floor = channels(frames, kind)
        settle = keys[-1][0]
        data['falls'][kind] = {'action': name, 'frames': len(frames), 'contact': contact, 'settle': settle,
                               'channels': ch}
        print(f'FALL {kind}: {len(frames)} frames, contact {contact}, settle {settle}, lowest landmark z {floor:.3f}')
        results[kind] = (name, keys, [0, 8, 16, 24, contact - 4, contact + 4, settle])
    (OUT / 'player-falls.json').write_text(json.dumps(data, separators=(',', ':')) + '\n')
    if not args.skip_renders:
        render_sheets(rig, results)
    # Back to the rest pose under the idle preview: a bone that action does not
    # key would otherwise keep the last fall frame sampled, and save lying down.
    if rig.animation_data:
        rig.animation_data.action = previous
    for pb in rig.pose.bones:
        pb.location = (0, 0, 0)
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.rotation_euler = (0, 0, 0)
        pb.scale = (1, 1, 1)
    bpy.context.scene.frame_set(1)
    if args.save:
        bpy.context.preferences.filepaths.save_version = 0
        bpy.ops.wm.save_mainfile()
    print('PLAYER_FALLS_READY', str(OUT / 'player-falls.json'))


if __name__ == '__main__':
    main()
