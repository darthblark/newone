#!/usr/bin/env python3
"""Append one city civilian family without rebuilding existing Blender assets.

blender --background assets/player/player.blend --python tools/blender-city-citizen.py
Run after blender-player.py when rebuilding the base library from scratch.
"""
import json
import math
from pathlib import Path
import runpy

import bpy

ROOT = Path(__file__).resolve().parents[1]
base = runpy.run_path(str(ROOT / 'tools/blender-player.py'))
G = base['Geometry']
out = ROOT / 'assets/player'
original = json.loads((out / 'player-mesh.json').read_text())
library = bpy.data.collections['Runtime mesh library']
rig = bpy.data.objects['PlayerRig']
base['load_native_weapons']()
base['MATERIALS'].update({name: bpy.data.materials[name] for name in base['PALETTE']})
base['LIBRARY'].update({obj.name: obj for obj in library.objects if obj.type == 'MESH'})
base['SOURCE'].extend(obj for obj in bpy.data.objects if obj.type == 'MESH' and 'semantic' in obj)

# These surfaces share the exact normalized torso frame, rather than fitting
# their small bounds into a second, oversized torso. +X is the open face/front.
def surface(z, y):
    rings = [(-1, .60, .60), (-.65, .85, .76), (.25, 1, .90), (.72, .91, .76), (1, .60, .50)]
    for (a, ax, ay), (b, bx, by) in zip(rings, rings[1:]):
        if a <= z <= b:
            t = (z-a)/(b-a)
            rx, ry = ax+(bx-ax)*t, ay+(by-ay)*t
            return (rx * math.sqrt(max(0, 1-(y/ry)**2)) + .025, y, z)
    raise ValueError(z)


def panel(g, y0, y1, z0, z1, material):
    zs = sorted({z0, z1, *(z for z in [-.65, .25, .72] if z0 < z < z1)})
    vertices = [surface(z, y) for z in zs for y in [y0, y1]]
    g.add(vertices, [(i, i+1, i+3, i+2) for i in range(0, len(vertices)-2, 2)], material)


def top_panel(g, x0, x1, y0, y1, material):
    # The native rig has a broad upper shirt surface. Continue the cloth detail
    # onto it so outfits remain readable at the game's steep viewing angle.
    g.add([(x0,y0,1.025),(x1,y0,1.025),(x1,y1,1.025),(x0,y1,1.025)], [(0,1,2,3)], material)


geometries = {}
for style in range(4):
    g = G()
    # Two separate collar leaves keep a visible neckline, even in overhead views.
    for side in [-1, 1]:
        g.add([surface(.96, side*.12), surface(.76, side*.42), surface(.52, side*.18)],
              [(0, 1, 2)], 'shirt')
    panel(g, -.035, .035, -.65, .70, 'shirt')
    top_panel(g, -.43, .37, -.03, .03, 'shirt')
    for side in [-1,1]:
        g.add([(.50,side*.08,1.035),(.29,side*.32,1.035),(.12,side*.09,1.035)],
              [(0,1,2) if side>0 else (2,1,0)], 'shirt')
    if style == 1:
        for side in [-1, 1]:
            panel(g, min(side*.16, side*.65), max(side*.16, side*.65), -.70, .62, 'armor')
        panel(g, -.51, -.28, .02, .26, 'white')
        for side in [-1,1]:
            top_panel(g, -.40, .26, min(side*.10,side*.32), max(side*.10,side*.32), 'armor')
        top_panel(g, -.05, .12, -.29, -.16, 'white')
    elif style == 2:
        panel(g, -.105, .105, -.70, .67, 'white')
        top_panel(g, -.45, .32, -.075, .075, 'white')
    elif style == 3:
        for y in [-.24,.20]: top_panel(g, -.40, .40, y, y+.04, 'white')
        for z in [-.30, .26]:
            vertices = []
            for h in [z-.035, z+.035]:
                for i in range(16):
                    a = i*math.tau/16
                    front = surface(h, 0)[0]
                    # Match the torso's elliptical section on front AND back.
                    ry = .76+(h+.65)/.90*.14 if h <= .25 else .90-(h-.25)/.47*.14
                    vertices.append((front*math.cos(a), (ry+.025)*math.sin(a), h))
            g.add(vertices, [(i, (i+1)%16, (i+1)%16+16, i+16) for i in range(16)], 'white')
    geometries['citizen_outfit_'+str(style)] = g

