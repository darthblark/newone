#!/usr/bin/env python3
"""Append the three street wardrobes to the existing rig and compact mesh library.

blender --background assets/player/player.blend --python-exit-code 1 --python tools/blender-city-street.py
For a fresh library build, run blender-player.py and blender-city-citizen.py first.
"""
import json
import math
from pathlib import Path
import runpy
from tempfile import TemporaryDirectory

import bpy
from mathutils.bvhtree import BVHTree

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/player'
base = runpy.run_path(str(ROOT / 'tools/blender-player.py'))
Geometry = base['Geometry']
rig = bpy.data.objects['PlayerRig']
library = bpy.data.collections['Runtime mesh library']
source = base['SOURCE']
meshes = base['LIBRARY']
runtime = json.loads((OUT / 'player-mesh.json').read_text())
manifest = json.loads((OUT / 'manifest.json').read_text())
base['PALETTE'].update(runtime['palette'])
base['MATERIALS'].update({name: bpy.data.materials[name] for name in runtime['palette']})
meshes.update({obj.name: obj for obj in library.objects if obj.type == 'MESH'})
source.extend(obj for obj in bpy.data.objects if obj.type == 'MESH' and 'semantic' in obj)

# Use the original torso vertices as pattern stations. The flat crown and four
# sloping sections all matter from the overhead camera. Station 0 is the chest
# front, 4 the left side, 8 the back, and 12 the right side.
body = meshes['torso'].data
stations = [tuple(v.co) for v in body.vertices]
heights = [stations[i][2] for i in range(0, len(stations), 16)]
roof = BVHTree.FromPolygons(stations, [list(p.vertices) for p in body.polygons])
assert len(heights) == 5 and heights == sorted(heights)


def surface(station, height, lift=.025):
    ring = next(i for i, z in enumerate(heights[1:]) if height <= z)
    h = (height - heights[ring]) / (heights[ring + 1] - heights[ring])
    index = math.floor(station)
    t = station - index
    xy = []
    for axis in (0, 1):
        cross_sections = []
        for level in (ring, ring + 1):
            a = stations[16 * level + index % 16][axis]
            b = stations[16 * level + (index + 1) % 16][axis]
            cross_sections.append(a + (b - a) * t)
        a, b = cross_sections
        xy.append((a + (b - a) * h) * (1 + lift))
    return *xy, height + lift * .6


def cuts(lo, hi, breaks):
    return [lo, *(v for v in breaks if lo < v < hi), hi]


def grid(g, rows, material):
    n = len(rows[0])
    faces = [(i, i + 1, i + n + 1, i + n)
             for row in range(len(rows) - 1) for i in range(row * n, (row + 1) * n - 1)]
    g.add([v for row in rows for v in row], faces, material)


def patch(g, left, right, bottom, top, material, lift=.025):
    angles = cuts(left, right, range(math.ceil(left), math.ceil(right)))
    zs = cuts(bottom, top, heights)
    grid(g, [[surface(a, z, lift) for a in angles] for z in zs], material)


def crown(g, left, right, inner_radius, material, lift=.025):
    angles = cuts(left, right, range(math.ceil(left), math.ceil(right)))
    ring = [surface(a, 1, lift) for a in angles]
    inner = [(x * inner_radius, y * inner_radius, z) for x, y, z in ring]
    grid(g, [ring, inner], material)


def blouse():
    g = Geometry()
    angles = range(17)
    # A shallow V-shaped front yoke and a curved back echo each other when
    # the NPC turns. The ivory piping follows the entire shoulder line.
    hem = [.29 + .24 * abs(math.sin(a * math.pi / 8)) for a in angles]
    rows = [[surface(a, z, .036) for a, z in zip(angles, zs)]
            for zs in (hem, [z+.075 for z in hem], [.72] * 17, [1] * 17)]
    grid(g, rows[1:], 'shirt')
    grid(g, rows[:2], 'white')
    crown(g, 0, 16, .60, 'shirt', .036)
    ring = [surface(a, 1, .036) for a in angles]
    grid(g, [[(x * r, y * r, z) for x, y, z in ring] for r in (.60, .48)], 'white')
    return g


def work_vest():
    g = Geometry()
    # A narrow opening reveals the underneath shirt from neck to hem. The
    # pockets and their flaps sit on the forward slopes of both shoulders.
    patch(g, .40, 15.60, -.82, 1, 'armor')
    crown(g, .40, 15.60, .60, 'armor')
    for left, right in ((.63, 2.47), (13.53, 15.37)):
        angles = cuts(left, right, range(math.ceil(left), math.ceil(right)))
        bottom = [.18 if a in (left, right) else .08 for a in angles]
        grid(g, [[surface(a, z, .085) for a, z in zip(angles, zs)]
                 for zs in (bottom, [.25] * len(angles), [.61] * len(angles))], 'shirt')
        flap = [.56 if a in (left, right) else .46 for a in angles]
        grid(g, [[surface(a, z, .115) for a, z in zip(angles, zs)]
                 for zs in (flap, [.72] * len(angles))], 'khaki')
    return g