for style in range(7):
    g = G()
    # An open cap follows the spherical head. Its front hairline ends above
    # the eyes; no opaque full-head shell, ears or projecting facial geometry.
    sides, rings = 16, 5
    vertices = [(0, 0, 1.055)]
    for i in range(1, rings+1):
        for j in range(sides):
            a = j*math.tau/sides
            limit = 1.48-.47*math.cos(a)
            if style == 6: limit -= .24*max(0, math.cos(a))
            t = limit*i/rings
            vertices.append((1.045*math.sin(t)*math.cos(a), 1.045*math.sin(t)*math.sin(a), 1.055*math.cos(t)))
    faces = [(0, 1+j, 1+(j+1)%sides) for j in range(sides)]
    for i in range(rings-1):
        a, b = 1+i*sides, 1+(i+1)*sides
        faces.extend((a+j, b+j, b+(j+1)%sides, a+(j+1)%sides) for j in range(sides))
    g.add(vertices, faces, 'wood', True)
    if style == 1:
        g.sphere((-.12, -.24, .92), (.70, .50, .25), 'wood', 12, 6)
    elif style == 2:
        for j in range(7):
            a = math.pi*.5+j*math.pi/6
            g.sphere((.77*math.cos(a), .77*math.sin(a), .54), (.30, .30, .30), 'wood', 8, 5)
    elif style == 3:
        g.sphere((-1.24, 0, -.05), (.66, .32, .32), 'wood', 12, 6)
    elif style == 4:
        g.sphere((-.94, 0, .02), (.42, .42, .42), 'wood', 12, 6)
    elif style == 5:
        for side in [-1, 1]:
            g.sphere((-.54, side*.82, .12), (.35, .35, .37), 'wood', 10, 6)
    geometries['citizen_hair_'+str(style)] = g

collection = bpy.data.collections.get('City civilian variants')
if not collection:
    collection = bpy.data.collections.new('City civilian variants')
    bpy.context.scene.collection.children.link(collection)
for name, geometry in geometries.items():
    for obj in list(bpy.data.objects):
        if obj.name == name or obj.get('semantic') == name:
            if obj in base['SOURCE']: base['SOURCE'].remove(obj)
            mesh = obj.data
            bpy.data.objects.remove(obj, do_unlink=True)
            if mesh.users == 0: bpy.data.meshes.remove(mesh)
    obj = base['mesh_object'](name, geometry, library)
    obj.hide_render = obj.hide_viewport = True
    base['LIBRARY'][name] = obj
    hair = name.startswith('citizen_hair_')
    part = base['source_part']('City '+name, name, (.015, 0, 1.66) if hair else (0, 0, 1.20),
                              (.15, .15, .15) if hair else (.19, .265, .29),
                              bone='head' if hair else 'chest', visible=False, collection=collection)
    group = part.vertex_groups.new(name=part['bone'])
    group.add(list(range(len(part.data.vertices))), 1.0, 'REPLACE')
    part.modifiers.new('Player skin', 'ARMATURE').object = rig
    part.parent = rig

base['validate_scene'](rig)
data = base['export_compact']()
# Preserve existing source assets exactly, including manually authored palette.
for name, mesh in original['meshes'].items():
    if not name.startswith('citizen_'): data['meshes'][name] = mesh
data['palette'] = original['palette']
base['validate'](data)
(out / 'player-mesh.json').write_text(json.dumps(data, separators=(',', ':'))+'\n')
visibility = [(obj, obj.hide_render, obj.hide_viewport) for obj in base['SOURCE']]
try:
    for obj, _, _ in visibility:
        if obj.get('semantic') in ['citizen_outfit_1', 'citizen_hair_0']:
            obj.hide_render = obj.hide_viewport = False
    base['PALETTE'].update(shirt=[40/255,139/255,163/255], pants=[46/255,65/255,91/255],
                           armor=[28/255,97/255,114/255], wood=[32/255,27/255,26/255])
    base['export_glb'](rig, 'city-citizen-m.glb')
finally:
    for obj, render, viewport in visibility: obj.hide_render, obj.hide_viewport = render, viewport
# Portable-export materials are temporary; keep repeated source exports small.
for material in list(bpy.data.materials):
    if '_gltf' in material.name and material.users == 0: bpy.data.materials.remove(material)
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(out / 'player.blend'))
manifest = json.loads((out / 'manifest.json').read_text())
manifest['meshCount'] = len(data['meshes'])
variant = {'type': 'CITY_CITIZEN_M', 'portable': 'city-citizen-m.glb',
           'outfits': 4, 'hairstyles': 7, 'builder': 'tools/blender-city-citizen.py'}
manifest['civilianVariants'] = [variant] + [entry for entry in manifest.get('civilianVariants', [])
                                           if entry['type'] != variant['type']]
(out / 'manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
print('CITY_CITIZEN_READY', len(geometries), 'new meshes; existing meshes preserved')