def tracksuit():
    g = Geometry()
    patch(g, 0, 16, -.81, 1, 'shirt')
    crown(g, 0, 16, .44, 'shirt')
    # Follow the shoulder roof from front to back at fixed lateral stations.
    # The tapes turn down the front/back side panels and meet the waistband.
    for side in (1, -1):
        edges = (1.62, 2.40) if side == 1 else (-2.40, -1.62)
        for a, b in (edges, (8 - edges[1], 8 - edges[0])):
            patch(g, a, b, -.73, .72, 'gold', .055)
        rows = []
        for edge in edges:
            x, y, _ = surface(edge, .72, 0)
            row = []
            for i in range(13):
                xx = x * (i / 6 - 1)
                hit = roof.ray_cast((xx, y, 2), (0, 0, -1))[0]
                row.append((xx * 1.055, y * 1.055, hit.z + .049))
            rows.append(row)
        grid(g, rows, 'gold')
    patch(g, 0, 16, -.81, -.70, 'gold', .055)
    return g


def nape():
    g = Geometry()
    # Two tapered locks blend under the existing open scalp. Their rear tips
    # separate slightly and expose the nape at the center.
    for side in (-1, 1):
        profile = [(-1.70,.46,-.43,.12,.10), (-1.54,.53,-.37,.29,.25),
                   (-1.07,.61,-.23,.34,.36), (-.74,.64,-.02,.30,.36),
                   (-.38,.65,.04,.16,.22)]
        strand = Geometry().loft([(x, ry, rz) for x, _, _, ry, rz in profile],
                                 'wood', sides=8)
        vertices = [(x, y + side * profile[i // 8][1], z + profile[i // 8][2])
                    for i, (x, y, z) in enumerate(strand.vertices)]
        g.add(vertices, strand.faces, 'wood', True)
    return g


def phone():
    g = Geometry()
    def corners(x, low, high, radius, z):
        return [(x-radius,low,z), (x,low+radius,z), (x,high-radius,z), (x-radius,high,z),
                (-x+radius,high,z), (-x,high-radius,z), (-x,low+radius,z), (-x+radius,low,z)]
    bottom = corners(.29, -.75, .25, .07, -.07)
    top = corners(.29, -.75, .25, .07, .065)
    g.add(bottom+top, [tuple(reversed(range(8))), tuple(range(8,16)),
                      *((i,(i+1)%8,(i+1)%8+8,i+8) for i in range(8))], 'ink')
    g.add(corners(.235, -.67, .12, .045, .071), [tuple(range(8))], 'glass')
    return g


def cigarette():
    g = Geometry()
    # Share junctions between paper, filter and ember. Only the two free ends
    # need caps, keeping this near-pixel-sized prop cheap.
    xs = [-.10, .18, .82, .90]
    verts = [(x, .10 * math.cos(i * math.tau / 6), .10 * math.sin(i * math.tau / 6))
             for x in xs for i in range(6)]
    for j, mat in enumerate(('wood', 'white', 'gold')):
        faces = [(i, (i+1)%6, (i+1)%6+6, i+6) for i in range(6)]
        if j == 0: faces.append(tuple(reversed(range(6))))
        if j == 2: faces.append(tuple(range(6,12)))
        g.add(verts[6*j:6*(j+2)], faces, mat)
    return g


collection = bpy.data.collections.get('City street wardrobe')
if collection is None:
    collection = bpy.data.collections.new('City street wardrobe')
    bpy.context.scene.collection.children.link(collection)
torso = next(obj for obj in source if obj['semantic'] == 'torso')
head = next(obj for obj in source if obj['semantic'] == 'head')
attachments = {
    'city_blouse': (blouse, torso), 'city_work_vest': (work_vest, torso),
    'city_tracksuit': (tracksuit, torso), 'city_nape': (nape, head),
    'city_phone': (phone, None), 'city_cigarette': (cigarette, None),
}
for name, (make_geometry, mount) in attachments.items():
    # Append once, keeping the editable mesh on subsequent exports. The source
    # wardrobe can then be tailored further in Blender without regeneration.
    if name in meshes:
        continue
    obj = base['mesh_object'](name, make_geometry(), library)
    obj.hide_render = obj.hide_viewport = True
    meshes[name] = obj
    if mount:
        part = base['source_part']('Street ' + name, name, mount.location, mount.scale,
                                   bone=mount['bone'], visible=False, collection=collection)
        part.matrix_basis = mount.matrix_basis.copy()
    else:
        is_phone = name == 'city_phone'
        scale = .14 if is_phone else .10
        pos = (.084, -.454, .790) if is_phone else (.105, -.404, .755)
        obj['runtimeSockets'] = json.dumps({'grip': [0,0,0]})
        part = base['source_part']('Street ' + name, name, pos, (scale,)*3,
                                   bone='hand.R', visible=False, collection=collection)
        if is_phone:
            part.rotation_euler.x = math.pi / 2
    group = part.vertex_groups.new(name=part['bone'])
    group.add(list(range(len(part.data.vertices))), 1.0, 'REPLACE')
    part.parent = rig
    part.modifiers.new('Player skin', 'ARMATURE').object = rig

# The existing exporter validates the full library. Stage its output separately
# and merge just our six semantic entries into the retained compact document.
with TemporaryDirectory() as tmp:
    exporter = base['export_compact']
    exporter.__globals__['OUT'] = Path(tmp)
    try:
        base['validate_scene'](rig)
        compact = exporter()
    finally:
        exporter.__globals__['OUT'] = OUT
    runtime['meshes'].update({name: compact['meshes'][name] for name in attachments})
    base['validate'](runtime)

examples = [
    ('CITY_CITIZEN_F', 'city-citizen-f.glb', 'city_blouse', 3, [],
     dict(shirt=(153,71,102), pants=(46,65,91), skin=(239,199,168), wood=(76,45,30))),
    ('CITY_NEUTRAL_M', 'city-neutral-m.glb', 'city_work_vest', 1, ['city_nape','city_phone'],
     dict(shirt=(91,129,80), armor=(59,88,68), khaki=(178,157,101), pants=(83,66,51),
          skin=(145,94,62), wood=(32,27,26))),
    ('CITY_THUG_M', 'city-thug-m.glb', 'city_tracksuit', 0, ['city_cigarette'],
     dict(shirt=(105,56,151), gold=(244,197,54), pants=(48,39,65), skin=(194,143,95), wood=(32,27,26))),
]
visibility = [(obj, obj.hide_render, obj.hide_viewport, obj.hide_get()) for obj in source]
selected = list(bpy.context.selected_objects)
active = bpy.context.view_layer.objects.active
palette = dict(base['PALETTE'])
# Exporting glTF deliberately uses portable colors. Reuse a palette swatch to
# tint the female yoke independently of the blouse body for this one example.
blouse_part = next(obj for obj in source if obj['semantic'] == 'city_blouse')
yoke_slot = next(slot for slot in blouse_part.material_slots if slot.material.name == 'shirt')
yoke_material = yoke_slot.material
try:
    for role, filename, garment, hair, extra, colors in examples:
        visible = {garment, f'citizen_hair_{hair}', *extra}
        for obj, *_ in visibility:
            show = bool(obj.get('variantVisible')) or obj['semantic'] in visible
            obj.hide_render = obj.hide_viewport = not show
            obj.hide_set(not show)
        base['PALETTE'].update(palette)
        base['PALETTE'].update({key: [v/255 for v in rgb] for key, rgb in colors.items()})
        if garment == 'city_blouse':
            yoke_slot.material = base['MATERIALS']['armor']
            base['PALETTE']['armor'] = [214/255,143/255,161/255]
        base['export_glb'](rig, filename)
        yoke_slot.material = yoke_material
finally:
    yoke_slot.material = yoke_material
    base['PALETTE'].update(palette)
    for obj, render, viewport, hidden in visibility:
        obj.hide_render, obj.hide_viewport = render, viewport
        obj.hide_set(hidden)
    bpy.ops.object.select_all(action='DESELECT')
    for obj in selected: obj.select_set(True)
    bpy.context.view_layer.objects.active = active
    for mat in list(bpy.data.materials):
        if '_gltf' in mat.name and mat.users == 0: bpy.data.materials.remove(mat)

bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'player.blend'))
variants = manifest['civilianVariants']
for role, filename, garment, *_ in examples:
    entry = dict(type=role, portable=filename, outfit=garment, hairstyles=7,
                 builder='tools/blender-city-street.py')
    for i, existing in enumerate(variants):
        if existing['type'] == role:
            variants[i] = entry
            break
    else:
        variants.append(entry)
manifest['meshCount'] = len(runtime['meshes'])
(OUT / 'player-mesh.json').write_text(json.dumps(runtime, separators=(',', ':'))+'\n')
(OUT / 'manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
print('CITY_STREET_READY', {n: len(runtime['meshes'][n]['indices'])//3 for n in attachments})
