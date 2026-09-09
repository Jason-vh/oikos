"""Render isometric building sprites that drop straight into the game's tile metric.

    blender --background --python pipeline/iso_render.py -- --out pipeline/out

Camera: yaw 45 degrees, elevation 30 degrees, orthographic. Elevation 30 is what
makes one tile step project to exactly TILE_WIDTH/2 across and TILE_HEIGHT/2 down,
matching src/render/iso.ts. Each model is rendered twice: the body, and the shadow
it casts on the ground, so the game can lay shadows under their neighbours.
"""

import argparse
import json
import math
import os
import sys

import bpy
from mathutils import Matrix, Vector

TILE_WIDTH = 120
TILE_HEIGHT = 60
SUN_ALTITUDE = math.radians(58)
SUN_AZIMUTH = math.radians(125)
SUPERSAMPLE = 2
SAMPLES = 16
PIXELS_PER_UNIT = TILE_WIDTH / math.sqrt(2)
CAMERA_ELEVATION = math.radians(30)
CAMERA_YAW = math.radians(45)


def hex_rgb(code):
    return tuple(int(code[i : i + 2], 16) / 255 for i in (0, 2, 4))


WHITEWASH = hex_rgb("efe6d2")
TERRACOTTA = hex_rgb("c8642e")
TERRACOTTA_LIGHT = hex_rgb("d97a3c")
MARBLE = hex_rgb("e9e4d6")
BRONZE = hex_rgb("8a6a34")
STRAW = hex_rgb("c9a94f")
STRAW_DULL = hex_rgb("b8963f")
STRAW_RIDGE = hex_rgb("e0c478")
WINDOW_GLOW = (1.0, 0.45, 0.1)
STONE = (0.70, 0.66, 0.58)
FIELDSTONE = (0.62, 0.58, 0.50)
OCHRE = (0.78, 0.58, 0.34)
CLAY = (0.70, 0.34, 0.19)
WOOD = (0.22, 0.13, 0.07)
PATINA = (0.33, 0.52, 0.44)
CYPRESS = (0.13, 0.30, 0.18)
WATER_LIGHT = (0.40, 0.74, 0.77)
SOIL = (0.36, 0.27, 0.17)
SLATE = (0.30, 0.36, 0.40)
EARTH = hex_rgb("c9b489")
DAUB = hex_rgb("a4794c")
DAUB_LIGHT = hex_rgb("b98d5c")
THATCH = hex_rgb("d8c579")
THATCH_DARK = hex_rgb("ab944d")
SHADOW_DARK = (0.06, 0.05, 0.04)


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="pipeline/out")
    parser.add_argument("--only", default="", help="comma-separated model names")
    parser.add_argument("--samples", type=int, default=SAMPLES)
    parser.add_argument("--device", default="GPU", choices=("GPU", "CPU"))
    return parser.parse_args(argv)


def clear_scene(samples=SAMPLES, device="GPU"):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.render.film_transparent = True
    scene.view_settings.view_transform = "Standard"
    if device == "CPU":
        scene.cycles.device = "CPU"
        return
    try:
        scene.cycles.device = "GPU"
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "METAL"
        prefs.get_devices()
        for device in prefs.devices:
            device.use = True
    except Exception:
        scene.cycles.device = "CPU"


def to_linear(channel):
    if channel <= 0.04045:
        return channel / 12.92
    return ((channel + 0.055) / 1.055) ** 2.4


def material(name, colour, roughness=0.8, metallic=0.0):
    """Colours are given in sRGB, as picked; Blender wants linear."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*[to_linear(c) for c in colour], 1)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    return mat


def link_object_coords(mat, texture_node):
    nodes = mat.node_tree.nodes
    coords = nodes.new("ShaderNodeTexCoord")
    mat.node_tree.links.new(coords.outputs["Object"], texture_node.inputs["Vector"])


def plaster_material(name, colour, roughness=0.85, variation=0.06, scale=6.0):
    """Base material with a soft noise mottle so large flat walls do not read as plastic."""
    mat = material(name, colour, roughness=roughness)
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    bsdf = nodes["Principled BSDF"]
    noise = nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = scale
    noise.inputs["Detail"].default_value = 3.0
    link_object_coords(mat, noise)
    darker = tuple(to_linear(c) * (1 - variation * 2) for c in colour)
    mix = nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.inputs["A"].default_value = (*darker, 1)
    mix.inputs["B"].default_value = bsdf.inputs["Base Color"].default_value
    links.new(noise.outputs["Fac"], mix.inputs["Factor"])
    links.new(mix.outputs["Result"], bsdf.inputs["Base Color"])
    return mat


def roof_material(name, colour, rows_per_unit=14.0, roughness=0.78):
    """Terracotta with tile rows: a brick texture drives both bump and a slight colour shift."""
    mat = plaster_material(name, colour, roughness=roughness, variation=0.05, scale=4.0)
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    bsdf = nodes["Principled BSDF"]
    brick = nodes.new("ShaderNodeTexBrick")
    brick.inputs["Scale"].default_value = rows_per_unit
    brick.inputs["Mortar Size"].default_value = 0.06
    brick.inputs["Bias"].default_value = 0.0
    brick.inputs["Brick Width"].default_value = 0.5
    brick.inputs["Row Height"].default_value = 0.35
    brick.inputs["Color1"].default_value = (1, 1, 1, 1)
    brick.inputs["Color2"].default_value = (0.9, 0.9, 0.9, 1)
    brick.inputs["Mortar"].default_value = (0.55, 0.55, 0.55, 1)
    link_object_coords(mat, brick)
    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.35
    bump.inputs["Distance"].default_value = 0.02
    links.new(brick.outputs["Fac"], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    shade = nodes.new("ShaderNodeMix")
    shade.data_type = "RGBA"
    shade.blend_type = "MULTIPLY"
    shade.inputs["Factor"].default_value = 1.0
    current = bsdf.inputs["Base Color"].links[0].from_socket
    links.new(current, shade.inputs["A"])
    links.new(brick.outputs["Color"], shade.inputs["B"])
    links.new(shade.outputs["Result"], bsdf.inputs["Base Color"])
    return mat


def add_box(name, centre, size, mat):
    bpy.ops.mesh.primitive_cube_add(size=2, location=centre)
    box = bpy.context.active_object
    box.name = name
    box.scale = Vector(size) / 2
    box.data.materials.append(mat)
    return box


def add_cylinder(name, centre, radius, depth, mat, vertices=24):
    bpy.ops.mesh.primitive_cylinder_add(radius=radius, depth=depth, location=centre, vertices=vertices)
    obj = bpy.context.active_object
    obj.name = name
    obj.data.materials.append(mat)
    bpy.ops.object.shade_smooth()
    return obj


def add_pyramid(name, centre, radius, depth, mat, vertices=4):
    bpy.ops.mesh.primitive_cone_add(radius1=radius, radius2=0.0, depth=depth, location=centre, vertices=vertices)
    obj = bpy.context.active_object
    obj.name = name
    if vertices == 4:
        obj.rotation_euler[2] = math.radians(45)
    else:
        bpy.ops.object.shade_smooth()
    obj.data.materials.append(mat)
    return obj


def square_radius(half_side):
    """A 4-vertex cone rotated 45 degrees has half-side radius / sqrt(2)."""
    return half_side * math.sqrt(2)


def add_eaves(name, half_side, z, mat, centre=(0.0, 0.0)):
    """Thin slab under the roof edge so the overhang reads from below."""
    cx, cy = centre
    return add_box(name, (cx, cy, z - 0.0125), (half_side * 2, half_side * 2, 0.025), mat)


def add_hip_roof(name, centre, half_side, depth, mat, ridge_half=0.08):
    """A pyramid roof flattened at the peak — reads as a hip roof, not a shack point."""
    bpy.ops.mesh.primitive_cone_add(
        radius1=square_radius(half_side),
        radius2=square_radius(ridge_half),
        depth=depth,
        location=centre,
        vertices=4,
    )
    obj = bpy.context.active_object
    obj.name = name
    obj.rotation_euler[2] = math.radians(45)
    obj.data.materials.append(mat)
    return obj


def add_amphora(name, centre, height, mat):
    cx, cy, cz = centre
    body_r = height * 0.34
    bpy.ops.mesh.primitive_uv_sphere_add(radius=body_r, location=(cx, cy, cz + body_r * 0.95), segments=12, ring_count=8)
    body = bpy.context.active_object
    body.name = f"{name}_body"
    body.scale[2] = 1.25
    body.data.materials.append(mat)
    bpy.ops.object.shade_smooth()
    add_cylinder(f"{name}_neck", (cx, cy, cz + body_r * 2.1), body_r * 0.32, body_r * 1.0, mat, vertices=10)
    return body


def add_cypress_pot(name, centre, height, pot_mat, foliage_mat):
    cx, cy, cz = centre
    pot_r = height * 0.22
    pot_h = height * 0.3
    add_cylinder(f"{name}_pot", (cx, cy, cz + pot_h / 2), pot_r, pot_h, pot_mat, vertices=10)
    bpy.ops.mesh.primitive_cone_add(
        radius1=height * 0.16, radius2=0.01, depth=height * 0.85,
        location=(cx, cy, cz + pot_h + height * 0.425), vertices=8,
    )
    foliage = bpy.context.active_object
    foliage.name = f"{name}_foliage"
    foliage.data.materials.append(foliage_mat)
    return foliage


def add_pergola(name, wall_x, y_centre, z_base, protrusion, span, height, mat):
    """A flat-roofed lean-to on two posts, its slab flush against the wall face at wall_x."""
    outer_x = wall_x - protrusion if wall_x < 0 else wall_x + protrusion
    slab_x = (wall_x + outer_x) / 2
    for sy in (-1, 1):
        add_cylinder(
            f"{name}_post", (outer_x, y_centre + sy * (span / 2 - 0.04), z_base + height / 2), 0.022, height, mat, vertices=8
        )
    add_box(f"{name}_roof", (slab_x, y_centre, z_base + height + 0.02), (protrusion + 0.02, span, 0.03), mat)


def add_wall(name, centre, length, height, thickness, mat, along_x=True):
    size = (length, thickness, height) if along_x else (thickness, length, height)
    add_box(name, centre, size, mat)


def window_material():
    mat = bpy.data.materials.new("window")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (0.09, 0.07, 0.05, 1)
    bsdf.inputs["Roughness"].default_value = 0.4
    return mat


def add_door(half, height, door_mat, centre=(0.0, 0.0)):
    """Door on the +X face, the one the camera sees on the right."""
    cx, cy = centre
    door_w = max(0.14, half * 0.4)
    add_box("door", (cx + half - 0.01, cy, height / 2), (0.05, door_w, height), door_mat)


def add_window_row(half, z, size, centre=(0.0, 0.0), on_door_face=False):
    """Windows on the -Y face, and optionally flanking the door on +X."""
    cx, cy = centre
    glass = window_material()
    window_w, window_h = size
    for offset in (-half * 0.55, half * 0.55):
        add_box("window", (cx + offset, cy - half + 0.01, z), (window_w, 0.06, window_h), glass)
        if on_door_face:
            add_box("window", (cx + half - 0.01, cy + offset, z), (0.06, window_w, window_h), glass)


def add_openings(half, sill, tall, door_mat, centre=(0.0, 0.0)):
    add_door(half, sill * 1.1, door_mat, centre)
    window_w = max(0.16, tall * 0.26)
    window_h = max(0.18, tall * 0.3)
    add_window_row(half, sill + tall * 0.15, (window_w, window_h), centre)


PLOT_HALF = 0.96


def add_yard(mat, half=PLOT_HALF):
    """The packed earth of a housing plot: every tier is built on one of these.

    It casts no shadow, or every plot would sit in a dark square of its own making.
    """
    yard = add_box("yard", (0, 0, 0.02), (half * 2, half * 2, 0.04), mat)
    yard.visible_shadow = False
    return yard


def add_shed_roof(name, centre, half_x, half_y, thickness, mat, pitch=0.3):
    """A single-pitch roof sloping down towards +X, the face the camera sees."""
    obj = add_box(name, centre, (half_x * 2, half_y * 2, thickness), mat)
    obj.rotation_euler[1] = pitch
    return obj


def add_gable_roof(name, centre, half_x, half_y, rise, thickness, mat):
    """Two pitched planes meeting at a ridge running north-south."""
    cx, cy, cz = centre
    pitch = math.atan2(rise, half_x)
    slope = math.hypot(rise, half_x)
    for side in (-1, 1):
        plane = add_box(
            f"{name}_{'west' if side < 0 else 'east'}",
            (cx + side * half_x / 2, cy, cz + rise / 2),
            (slope, half_y * 2, thickness),
            mat,
        )
        plane.rotation_euler[1] = side * pitch
    return add_box(f"{name}_ridge", (cx, cy, cz + rise), (thickness * 1.6, half_y * 2, thickness), mat)


def add_doorway(half, height, centre=(0.0, 0.0), width=None):
    """An open door: a dark recess rather than a painted panel."""
    cx, cy = centre
    dark = material("doorway", SHADOW_DARK, roughness=0.9)
    door_w = width if width else max(0.16, half * 0.42)
    return add_box("doorway", (cx + half - 0.02, cy, height / 2), (0.06, door_w, height), dark)


def add_rack(name, centre, span, height, wood_mat, cover_mat):
    """A drying rack: four posts, a plank bed and a thatch cover, angled to the sun."""
    cx, cy, cz = centre
    for sx in (-1, 1):
        for sy in (-1, 1):
            add_cylinder(
                f"{name}_post", (cx + sx * span * 0.42, cy + sy * span * 0.3, cz + height / 2),
                0.018, height, wood_mat, vertices=6,
            )
    add_box(f"{name}_bed", (cx, cy, cz + height), (span, span * 0.66, 0.03), wood_mat)
    add_shed_roof(f"{name}_cover", (cx, cy, cz + height + 0.05), span * 0.55, span * 0.36, 0.03, cover_mat, pitch=0.22)


def add_stump(name, centre, mat):
    cx, cy, cz = centre
    return add_cylinder(name, (cx, cy, cz + 0.07), 0.09, 0.14, mat, vertices=10)


def build_house_0():
    """Hut: wattle-and-daub walls under a straw shed roof, an open doorway, racks in the dirt."""
    earth = plaster_material("earth", EARTH, roughness=0.98, variation=0.1, scale=16.0)
    daub = plaster_material("daub", DAUB, roughness=0.97, variation=0.16, scale=13.0)
    thatch = plaster_material("thatch", THATCH, roughness=0.96, variation=0.12, scale=22.0)
    thatch_dark = plaster_material("thatch_dark", THATCH_DARK, roughness=0.96, variation=0.1, scale=18.0)
    wood = material("wood", WOOD, roughness=0.9)
    clay = material("clay", CLAY, roughness=0.85)

    add_yard(earth)

    half = 0.34
    wall_h = 0.42
    cx, cy = -0.24, -0.16
    add_box("walls", (cx, cy, 0.04 + wall_h / 2), (half * 2, half * 2, wall_h), daub)
    for sy in (-1, 1):
        add_cylinder("corner_post", (cx + half - 0.02, cy + sy * (half - 0.03), 0.04 + wall_h / 2), 0.024, wall_h, wood, vertices=6)
    add_doorway(half, 0.3, (cx, cy))

    add_gable_roof("roof", (cx, cy, 0.04 + wall_h), half + 0.06, half + 0.05, 0.2, 0.045, thatch)
    add_box("eave_beam", (cx, cy - half - 0.04, 0.04 + wall_h + 0.01), (half * 2 + 0.1, 0.035, 0.035), thatch_dark)

    add_rack("rack_east", (0.58, 0.5, 0.04), 0.4, 0.18, wood, thatch_dark)
    add_stump("stump", (0.5, -0.42, 0.04), wood)
    add_amphora("pot", (0.06, -0.66, 0.04), 0.16, clay)

    return {"kind": "house", "variant": 0, "footprint": 2, "height": 0.76}


def build_house_1():
    """Shack: the hut gains a second room, a lean-to store and a brushwood fence."""
    earth = plaster_material("earth", EARTH, roughness=0.98, variation=0.1, scale=16.0)
    daub = plaster_material("daub", DAUB_LIGHT, roughness=0.95, variation=0.14, scale=12.0)
    thatch = plaster_material("thatch", THATCH, roughness=0.96, variation=0.12, scale=22.0)
    thatch_dark = plaster_material("thatch_dark", THATCH_DARK, roughness=0.96, variation=0.1, scale=18.0)
    wood = material("wood", WOOD, roughness=0.9)
    clay = material("clay", CLAY, roughness=0.85)

    add_yard(earth)

    half = 0.4
    wall_h = 0.5
    cx, cy = -0.26, -0.2
    add_box("walls", (cx, cy, 0.04 + wall_h / 2), (half * 2, half * 2, wall_h), daub)
    add_doorway(half, 0.32, (cx, cy))
    add_window_row(half, 0.32, (0.1, 0.09), (cx, cy))
    add_gable_roof("roof", (cx, cy, 0.04 + wall_h), half + 0.07, half + 0.06, 0.22, 0.05, thatch)

    annex_half = 0.24
    ax, ay = cx + half + annex_half - 0.02, cy + 0.42
    add_box("annex", (ax, ay, 0.04 + 0.3 / 2), (annex_half * 2, annex_half * 2, 0.3), daub)
    add_shed_roof("annex_roof", (ax, ay, 0.04 + 0.3 + 0.06), annex_half + 0.06, annex_half + 0.05, 0.04, thatch_dark, pitch=0.34)

    add_rack("rack", (0.6, -0.5, 0.04), 0.4, 0.2, wood, thatch_dark)
    for x in (0.1, 0.44, 0.78):
        add_cylinder("fence_post", (x, -0.86, 0.16), 0.02, 0.24, wood, vertices=6)
    add_wall("fence_rail", (0.44, -0.86, 0.24), 0.76, 0.05, 0.03, wood, along_x=True)
    add_amphora("jar", (-0.62, 0.66, 0.04), 0.2, clay)
    add_stump("stump", (0.72, 0.62, 0.04), wood)

    return {"kind": "house", "variant": 2, "footprint": 2, "height": 0.68}


def build_house_2():
    """Hovel: mud-brick walls rendered in ochre, the first tiled roof, an awning and jars."""
    earth = plaster_material("earth", EARTH, roughness=0.98, variation=0.08, scale=16.0)
    ochre = plaster_material("ochre", OCHRE, roughness=0.9, variation=0.09, scale=9.0)
    terracotta = roof_material("terracotta", TERRACOTTA)
    stone = plaster_material("stone", STONE, roughness=0.88, variation=0.06, scale=11.0)
    wood = material("wood", WOOD, roughness=0.88)
    clay = material("clay", CLAY, roughness=0.82)

    add_yard(earth)

    half = 0.5
    wall_h = 0.44
    cx, cy = -0.16, -0.14
    add_box("plinth", (cx, cy, 0.06), (half * 2 + 0.06, half * 2 + 0.06, 0.08), stone)
    add_box("walls", (cx, cy, 0.1 + wall_h / 2), (half * 2, half * 2, wall_h), ochre)
    add_doorway(half, 0.3, (cx, cy))
    add_window_row(half, 0.34, (0.12, 0.11), (cx, cy))

    roof_z = 0.1 + wall_h
    roof_h = 0.2
    add_hip_roof("roof", (cx, cy, roof_z + roof_h / 2), half + 0.08, roof_h, terracotta, ridge_half=0.14)
    add_box("ridge", (cx, cy, roof_z + roof_h + 0.01), (0.3, 0.06, 0.035), terracotta)

    add_pergola("awning", cx + half, cy - 0.06, 0.1, 0.16, 0.5, 0.3, wood)
    add_amphora("jar1", (0.62, 0.52, 0.04), 0.24, clay)
    add_amphora("jar2", (0.3, 0.72, 0.04), 0.2, clay)
    add_wall("yard_wall", (-0.1, 0.84, 0.14), 1.5, 0.2, 0.06, stone, along_x=True)

    return {"kind": "house", "variant": 4, "footprint": 2, "height": roof_z + roof_h + 0.1}


def build_house_3():
    """Homestead: whitewashed walls, a hip-tiled roof, pergola, chimney and a walled yard."""
    earth = plaster_material("earth", EARTH, roughness=0.98, variation=0.08, scale=16.0)
    whitewash = plaster_material("whitewash", WHITEWASH, roughness=0.86, variation=0.05, scale=7.0)
    terracotta = roof_material("terracotta", TERRACOTTA)
    stone = plaster_material("stone", STONE, roughness=0.82, variation=0.06, scale=10.0)
    wood = material("wood", WOOD, roughness=0.82)
    clay = material("clay", CLAY, roughness=0.8)
    brick = material("brick", (0.5, 0.3, 0.22), roughness=0.85)

    add_yard(earth)

    half = 0.56
    wall_h = 0.56
    cx, cy = -0.1, -0.1
    add_box("plinth", (cx, cy, 0.07), (half * 2 + 0.07, half * 2 + 0.07, 0.1), stone)
    add_box("walls", (cx, cy, 0.12 + wall_h / 2), (half * 2, half * 2, wall_h), whitewash)
    add_box("cornice", (cx, cy, 0.12 + wall_h + 0.02), (half * 2 + 0.05, half * 2 + 0.05, 0.035), stone)
    add_doorway(half, 0.34, (cx, cy))
    add_window_row(half, 0.42, (0.13, 0.15), (cx, cy), on_door_face=True)

    roof_z = 0.12 + wall_h + 0.035
    roof_h = 0.24
    eave = half + 0.1
    add_hip_roof("roof", (cx, cy, roof_z + roof_h / 2), eave, roof_h, terracotta, ridge_half=0.18)
    add_box("ridge", (cx, cy, roof_z + roof_h + 0.01), (0.36, 0.06, 0.04), terracotta)
    add_box("chimney", (cx - 0.3, cy + 0.3, roof_z + roof_h - 0.02), (0.08, 0.08, 0.22), brick)

    add_pergola("pergola", cx - half, cy + 0.1, 0.04, 0.16, 0.6, 0.32, wood)
    add_amphora("jar1", (0.74, -0.36, 0.04), 0.26, clay)
    add_amphora("jar2", (0.68, 0.24, 0.04), 0.22, clay)
    add_wall("yard_wall", (0.0, 0.86, 0.14), 1.6, 0.2, 0.06, stone, along_x=True)

    return {"kind": "house", "variant": 6, "footprint": 2, "height": roof_z + roof_h + 0.12}


def build_house_4():
    """Tenement: two storeys of whitewash with a marble string course, porch and cypress."""
    paving = plaster_material("paving", STONE, roughness=0.9, variation=0.05, scale=14.0)
    whitewash = plaster_material("whitewash", WHITEWASH, roughness=0.85, variation=0.05, scale=6.0)
    terracotta = roof_material("terracotta", TERRACOTTA)
    marble = material("marble", MARBLE, roughness=0.35)
    stone = plaster_material("stone", STONE, roughness=0.8, variation=0.06, scale=10.0)
    wood = material("wood", WOOD, roughness=0.8)
    clay = material("clay", CLAY, roughness=0.8)
    cypress = material("cypress", CYPRESS, roughness=0.9)
    brick = material("brick", (0.5, 0.3, 0.22), roughness=0.85)

    add_yard(paving)

    half = 0.58
    wall_h = 0.86
    cx, cy = -0.1, -0.08
    add_box("plinth", (cx, cy, 0.07), (half * 2 + 0.08, half * 2 + 0.08, 0.1), stone)
    add_box("walls", (cx, cy, 0.12 + wall_h / 2), (half * 2, half * 2, wall_h), whitewash)
    add_box("string_course", (cx, cy, 0.12 + 0.46), (half * 2 + 0.04, half * 2 + 0.04, 0.03), marble)
    add_box("cornice", (cx, cy, 0.12 + wall_h + 0.02), (half * 2 + 0.06, half * 2 + 0.06, 0.04), marble)
    add_doorway(half, 0.36, (cx, cy))
    add_window_row(half, 0.3, (0.13, 0.15), (cx, cy))
    add_window_row(half, 0.74, (0.13, 0.16), (cx, cy), on_door_face=True)

    roof_z = 0.12 + wall_h + 0.04
    roof_h = 0.24
    eave = half + 0.11
    add_eaves("eaves", eave, roof_z, wood, (cx, cy))
    add_hip_roof("roof", (cx, cy, roof_z + roof_h / 2), eave, roof_h, terracotta, ridge_half=0.2)
    add_box("ridge", (cx, cy, roof_z + roof_h + 0.01), (0.4, 0.06, 0.04), terracotta)
    add_box("chimney", (cx - 0.32, cy + 0.32, roof_z + roof_h - 0.02), (0.08, 0.08, 0.24), brick)

    porch_x = cx + half + 0.1
    for y in (cy - 0.26, cy + 0.26):
        add_cylinder("column", (porch_x, y, 0.12 + 0.23), 0.04, 0.46, marble, vertices=14)
        add_box("capital", (porch_x, y, 0.12 + 0.47), (0.1, 0.1, 0.035), marble)
    add_box("porch_roof", (porch_x, cy, 0.12 + 0.52), (0.24, 0.66, 0.05), marble)

    add_cypress_pot("cypress", (-0.72, 0.72, 0.04), 0.36, clay, cypress)
    add_amphora("jar", (0.7, 0.66, 0.04), 0.26, clay)

    return {"kind": "house", "variant": 8, "footprint": 2, "height": roof_z + roof_h + 0.12}


def build_house_5():
    """Apartment: a taller block with a balcony, roof terrace and a colonnaded front."""
    paving = plaster_material("paving", STONE, roughness=0.9, variation=0.05, scale=14.0)
    whitewash = plaster_material("whitewash", WHITEWASH, roughness=0.85, variation=0.05, scale=6.0)
    terracotta = roof_material("terracotta", TERRACOTTA)
    marble = material("marble", MARBLE, roughness=0.32)
    stone = plaster_material("stone", STONE, roughness=0.8, variation=0.06, scale=10.0)
    wood = material("wood", WOOD, roughness=0.8)
    clay = material("clay", CLAY, roughness=0.8)
    cypress = material("cypress", CYPRESS, roughness=0.9)

    add_yard(paving)

    half = 0.6
    wall_h = 1.12
    cx, cy = -0.08, -0.06
    add_box("plinth", (cx, cy, 0.08), (half * 2 + 0.1, half * 2 + 0.1, 0.12), stone)
    add_box("walls", (cx, cy, 0.14 + wall_h / 2), (half * 2, half * 2, wall_h), whitewash)
    add_box("string_course", (cx, cy, 0.14 + 0.52), (half * 2 + 0.05, half * 2 + 0.05, 0.035), marble)
    add_box("cornice", (cx, cy, 0.14 + wall_h + 0.025), (half * 2 + 0.08, half * 2 + 0.08, 0.05), marble)
    add_doorway(half, 0.38, (cx, cy))
    add_window_row(half, 0.3, (0.13, 0.16), (cx, cy))
    add_window_row(half, 0.72, (0.13, 0.17), (cx, cy), on_door_face=True)
    add_window_row(half, 1.0, (0.13, 0.15), (cx, cy))

    balcony_z = 0.14 + 0.66
    add_box("balcony", (cx + half + 0.1, cy, balcony_z), (0.22, half * 1.5, 0.045), marble)
    for y in (cy - 0.3, cy, cy + 0.3):
        add_cylinder("baluster", (cx + half + 0.18, y, balcony_z + 0.08), 0.018, 0.16, marble, vertices=8)
    add_box("balcony_rail", (cx + half + 0.18, cy, balcony_z + 0.17), (0.05, half * 1.5, 0.03), marble)

    roof_z = 0.14 + wall_h + 0.05
    roof_h = 0.24
    eave = half + 0.12
    add_eaves("eaves", eave, roof_z, wood, (cx, cy))
    add_hip_roof("roof", (cx, cy, roof_z + roof_h / 2), eave, roof_h, terracotta, ridge_half=0.22)
    add_box("ridge", (cx, cy, roof_z + roof_h + 0.01), (0.44, 0.06, 0.04), terracotta)

    add_cypress_pot("cypress", (-0.74, 0.74, 0.04), 0.4, clay, cypress)
    add_amphora("jar", (0.74, -0.7, 0.04), 0.3, clay)
    add_box("bench", (0.2, 0.82, 0.14), (0.5, 0.16, 0.16), marble)

    return {"kind": "house", "variant": 10, "footprint": 2, "height": roof_z + roof_h + 0.12}


def build_house_6():
    """Townhouse: two wings around a courtyard, marble trim, statue niche and cypresses."""
    paving = plaster_material("paving", MARBLE, roughness=0.6, variation=0.04, scale=16.0)
    whitewash = plaster_material("whitewash", WHITEWASH, roughness=0.84, variation=0.04, scale=6.0)
    terracotta = roof_material("terracotta", TERRACOTTA)
    marble = material("marble", MARBLE, roughness=0.3)
    stone = plaster_material("stone", STONE, roughness=0.8, variation=0.06, scale=10.0)
    wood = material("wood", WOOD, roughness=0.8)
    clay = material("clay", CLAY, roughness=0.8)
    cypress = material("cypress", CYPRESS, roughness=0.9)
    bronze = material("bronze", BRONZE, roughness=0.35, metallic=1.0)

    add_yard(paving)
    add_box("kerb", (0, 0, 0.015), (PLOT_HALF * 2 + 0.05, PLOT_HALF * 2 + 0.05, 0.03), marble)

    main_half = 0.52
    main_h = 1.1
    mx, my = -0.36, -0.34
    add_box("plinth", (mx, my, 0.08), (main_half * 2 + 0.1, main_half * 2 + 0.1, 0.12), stone)
    add_box("main", (mx, my, 0.14 + main_h / 2), (main_half * 2, main_half * 2, main_h), whitewash)
    add_box("main_course", (mx, my, 0.14 + 0.52), (main_half * 2 + 0.05, main_half * 2 + 0.05, 0.035), marble)
    add_box("main_cornice", (mx, my, 0.14 + main_h + 0.025), (main_half * 2 + 0.08, main_half * 2 + 0.08, 0.05), marble)
    add_doorway(main_half, 0.4, (mx, my))
    add_window_row(main_half, 0.34, (0.13, 0.16), (mx, my))
    add_window_row(main_half, 0.78, (0.13, 0.17), (mx, my), on_door_face=True)

    roof_z = 0.14 + main_h + 0.05
    roof_h = 0.24
    add_eaves("eaves", main_half + 0.12, roof_z, wood, (mx, my))
    add_hip_roof("main_roof", (mx, my, roof_z + roof_h / 2), main_half + 0.12, roof_h, terracotta, ridge_half=0.2)

    wing_half = 0.34
    wx, wy = 0.5, 0.5
    wing_h = 0.66
    add_box("wing", (wx, wy, 0.04 + wing_h / 2), (wing_half * 2, wing_half * 2, wing_h), whitewash)
    add_box("wing_cornice", (wx, wy, 0.04 + wing_h + 0.02), (wing_half * 2 + 0.05, wing_half * 2 + 0.05, 0.04), marble)
    add_hip_roof("wing_roof", (wx, wy, 0.04 + wing_h + 0.14), wing_half + 0.08, 0.2, terracotta, ridge_half=0.12)
    add_doorway(wing_half, 0.3, (wx, wy))

    for y in (-0.62, -0.2, 0.22):
        add_cylinder("column", (0.62, y, 0.04 + 0.3), 0.045, 0.6, marble, vertices=14)
        add_box("capital", (0.62, y, 0.04 + 0.62), (0.11, 0.11, 0.04), marble)
    add_box("stoa_roof", (0.62, -0.2, 0.04 + 0.68), (0.3, 1.0, 0.06), marble)

    add_cylinder("statue_plinth", (-0.72, 0.66, 0.18), 0.1, 0.28, marble, vertices=12)
    add_cylinder("statue", (-0.72, 0.66, 0.44), 0.05, 0.24, bronze, vertices=10)
    add_cypress_pot("cypress1", (-0.2, 0.82, 0.04), 0.42, clay, cypress)
    add_cypress_pot("cypress2", (0.86, -0.86, 0.04), 0.38, clay, cypress)

    return {"kind": "house", "variant": 12, "footprint": 2, "height": roof_z + roof_h + 0.14}


def build_growers_lodge():
    """Lodge beside an olive grove: low stone hut, trees in rows, harvest baskets."""
    soil = plaster_material("soil", SOIL, roughness=0.98, variation=0.1, scale=12.0)
    grass = plaster_material("grove_grass", (0.42, 0.45, 0.24), roughness=0.95, variation=0.12, scale=14.0)
    stone = plaster_material("stone", STONE, roughness=0.85, variation=0.06, scale=10.0)
    ochre = plaster_material("ochre", OCHRE, roughness=0.9, variation=0.08, scale=8.0)
    terracotta = roof_material("terracotta", TERRACOTTA)
    wood = material("wood", WOOD, roughness=0.85)
    bark = material("bark", (0.32, 0.26, 0.18), roughness=0.9)
    leaf = material("leaf", (0.36, 0.44, 0.26), roughness=0.9)
    clay = material("clay", CLAY, roughness=0.8)

    add_box("ground", (-0.1, -0.1, 0.02), (1.7, 1.7, 0.04), grass)
    add_wall("wall_south", (-0.1, -0.96, 0.09), 1.7, 0.18, 0.06, stone, along_x=True)
    add_wall("wall_west", (-0.96, -0.1, 0.09), 1.7, 0.18, 0.06, stone, along_x=False)

    for row, x in enumerate((-0.62, -0.02)):
        for column, y in enumerate((-0.6, 0.0, 0.6)):
            add_box(f"root_{row}{column}", (x, y, 0.05), (0.24, 0.24, 0.04), soil)
            add_cylinder(f"trunk_{row}{column}", (x, y, 0.17), 0.045, 0.26, bark, vertices=8)
            add_pyramid(f"crown_{row}{column}", (x, y, 0.42), 0.28, 0.34, leaf, vertices=7)

    hx, hy = 0.62, 0.62
    half = 0.3
    wall_h = 0.42
    add_box("lodge_wall", (hx, hy, wall_h / 2), (half * 2, half * 2, wall_h), ochre)
    add_hip_roof("lodge_roof", (hx, hy, wall_h + 0.1), half + 0.05, 0.2, terracotta, ridge_half=0.08)
    add_door(half, 0.26, wood, (hx, hy))
    add_window_row(half, 0.24, (0.1, 0.1), (hx, hy))
    add_amphora("basket", (0.66, -0.2, 0.04), 0.24, clay)

    return {"kind": "growersLodge", "variant": 0, "footprint": 2, "height": 0.85}


def build_olive_press():
    """Open-sided press house: millstone under a tiled canopy, oil jars, screw beam."""
    stone = plaster_material("stone", STONE, roughness=0.82, variation=0.06, scale=10.0)
    whitewash = plaster_material("whitewash", WHITEWASH, roughness=0.85, variation=0.05, scale=6.0)
    terracotta = roof_material("terracotta", TERRACOTTA)
    wood = material("wood", WOOD, roughness=0.85)
    millstone = plaster_material("millstone", FIELDSTONE, roughness=0.75, variation=0.05, scale=8.0)
    clay = material("clay", CLAY, roughness=0.8)

    add_box("yard", (0, 0, 0.03), (1.7, 1.7, 0.06), stone)

    half = 0.44
    wall_h = 0.56
    add_box("press_house", (-0.42, -0.42, 0.06 + wall_h / 2), (half * 2, half * 2, wall_h), whitewash)
    add_hip_roof("press_roof", (-0.42, -0.42, 0.06 + wall_h + 0.12), half + 0.07, 0.24, terracotta, ridge_half=0.1)
    add_door(half, 0.3, wood, (-0.42, -0.42))

    add_cylinder("basin", (0.42, 0.4, 0.14), 0.34, 0.16, stone, vertices=24)
    add_cylinder("millstone", (0.42, 0.4, 0.3), 0.22, 0.09, millstone, vertices=20)
    add_cylinder("spindle", (0.42, 0.4, 0.42), 0.03, 0.34, wood, vertices=10)
    add_box("press_beam", (0.42, 0.4, 0.56), (0.7, 0.07, 0.07), wood)

    for y in (-0.1, 0.1):
        add_cylinder("canopy_post", (0.9, 0.4 + y * 4, 0.36), 0.03, 0.6, wood, vertices=8)
    add_hip_roof("canopy", (0.42, 0.4, 0.72), 0.5, 0.14, terracotta, ridge_half=0.12)

    add_amphora("oil_jar1", (-0.5, 0.72, 0.06), 0.32, clay)
    add_amphora("oil_jar2", (-0.16, 0.86, 0.06), 0.28, clay)

    return {"kind": "olivePress", "variant": 0, "footprint": 2, "height": 0.95}


def build_wheat_farm():
    """Farmhouse with a terracotta roof; low golden wheat rows behind a stone wall."""
    soil = plaster_material("soil", SOIL, roughness=0.98, variation=0.1, scale=12.0)
    crop = plaster_material("crop", STRAW, roughness=0.85, variation=0.1, scale=30.0)
    ochre = plaster_material("ochre", OCHRE, roughness=0.9, variation=0.08, scale=8.0)
    terracotta = roof_material("terracotta", TERRACOTTA)
    stone = plaster_material("stone", STONE, roughness=0.85, variation=0.06, scale=10.0)
    wood = material("wood", WOOD, roughness=0.85)

    add_box("field", (-0.15, -0.15, 0.02), (1.6, 1.6, 0.04), soil)
    for index in range(8):
        y = -0.85 + index * 0.2
        add_box("row", (-0.2, y, 0.09), (1.3, 0.1, 0.1), crop)

    add_wall("wall_south", (-0.15, -0.98, 0.09), 1.66, 0.18, 0.06, stone, along_x=True)
    add_wall("wall_west", (-0.98, -0.15, 0.09), 1.66, 0.18, 0.06, stone, along_x=False)

    hx, hy = 0.62, 0.62
    half = 0.28
    wall_h = 0.4
    add_box("hut_wall", (hx, hy, wall_h / 2), (half * 2, half * 2, wall_h), ochre)
    add_hip_roof("hut_roof", (hx, hy, wall_h + 0.09), half + 0.04, 0.18, terracotta, ridge_half=0.07)
    add_door(half, 0.26, wood, (hx, hy))
    add_window_row(half, 0.24, (0.1, 0.1), (hx, hy))

    return {"kind": "wheatFarm", "variant": 0, "footprint": 2, "height": 0.75}


def build_granary():
    """Stone base, whitewashed walls, a big terracotta roof, storage jars, loading door."""
    stone = plaster_material("stone", STONE, roughness=0.8, variation=0.06, scale=10.0)
    whitewash = plaster_material("whitewash", WHITEWASH, roughness=0.85, variation=0.05, scale=6.0)
    terracotta = roof_material("terracotta", TERRACOTTA)
    wood = material("wood", WOOD, roughness=0.8)
    clay = material("clay", CLAY, roughness=0.8)
    vent = material("vent", (0.08, 0.06, 0.05), roughness=0.6)

    half = 0.66
    wall_h = 0.7
    add_box("base", (0, 0, 0.06), (1.8, 1.8, 0.12), stone)
    add_box("walls", (0, 0, 0.12 + wall_h / 2), (half * 2, half * 2, wall_h), whitewash)
    add_box("cornice", (0, 0, 0.12 + wall_h + 0.02), (half * 2 + 0.08, half * 2 + 0.08, 0.04), stone)
    roof_z = 0.12 + wall_h + 0.04
    roof_h = 0.34
    add_hip_roof("roof", (0, 0, roof_z + roof_h / 2), half + 0.08, roof_h, terracotta, ridge_half=0.2)
    add_box("ridge", (0, 0, roof_z + roof_h + 0.01), (0.42, 0.06, 0.04), terracotta)

    add_box("loading_door", (half - 0.01, 0, 0.12 + 0.22), (0.05, 0.36, 0.44), wood)
    for y in (-0.4, 0.4):
        add_box("vent", (-half + 0.01, y, 0.12 + 0.5), (0.05, 0.14, 0.16), vent)
        add_box("vent", (y, -half + 0.01, 0.12 + 0.5), (0.14, 0.05, 0.16), vent)

    add_amphora("jar1", (0.84, -0.5, 0.12), 0.3, clay)
    add_amphora("jar2", (0.84, 0.55, 0.12), 0.26, clay)
    add_box("jar_step", (0.84, 0.0, 0.06), (0.3, 1.5, 0.12), stone)

    return {"kind": "granary", "variant": 0, "footprint": 2, "height": roof_z + roof_h + 0.1}


def build_agora():
    """Paved market square: colonnade along two sides, three awninged stalls, jars."""
    paving = plaster_material("paving", STONE, roughness=0.9, variation=0.05, scale=14.0)
    marble = material("marble", MARBLE, roughness=0.35)
    whitewash = plaster_material("whitewash", WHITEWASH, roughness=0.85, variation=0.05, scale=6.0)
    terracotta = roof_material("terracotta", TERRACOTTA)
    awning = plaster_material("awning", TERRACOTTA_LIGHT, roughness=0.9, variation=0.08, scale=8.0)
    wood = material("wood", WOOD, roughness=0.85)
    clay = material("clay", CLAY, roughness=0.8)

    half = 1.44
    add_box("paving", (0, 0, 0.03), (half * 2, half * 2, 0.06), paving)
    add_box("kerb", (0, 0, 0.02), (half * 2 + 0.06, half * 2 + 0.06, 0.04), marble)

    for y in (-1.0, -0.34, 0.32, 0.98):
        add_cylinder("colonnade", (-half + 0.18, y, 0.06 + 0.3), 0.05, 0.6, marble, vertices=14)
        add_box("colonnade_cap", (-half + 0.18, y, 0.06 + 0.62), (0.13, 0.13, 0.04), marble)
    add_box("colonnade_roof", (-half + 0.18, 0, 0.06 + 0.68), (0.34, half * 2, 0.06), marble)

    stall_half = 0.3
    for index, y in enumerate((-0.86, 0.0, 0.86)):
        x = half - 0.52
        add_box(f"stall_{index}", (x, y, 0.06 + 0.22), (stall_half * 2, stall_half * 2, 0.44), whitewash)
        add_box(f"counter_{index}", (x - stall_half - 0.1, y, 0.06 + 0.2), (0.22, stall_half * 2, 0.1), wood)
        add_hip_roof(f"awning_{index}", (x, y, 0.06 + 0.52), stall_half + 0.12, 0.16, awning, ridge_half=0.06)

    add_box("notice_board", (-0.2, -half + 0.16, 0.06 + 0.24), (0.4, 0.06, 0.36), wood)
    add_hip_roof("gate_roof", (half - 1.5, half - 0.2, 0.06 + 0.5), 0.34, 0.2, terracotta, ridge_half=0.08)
    add_amphora("jar1", (0.1, -0.9, 0.06), 0.34, clay)
    add_amphora("jar2", (-0.5, 1.0, 0.06), 0.3, clay)

    return {"kind": "agora", "variant": 0, "footprint": 3, "height": 0.9}


def build_college():
    """Teaching court: colonnaded hall around a paved yard with benches and a stele."""
    paving = plaster_material("paving", STONE, roughness=0.9, variation=0.05, scale=14.0)
    whitewash = plaster_material("whitewash", WHITEWASH, roughness=0.85, variation=0.05, scale=6.0)
    marble = material("marble", MARBLE, roughness=0.32)
    terracotta = roof_material("terracotta", TERRACOTTA)
    wood = material("wood", WOOD, roughness=0.85)
    cypress = material("cypress", CYPRESS, roughness=0.9)
    clay = material("clay", CLAY, roughness=0.8)

    half = 1.44
    add_box("paving", (0, 0, 0.03), (half * 2, half * 2, 0.06), paving)
    add_box("kerb", (0, 0, 0.02), (half * 2 + 0.06, half * 2 + 0.06, 0.04), marble)

    hall_half = 0.62
    wall_h = 0.72
    hx, hy = -0.72, -0.72
    add_box("hall", (hx, hy, 0.06 + wall_h / 2), (hall_half * 2, hall_half * 2, wall_h), whitewash)
    add_box("hall_cornice", (hx, hy, 0.06 + wall_h + 0.02), (hall_half * 2 + 0.07, hall_half * 2 + 0.07, 0.04), marble)
    add_hip_roof("hall_roof", (hx, hy, 0.06 + wall_h + 0.18), hall_half + 0.09, 0.28, terracotta, ridge_half=0.18)
    add_door(hall_half, 0.34, wood, (hx, hy))
    add_window_row(hall_half, 0.34, (0.12, 0.16), (hx, hy))

    for y in (-0.9, -0.3, 0.3, 0.9):
        add_cylinder("column", (half - 0.24, y, 0.06 + 0.32), 0.05, 0.64, marble, vertices=14)
        add_box("capital", (half - 0.24, y, 0.06 + 0.66), (0.13, 0.13, 0.04), marble)
    add_box("stoa_roof", (half - 0.24, 0, 0.06 + 0.72), (0.36, half * 2 - 0.1, 0.07), marble)

    add_box("bench", (0.1, -half + 0.3, 0.06 + 0.09), (0.9, 0.18, 0.18), marble)
    add_box("stele", (-0.1, 0.86, 0.06 + 0.3), (0.16, 0.16, 0.6), marble)
    add_pyramid("stele_cap", (-0.1, 0.86, 0.06 + 0.66), 0.14, 0.12, marble, vertices=4)
    add_cypress_pot("cypress", (0.9, 0.9, 0.06), 0.4, clay, cypress)

    return {"kind": "college", "variant": 0, "footprint": 3, "height": 1.15}


def build_podium():
    """Speaker's platform: stepped marble dais, a lectern, two benches facing it."""
    marble = material("marble", MARBLE, roughness=0.32)
    stone = plaster_material("stone", STONE, roughness=0.85, variation=0.06, scale=10.0)
    wood = material("wood", WOOD, roughness=0.85)
    bronze = material("bronze", BRONZE, roughness=0.35, metallic=1.0)

    add_box("paving", (0, 0, 0.03), (1.7, 1.7, 0.06), stone)
    for step, (size, z) in enumerate(((1.0, 0.1), (0.8, 0.18), (0.6, 0.26))):
        add_box(f"step_{step}", (-0.28, -0.28, z), (size, size, 0.09), marble)

    add_cylinder("lectern", (-0.28, -0.28, 0.44), 0.09, 0.28, marble, vertices=14)
    add_box("lectern_top", (-0.28, -0.28, 0.6), (0.26, 0.2, 0.04), wood)
    add_cylinder("tripod", (0.52, 0.52, 0.24), 0.05, 0.36, bronze, vertices=10)
    add_cylinder("tripod_bowl", (0.52, 0.52, 0.44), 0.12, 0.08, bronze, vertices=16)

    for y in (-0.62, 0.5):
        add_box("bench", (0.56, y, 0.15), (0.22, 0.7, 0.14), marble)

    return {"kind": "podium", "variant": 0, "footprint": 2, "height": 0.7}


def build_maintenance_office():
    """Working yard: tiled shed, water butt, ladder against the wall, buckets and timber."""
    stone = plaster_material("stone", STONE, roughness=0.85, variation=0.06, scale=10.0)
    ochre = plaster_material("ochre", OCHRE, roughness=0.9, variation=0.08, scale=8.0)
    terracotta = roof_material("terracotta", TERRACOTTA)
    wood = material("wood", WOOD, roughness=0.85)
    clay = material("clay", CLAY, roughness=0.8)
    water = material("water", WATER_LIGHT, roughness=0.08)

    add_box("yard", (0, 0, 0.03), (1.7, 1.7, 0.06), stone)

    half = 0.42
    wall_h = 0.5
    hx, hy = -0.3, -0.3
    add_box("shed", (hx, hy, 0.06 + wall_h / 2), (half * 2, half * 2, wall_h), ochre)
    add_hip_roof("shed_roof", (hx, hy, 0.06 + wall_h + 0.11), half + 0.07, 0.22, terracotta, ridge_half=0.1)
    add_door(half, 0.3, wood, (hx, hy))

    for index, offset in enumerate((-0.12, 0.12)):
        add_box(f"ladder_rail_{index}", (hx + half + 0.04, hy + offset, 0.06 + 0.34), (0.04, 0.04, 0.68), wood)
    for step in range(4):
        add_box(f"ladder_rung_{step}", (hx + half + 0.04, hy, 0.14 + step * 0.16), (0.03, 0.24, 0.03), wood)

    add_cylinder("butt", (0.56, 0.5, 0.06 + 0.16), 0.22, 0.32, wood, vertices=18)
    add_cylinder("butt_water", (0.56, 0.5, 0.06 + 0.3), 0.19, 0.04, water, vertices=18)
    add_amphora("bucket", (0.2, 0.74, 0.06), 0.2, clay)
    add_box("timber", (0.5, -0.6, 0.12), (0.9, 0.22, 0.12), wood)

    return {"kind": "maintenanceOffice", "variant": 0, "footprint": 2, "height": 0.95}


def build_tax_office():
    """Civic hall on a stone plinth: portico, slate roof, strongbox and record jars."""
    stone = plaster_material("stone", STONE, roughness=0.8, variation=0.06, scale=10.0)
    whitewash = plaster_material("whitewash", WHITEWASH, roughness=0.85, variation=0.05, scale=6.0)
    slate = roof_material("slate", SLATE, rows_per_unit=16.0)
    marble = material("marble", MARBLE, roughness=0.35)
    wood = material("wood", WOOD, roughness=0.8)
    bronze = material("bronze", BRONZE, roughness=0.35, metallic=1.0)
    clay = material("clay", CLAY, roughness=0.8)

    half = 0.58
    wall_h = 0.62
    add_box("plinth", (0, 0, 0.05), (1.7, 1.7, 0.1), stone)
    add_box("walls", (0, 0, 0.1 + wall_h / 2), (half * 2, half * 2, wall_h), whitewash)
    add_box("cornice", (0, 0, 0.1 + wall_h + 0.02), (half * 2 + 0.07, half * 2 + 0.07, 0.04), marble)
    add_door(half, 0.36, wood)
    add_window_row(half, 0.34, (0.13, 0.16))

    roof_z = 0.1 + wall_h + 0.04
    roof_h = 0.26
    add_eaves("eaves", half + 0.09, roof_z, marble)
    add_hip_roof("roof", (0, 0, roof_z + roof_h / 2), half + 0.09, roof_h, slate, ridge_half=0.16)

    porch_x = half + 0.13
    for y in (-0.3, 0.0, 0.3):
        add_cylinder("column", (porch_x, y, 0.1 + 0.23), 0.045, 0.46, marble, vertices=14)
        add_box("capital", (porch_x, y, 0.1 + 0.47), (0.11, 0.11, 0.04), marble)
    add_box("portico", (porch_x, 0, 0.1 + 0.52), (0.3, half * 2 + 0.12, 0.06), marble)

    add_box("strongbox", (0.5, -half - 0.22, 0.22), (0.28, 0.22, 0.24), wood)
    add_box("strongbox_bands", (0.5, -half - 0.22, 0.28), (0.3, 0.24, 0.05), bronze)
    add_amphora("record_jar", (-half - 0.2, 0.44, 0.0), 0.3, clay)

    return {"kind": "taxOffice", "variant": 0, "footprint": 2, "height": roof_z + roof_h + 0.1}


def build_palace():
    """Palace: a colonnaded hall on a stepped marble terrace, flanked by wings and statues."""
    marble = material("marble", MARBLE, roughness=0.3)
    paving = plaster_material("paving", MARBLE, roughness=0.6, variation=0.03, scale=18.0)
    whitewash = plaster_material("whitewash", WHITEWASH, roughness=0.84, variation=0.04, scale=6.0)
    terracotta = roof_material("terracotta", TERRACOTTA, rows_per_unit=18.0)
    stone = plaster_material("stone", STONE, roughness=0.8, variation=0.05, scale=10.0)
    bronze = material("bronze", BRONZE, roughness=0.35, metallic=1.0)
    clay = material("clay", CLAY, roughness=0.8)
    cypress = material("cypress", CYPRESS, roughness=0.9)

    terrace = add_box("terrace", (0, 0, 0.03), (3.9, 3.9, 0.06), paving)
    terrace.visible_shadow = False
    for step, (size, z) in enumerate(((3.2, 0.11), (3.0, 0.19))):
        add_box(f"step_{step}", (-0.2, -0.2, z), (size, size, 0.08), marble)

    hall_half = 0.94
    hall_h = 1.5
    hx, hy = -0.5, -0.5
    base_z = 0.23
    add_box("stylobate", (hx, hy, base_z + 0.05), (hall_half * 2 + 0.34, hall_half * 2 + 0.34, 0.1), marble)
    add_box("hall", (hx, hy, base_z + 0.1 + hall_h / 2), (hall_half * 2, hall_half * 2, hall_h), whitewash)
    add_box("architrave", (hx, hy, base_z + 0.1 + hall_h + 0.04), (hall_half * 2 + 0.3, hall_half * 2 + 0.3, 0.09), marble)
    add_doorway(hall_half, 0.62, (hx, hy), width=0.5)
    add_window_row(hall_half, base_z + 1.0, (0.16, 0.24), (hx, hy), on_door_face=True)

    roof_z = base_z + 0.1 + hall_h + 0.09
    roof_h = 0.42
    add_hip_roof("hall_roof", (hx, hy, roof_z + roof_h / 2), hall_half + 0.2, roof_h, terracotta, ridge_half=0.3)
    add_box("ridge", (hx, hy, roof_z + roof_h + 0.02), (0.6, 0.09, 0.06), terracotta)
    add_cylinder("finial", (hx, hy, roof_z + roof_h + 0.12), 0.06, 0.2, bronze, vertices=10)

    for offset in (-0.72, -0.24, 0.24, 0.72):
        add_cylinder("column_east", (hx + hall_half + 0.24, hy + offset, base_z + 0.1 + 0.6), 0.07, 1.2, marble, vertices=16)
        add_box("capital_east", (hx + hall_half + 0.24, hy + offset, base_z + 0.1 + 1.22), (0.18, 0.18, 0.06), marble)
        add_cylinder("column_south", (hx + offset, hy - hall_half - 0.24, base_z + 0.1 + 0.6), 0.07, 1.2, marble, vertices=16)
        add_box("capital_south", (hx + offset, hy - hall_half - 0.24, base_z + 0.1 + 1.22), (0.18, 0.18, 0.06), marble)
    add_box("portico_east", (hx + hall_half + 0.24, hy, base_z + 1.36), (0.44, hall_half * 2 + 0.5, 0.1), marble)
    add_box("portico_south", (hx, hy - hall_half - 0.24, base_z + 1.36), (hall_half * 2 + 0.5, 0.44, 0.1), marble)

    wing_half = 0.52
    wing_h = 0.78
    for wx, wy in ((1.42, 0.9), (-0.9, 1.42)):
        add_box("wing", (wx, wy, 0.06 + wing_h / 2), (wing_half * 2, wing_half * 2, wing_h), whitewash)
        add_box("wing_cornice", (wx, wy, 0.06 + wing_h + 0.03), (wing_half * 2 + 0.12, wing_half * 2 + 0.12, 0.06), marble)
        add_hip_roof("wing_roof", (wx, wy, 0.06 + wing_h + 0.2), wing_half + 0.14, 0.26, terracotta, ridge_half=0.16)
        add_doorway(wing_half, 0.4, (wx, wy))

    for sx, sy in ((1.52, -1.5), (1.52, -0.62)):
        add_box("plinth", (sx, sy, 0.2), (0.26, 0.26, 0.28), marble)
        add_cylinder("statue", (sx, sy, 0.52), 0.07, 0.36, bronze, vertices=12)
    add_cylinder("brazier", (1.56, 0.24, 0.2), 0.09, 0.28, bronze, vertices=12)
    add_cylinder("brazier_bowl", (1.56, 0.24, 0.36), 0.17, 0.1, bronze, vertices=16)
    add_cypress_pot("cypress1", (-1.74, 0.7, 0.06), 0.5, clay, cypress)
    add_cypress_pot("cypress2", (0.24, 1.74, 0.06), 0.46, clay, cypress)
    add_amphora("jar", (-1.7, -0.4, 0.06), 0.34, clay)
    add_box("bench", (-1.74, -1.2, 0.16), (0.26, 0.8, 0.2), stone)

    return {"kind": "palace", "variant": 0, "footprint": 4, "height": roof_z + roof_h + 0.34}


def build_sanctuary(kind, god):
    """Sanctuary: a peristyle temple on a stepped platform inside a walled precinct,
    with an altar, and the god's own emblem in the yard."""
    paving = plaster_material("paving", STONE, roughness=0.88, variation=0.05, scale=14.0)
    marble = material("marble", MARBLE, roughness=0.3)
    whitewash = plaster_material("whitewash", WHITEWASH, roughness=0.84, variation=0.04, scale=6.0)
    roof_colour = god["roof"]
    tiles = roof_material("tiles", roof_colour, rows_per_unit=20.0)
    bronze = material("bronze", BRONZE, roughness=0.35, metallic=1.0)
    wood = material("wood", WOOD, roughness=0.85)
    clay = material("clay", CLAY, roughness=0.8)
    cypress = material("cypress", CYPRESS, roughness=0.9)

    half = 1.44
    yard = add_box("yard", (0, 0, 0.03), (half * 2, half * 2, 0.06), paving)
    yard.visible_shadow = False
    for side in (-1, 1):
        add_box("precinct_wall", (side * half, 0, 0.18), (0.1, half * 2, 0.24), whitewash)
        add_box("precinct_wall", (0, side * half, 0.18), (half * 2, 0.1, 0.24), whitewash)

    temple_half = 0.66
    wall_h = 0.78
    tx, ty = -0.36, -0.36
    for step, (size, z) in enumerate(((temple_half * 2 + 0.52, 0.09), (temple_half * 2 + 0.34, 0.17))):
        add_box(f"step_{step}", (tx, ty, z), (size, size, 0.08), marble)

    add_box("cella", (tx, ty, 0.21 + wall_h / 2), (temple_half * 2, temple_half * 2, wall_h), whitewash)
    add_box("architrave", (tx, ty, 0.21 + wall_h + 0.04), (temple_half * 2 + 0.42, temple_half * 2 + 0.42, 0.09), marble)
    add_doorway(temple_half, 0.5, (tx, ty), width=0.34)

    for offset in (-0.52, 0, 0.52):
        add_cylinder("column_east", (tx + temple_half + 0.2, ty + offset, 0.21 + wall_h / 2), 0.07, wall_h, marble, vertices=16)
        add_cylinder("column_south", (tx + offset, ty - temple_half - 0.2, 0.21 + wall_h / 2), 0.07, wall_h, marble, vertices=16)

    roof_z = 0.21 + wall_h + 0.09
    add_hip_roof("roof", (tx, ty, roof_z + 0.19), temple_half + 0.28, 0.38, tiles, ridge_half=0.2)
    add_cylinder("finial", (tx, ty, roof_z + 0.44), 0.05, 0.18, bronze, vertices=10)

    add_box("altar", (0.74, 0.74, 0.06 + 0.16), (0.42, 0.42, 0.32), marble)
    add_box("altar_cap", (0.74, 0.74, 0.06 + 0.34), (0.5, 0.5, 0.05), marble)
    add_cylinder("flame", (0.74, 0.74, 0.06 + 0.42), 0.08, 0.12, bronze, vertices=10)

    god["emblem"](marble, bronze, wood, clay, cypress)

    return {"kind": kind, "variant": 0, "footprint": 3, "height": roof_z + 0.6}


def zeus_emblem(marble, bronze, wood, clay, cypress):
    add_box("altar_stone", (1.0, -0.9, 0.06 + 0.24), (0.5, 0.5, 0.48), marble)
    add_cylinder("thunderbolt", (1.0, -0.9, 0.06 + 0.62), 0.07, 0.28, bronze, vertices=8)
    add_box("bolt_wing", (1.0, -0.9, 0.06 + 0.66), (0.42, 0.08, 0.06), bronze)
    add_cypress_pot("cypress", (-1.06, 1.06, 0.06), 0.46, clay, cypress)


def poseidon_emblem(marble, bronze, wood, clay, cypress):
    add_cylinder("trident_shaft", (1.0, -0.9, 0.06 + 0.45), 0.05, 0.9, bronze, vertices=8)
    add_box("trident_head", (1.0, -0.9, 0.06 + 0.88), (0.06, 0.34, 0.06), bronze)
    for prong in (-0.14, 0.0, 0.14):
        add_cylinder("prong", (1.0, -0.9 + prong, 0.06 + 1.0), 0.025, 0.22, bronze, vertices=6)
    add_box("basin", (-1.04, 1.0, 0.06 + 0.08), (0.7, 0.7, 0.16), marble)
    add_box("water", (-1.04, 1.0, 0.06 + 0.15), (0.56, 0.56, 0.04), material("sea", hex_rgb("6fa8bd"), roughness=0.15))


def athena_emblem(marble, bronze, wood, clay, cypress):
    add_cylinder("olive_trunk", (1.02, -0.94, 0.06 + 0.22), 0.07, 0.44, wood, vertices=8)
    add_pyramid("olive_crown", (1.02, -0.94, 0.06 + 0.62), 0.36, 0.42, material("olive", (0.36, 0.44, 0.26), roughness=0.9), vertices=7)
    add_cylinder("shield", (-1.02, 1.0, 0.06 + 0.3), 0.26, 0.07, bronze, vertices=18)
    add_cylinder("shield_post", (-1.02, 1.0, 0.06 + 0.14), 0.05, 0.28, wood, vertices=6)


def artemis_emblem(marble, bronze, wood, clay, cypress):
    for post_x, post_y in ((0.72, -1.16), (1.3, -1.16), (0.72, -0.6), (1.3, -0.6)):
        add_cylinder("pen_post", (post_x, post_y, 0.06 + 0.16), 0.03, 0.32, wood, vertices=6)
    add_box("pen_rail", (1.01, -1.16, 0.06 + 0.26), (0.62, 0.04, 0.05), wood)
    add_box("pen_rail", (1.01, -0.6, 0.06 + 0.26), (0.62, 0.04, 0.05), wood)
    add_box("deer", (1.0, -0.86, 0.06 + 0.16), (0.3, 0.14, 0.2), material("hide", hex_rgb("a97a4c"), roughness=0.9))
    add_cypress_pot("cypress", (-1.04, 1.02, 0.06), 0.5, clay, cypress)


def apollo_emblem(marble, bronze, wood, clay, cypress):
    add_box("tripod_base", (1.0, -0.92, 0.06 + 0.06), (0.44, 0.44, 0.12), marble)
    for leg in ((-0.12, -0.12), (0.12, -0.12), (0.0, 0.14)):
        add_cylinder("tripod_leg", (1.0 + leg[0], -0.92 + leg[1], 0.06 + 0.32), 0.03, 0.4, bronze, vertices=8)
    add_cylinder("omphalos", (1.0, -0.92, 0.06 + 0.6), 0.18, 0.24, marble, vertices=16)
    add_cylinder("laurel", (-1.02, 1.0, 0.06 + 0.24), 0.06, 0.48, wood, vertices=6)
    add_pyramid("laurel_crown", (-1.02, 1.0, 0.06 + 0.6), 0.3, 0.34, material("laurel", (0.34, 0.46, 0.28), roughness=0.9), vertices=7)


def ares_emblem(marble, bronze, wood, clay, cypress):
    add_box("trophy_post", (1.0, -0.94, 0.06 + 0.44), (0.1, 0.1, 0.88), wood)
    add_box("trophy_arms", (1.0, -0.94, 0.06 + 0.74), (0.56, 0.12, 0.12), bronze)
    add_cylinder("trophy_helm", (1.0, -0.94, 0.06 + 0.94), 0.13, 0.18, bronze, vertices=14)
    for spear_x in (-1.08, -0.96):
        add_cylinder("spear", (spear_x, 1.0, 0.06 + 0.42), 0.022, 0.84, wood, vertices=6)


def aphrodite_emblem(marble, bronze, wood, clay, cypress):
    add_box("pool_kerb", (1.0, -0.9, 0.06 + 0.06), (0.86, 0.7, 0.12), marble)
    add_box("pool", (1.0, -0.9, 0.06 + 0.12), (0.7, 0.54, 0.05), material("water", hex_rgb("7fb6c8"), roughness=0.12))
    add_cylinder("statue_plinth", (-1.02, 1.0, 0.06 + 0.18), 0.16, 0.36, marble, vertices=12)
    add_cylinder("statue", (-1.02, 1.0, 0.06 + 0.54), 0.09, 0.36, marble, vertices=12)
    add_cypress_pot("myrtle", (0.2, 1.06, 0.06), 0.42, clay, cypress)


def dionysus_emblem(marble, bronze, wood, clay, cypress):
    vine = material("vine", (0.28, 0.4, 0.2), roughness=0.9)
    grape = material("grape", hex_rgb("6b3a63"), roughness=0.75)
    add_pergola("arbour", 1.0, -0.9, 0.06, 0.24, 0.8, 0.5, wood)
    for leaf_y in (-1.2, -0.9, -0.6):
        add_box("vine_leaf", (1.0, leaf_y, 0.06 + 0.54), (0.5, 0.24, 0.12), vine)
        add_cylinder("bunch", (1.0, leaf_y, 0.06 + 0.44), 0.06, 0.12, grape, vertices=8)
    add_amphora("wine_jar", (-1.0, 1.0, 0.06), 0.42, clay)
    add_amphora("wine_jar2", (-0.6, 1.1, 0.06), 0.34, clay)


def demeter_emblem(marble, bronze, wood, clay, cypress):
    for x, y in ((1.0, -0.6), (0.6, -1.0), (1.1, -1.1)):
        add_cylinder("sheaf", (x, y, 0.06 + 0.18), 0.09, 0.36, material("wheat", STRAW, roughness=0.9), vertices=8)
    add_cypress_pot("cypress", (-1.06, 1.06, 0.06), 0.44, clay, cypress)


def hephaestus_emblem(marble, bronze, wood, clay, cypress):
    add_box("anvil", (1.0, -0.86, 0.06 + 0.12), (0.34, 0.2, 0.24), bronze)
    add_box("anvil_horn", (1.24, -0.86, 0.06 + 0.2), (0.16, 0.1, 0.08), bronze)
    add_cylinder("forge", (-1.0, 1.0, 0.06 + 0.2), 0.24, 0.4, material("brick", CLAY, roughness=0.9), vertices=12)
    add_cylinder("smoke_hood", (-1.0, 1.0, 0.06 + 0.48), 0.1, 0.2, bronze, vertices=10)


def hermes_emblem(marble, bronze, wood, clay, cypress):
    add_box("herm", (1.02, -0.9, 0.06 + 0.3), (0.2, 0.2, 0.6), marble)
    add_box("herm_head", (1.02, -0.9, 0.06 + 0.66), (0.16, 0.16, 0.14), marble)
    add_cylinder("milestone", (-1.04, 0.96, 0.06 + 0.16), 0.11, 0.32, marble, vertices=12)
    add_cypress_pot("cypress", (-1.0, -1.0, 0.06), 0.4, clay, cypress)


def hades_emblem(marble, bronze, wood, clay, cypress):
    add_box("shaft_kerb", (0.96, -0.96, 0.06 + 0.08), (0.68, 0.68, 0.16), marble)
    add_box("shaft", (0.96, -0.96, 0.06 + 0.15), (0.46, 0.46, 0.06), material("dark", SHADOW_DARK, roughness=0.95))
    for x, y in ((-1.06, 1.06), (-1.06, 0.5)):
        add_cylinder("post", (x, y, 0.06 + 0.24), 0.06, 0.48, wood, vertices=8)
    add_box("lintel", (-1.06, 0.78, 0.06 + 0.5), (0.14, 0.72, 0.08), wood)


SANCTUARIES = {
    "sanctuary-zeus": {"roof": hex_rgb("c8642e"), "emblem": zeus_emblem},
    "sanctuary-poseidon": {"roof": hex_rgb("a8552f"), "emblem": poseidon_emblem},
    "sanctuary-athena": {"roof": hex_rgb("c45f34"), "emblem": athena_emblem},
    "sanctuary-artemis": {"roof": hex_rgb("a85a30"), "emblem": artemis_emblem},
    "sanctuary-apollo": {"roof": hex_rgb("d0703a"), "emblem": apollo_emblem},
    "sanctuary-ares": {"roof": hex_rgb("9c3f28"), "emblem": ares_emblem},
    "sanctuary-aphrodite": {"roof": hex_rgb("d07a4a"), "emblem": aphrodite_emblem},
    "sanctuary-dionysus": {"roof": hex_rgb("a04a3a"), "emblem": dionysus_emblem},
    "sanctuary-demeter": {"roof": hex_rgb("b8502c"), "emblem": demeter_emblem},
    "sanctuary-hephaestus": {"roof": hex_rgb("8f4526"), "emblem": hephaestus_emblem},
    "sanctuary-hermes": {"roof": hex_rgb("c0603a"), "emblem": hermes_emblem},
    "sanctuary-hades": {"roof": hex_rgb("7c4030"), "emblem": hades_emblem},
}


def sanctuary_builder(name, god):
    kind = "".join(part.capitalize() if index else part for index, part in enumerate(name.split("-")))
    return lambda: build_sanctuary(kind, god)


def build_trading_post():
    """Trading post: a walled yard of crates and jars under awnings, with a weighing beam."""
    earth = plaster_material("earth", EARTH, roughness=0.97, variation=0.09, scale=16.0)
    plaster = plaster_material("plaster", WHITEWASH, roughness=0.85, variation=0.05, scale=7.0)
    tiles = roof_material("tiles", TERRACOTTA, rows_per_unit=20.0)
    canvas = plaster_material("canvas", hex_rgb("d9cba4"), roughness=0.95, variation=0.07, scale=9.0)
    wood = material("wood", WOOD, roughness=0.86)
    crate = material("crate", hex_rgb("8a6134"), roughness=0.9)
    clay = material("clay", CLAY, roughness=0.8)
    bronze = material("bronze", BRONZE, roughness=0.35, metallic=1.0)

    half = 0.94
    yard = add_box("yard", (0, 0, 0.03), (half * 2, half * 2, 0.06), earth)
    yard.visible_shadow = False
    for side in (-1, 1):
        add_box("yard_wall", (side * half, 0, 0.16), (0.08, half * 2, 0.2), plaster)
        add_box("yard_wall", (0, side * half, 0.16), (half * 2, 0.08, 0.2), plaster)

    office_half = 0.42
    wall_h = 0.56
    ox, oy = -0.42, -0.42
    add_box("office", (ox, oy, 0.06 + wall_h / 2), (office_half * 2, office_half * 2, wall_h), plaster)
    add_hip_roof("office_roof", (ox, oy, 0.06 + wall_h + 0.13), office_half + 0.12, 0.26, tiles, ridge_half=0.12)
    add_doorway(office_half, 0.36, (ox, oy))

    add_box("awning", (0.46, 0.2, 0.06 + 0.52), (0.72, 0.9, 0.04), canvas)
    for cx, cy in ((0.14, -0.22), (0.78, -0.22), (0.14, 0.62), (0.78, 0.62)):
        add_cylinder("awning_post", (cx, cy, 0.06 + 0.26), 0.022, 0.52, wood, vertices=6)

    for cx, cy, cz, size in ((0.4, 0.06, 0.06, 0.28), (0.72, 0.3, 0.06, 0.24), (0.4, 0.06, 0.34, 0.22)):
        add_box("crate", (cx, cy, cz + size / 2), (size, size, size), crate)
    add_amphora("jar1", (0.28, 0.62, 0.06), 0.3, clay)
    add_amphora("jar2", (0.52, 0.72, 0.06), 0.26, clay)
    add_amphora("jar3", (-0.2, 0.74, 0.06), 0.28, clay)

    add_cylinder("scale_post", (-0.66, 0.58, 0.06 + 0.3), 0.03, 0.6, wood, vertices=8)
    add_box("scale_beam", (-0.66, 0.58, 0.06 + 0.6), (0.06, 0.5, 0.04), wood)
    for pan in (-0.22, 0.22):
        add_cylinder("scale_pan", (-0.66, 0.58 + pan, 0.06 + 0.5), 0.09, 0.03, bronze, vertices=12)

    return {"kind": "tradingPost", "variant": 0, "footprint": 2, "height": 0.95}


def build_estate(tier):
    """Elite housing on a 4-tile plot: a colonnaded villa around a court, growing
    from a walled residence to an estate with gardens, stoa and stables."""
    paving = plaster_material("paving", STONE, roughness=0.86, variation=0.05, scale=15.0)
    garden = plaster_material("garden", hex_rgb("9aa861"), roughness=0.96, variation=0.1, scale=13.0)
    whitewash = plaster_material("whitewash", WHITEWASH, roughness=0.84, variation=0.04, scale=7.0)
    marble = material("marble", MARBLE, roughness=0.3)
    tiles = roof_material("tiles", TERRACOTTA, rows_per_unit=20.0)
    tiles_light = roof_material("tiles_light", TERRACOTTA_LIGHT, rows_per_unit=20.0)
    wood = material("wood", WOOD, roughness=0.86)
    clay = material("clay", CLAY, roughness=0.8)
    cypress = material("cypress", CYPRESS, roughness=0.9)
    water = material("water", hex_rgb("6fa8bd"), roughness=0.1)

    half = 1.92
    yard = add_box("plot", (0, 0, 0.03), (half * 2, half * 2, 0.06), paving)
    yard.visible_shadow = False
    for side in (-1, 1):
        add_box("plot_wall", (side * half, 0, 0.16), (0.1, half * 2, 0.2), whitewash)
        add_box("plot_wall", (0, side * half, 0.16), (half * 2, 0.1, 0.2), whitewash)

    villa_half = 0.8 + tier * 0.1
    wall_h = 0.86 + tier * 0.08
    vx, vy = -0.7, -0.7
    add_box("stylobate", (vx, vy, 0.09), (villa_half * 2 + 0.3, villa_half * 2 + 0.3, 0.12), marble)
    add_box("villa", (vx, vy, 0.15 + wall_h / 2), (villa_half * 2, villa_half * 2, wall_h), whitewash)
    add_box("cornice", (vx, vy, 0.15 + wall_h + 0.03), (villa_half * 2 + 0.16, villa_half * 2 + 0.16, 0.07), marble)
    add_doorway(villa_half, 0.54, (vx, vy), width=0.4)
    add_window_row(villa_half, 0.15 + wall_h * 0.6, (0.16, 0.22), (vx, vy), on_door_face=True)

    roof_z = 0.15 + wall_h + 0.07
    roof_h = 0.34 + tier * 0.04
    add_hip_roof("roof", (vx, vy, roof_z + roof_h / 2), villa_half + 0.16, roof_h, tiles, ridge_half=0.24)

    if tier >= 1:
        for offset in (-0.5, 0.1, 0.7):
            add_cylinder("column", (vx + villa_half + 0.26, vy + offset, 0.15 + wall_h / 2), 0.06, wall_h, marble, vertices=14)
        add_box("porch", (vx + villa_half + 0.26, vy + 0.1, 0.15 + wall_h + 0.04), (0.5, 1.5, 0.08), marble)
        add_cypress_pot("cypress1", (1.5, -1.5, 0.06), 0.5, clay, cypress)

    if tier >= 2:
        wing_half = 0.5
        add_box("wing", (1.1, 0.9, 0.06 + 0.36), (wing_half * 2, wing_half * 2, 0.72), whitewash)
        add_hip_roof("wing_roof", (1.1, 0.9, 0.06 + 0.86), wing_half + 0.12, 0.26, tiles_light, ridge_half=0.14)
        add_box("pool_kerb", (-1.2, 1.1, 0.06 + 0.05), (1.1, 0.8, 0.1), marble)
        add_box("pool", (-1.2, 1.1, 0.06 + 0.09), (0.9, 0.6, 0.06), water)
        add_pergola("pergola", 1.5, -0.4, 0.06, 0.22, 0.9, 0.5, wood)

    if tier >= 3:
        add_box("garden", (-1.3, -1.3, 0.07), (1.1, 1.1, 0.03), garden)
        for gx, gy in ((-1.6, -1.6), (-1.0, -1.6), (-1.6, -1.0)):
            add_cypress_pot("garden_tree", (gx, gy, 0.09), 0.42, clay, cypress)
        for offset in (-0.6, 0.0, 0.6):
            add_cylinder("stoa_column", (offset, 1.6, 0.06 + 0.36), 0.055, 0.72, marble, vertices=14)
        add_box("stoa_roof", (0, 1.6, 0.06 + 0.76), (1.6, 0.42, 0.08), marble)
        add_box("stable", (1.55, 0.0, 0.06 + 0.3), (0.5, 0.9, 0.6), whitewash)
        add_shed_roof("stable_roof", (1.55, 0.0, 0.06 + 0.66), 0.32, 0.5, 0.06, tiles_light)

    add_amphora("jar", (0.4, -1.6, 0.06), 0.36, clay)

    return {"kind": "estate", "variant": tier, "footprint": 4, "height": roof_z + roof_h + 0.3}


def build_infirmary():
    """Infirmary: a colonnaded ward round a herb court, with beds under an awning."""
    paving = plaster_material("paving", STONE, roughness=0.88, variation=0.05, scale=14.0)
    whitewash = plaster_material("whitewash", WHITEWASH, roughness=0.84, variation=0.04, scale=7.0)
    marble = material("marble", MARBLE, roughness=0.3)
    tiles = roof_material("tiles", TERRACOTTA, rows_per_unit=20.0)
    canvas = plaster_material("canvas", hex_rgb("efe7d2"), roughness=0.95, variation=0.06, scale=9.0)
    herb = material("herb", hex_rgb("6f8a4a"), roughness=0.9)
    wood = material("wood", WOOD, roughness=0.86)
    clay = material("clay", CLAY, roughness=0.8)

    half = 1.44
    yard = add_box("yard", (0, 0, 0.03), (half * 2, half * 2, 0.06), paving)
    yard.visible_shadow = False

    ward_half = 0.68
    wall_h = 0.7
    wx, wy = -0.6, -0.6
    add_box("ward", (wx, wy, 0.06 + wall_h / 2), (ward_half * 2, ward_half * 2, wall_h), whitewash)
    add_box("cornice", (wx, wy, 0.06 + wall_h + 0.03), (ward_half * 2 + 0.12, ward_half * 2 + 0.12, 0.06), marble)
    add_hip_roof("roof", (wx, wy, 0.06 + wall_h + 0.2), ward_half + 0.14, 0.3, tiles, ridge_half=0.18)
    add_doorway(ward_half, 0.42, (wx, wy))
    add_window_row(ward_half, 0.52, (0.14, 0.2), (wx, wy), on_door_face=True)

    add_box("awning", (0.68, 0.3, 0.06 + 0.5), (0.9, 1.2, 0.04), canvas)
    for cx, cy in ((0.28, -0.24), (1.08, -0.24), (0.28, 0.84), (1.08, 0.84)):
        add_cylinder("awning_post", (cx, cy, 0.06 + 0.25), 0.022, 0.5, wood, vertices=6)
    for by in (-0.02, 0.5):
        add_box("bed", (0.68, by, 0.06 + 0.09), (0.62, 0.28, 0.18), whitewash)

    add_box("herb_bed", (-1.0, 1.0, 0.07), (0.72, 0.72, 0.04), herb)
    add_amphora("jar", (0.9, -1.0, 0.06), 0.32, clay)
    add_box("basin", (-1.06, -0.2, 0.06 + 0.14), (0.36, 0.36, 0.28), marble)

    return {"kind": "infirmary", "variant": 0, "footprint": 3, "height": 1.1}


def build_watchpost():
    """Watchpost: a squat tower with a brazier and a rack of spears."""
    earth = plaster_material("earth", EARTH, roughness=0.96, variation=0.08, scale=15.0)
    plaster = plaster_material("plaster", hex_rgb("d8cdb4"), roughness=0.86, variation=0.05, scale=8.0)
    stone = plaster_material("stone", STONE, roughness=0.88, variation=0.06, scale=11.0)
    tiles = roof_material("tiles", hex_rgb("8f4526"), rows_per_unit=18.0)
    wood = material("wood", WOOD, roughness=0.86)
    bronze = material("bronze", BRONZE, roughness=0.35, metallic=1.0)

    half = 0.94
    yard = add_box("yard", (0, 0, 0.03), (half * 2, half * 2, 0.06), earth)
    yard.visible_shadow = False

    tower_half = 0.4
    tower_h = 1.0
    tx, ty = -0.32, -0.32
    add_box("base", (tx, ty, 0.11), (tower_half * 2 + 0.16, tower_half * 2 + 0.16, 0.1), stone)
    add_box("tower", (tx, ty, 0.16 + tower_h / 2), (tower_half * 2, tower_half * 2, tower_h), plaster)
    add_doorway(tower_half, 0.4, (tx, ty))
    add_box("gallery", (tx, ty, 0.16 + tower_h + 0.05), (tower_half * 2 + 0.24, tower_half * 2 + 0.24, 0.1), wood)
    add_hip_roof("roof", (tx, ty, 0.16 + tower_h + 0.24), tower_half + 0.18, 0.28, tiles, ridge_half=0.1)

    add_cylinder("brazier", (0.62, 0.5, 0.06 + 0.18), 0.08, 0.36, bronze, vertices=10)
    add_cylinder("brazier_bowl", (0.62, 0.5, 0.06 + 0.38), 0.16, 0.1, bronze, vertices=14)
    for offset in (-0.1, 0.0, 0.1):
        add_cylinder("spear", (0.66 + offset, -0.5, 0.06 + 0.34), 0.018, 0.68, wood, vertices=6)
    add_box("rack", (0.66, -0.5, 0.06 + 0.2), (0.34, 0.08, 0.06), wood)

    return {"kind": "watchpost", "variant": 0, "footprint": 2, "height": 1.5}


def build_hero_hall():
    """Hero hall: a peripteral hall on a stepped terrace, with a trophy of arms and a
    victor's tripod in the court."""
    paving = plaster_material("paving", STONE, roughness=0.86, variation=0.05, scale=15.0)
    marble = material("marble", MARBLE, roughness=0.3)
    whitewash = plaster_material("whitewash", WHITEWASH, roughness=0.84, variation=0.04, scale=7.0)
    tiles = roof_material("tiles", TERRACOTTA, rows_per_unit=20.0)
    bronze = material("bronze", BRONZE, roughness=0.35, metallic=1.0)
    wood = material("wood", WOOD, roughness=0.86)
    clay = material("clay", CLAY, roughness=0.8)
    cypress = material("cypress", CYPRESS, roughness=0.9)

    half = 1.92
    yard = add_box("court", (0, 0, 0.03), (half * 2, half * 2, 0.06), paving)
    yard.visible_shadow = False
    for side in (-1, 1):
        add_box("court_wall", (side * half, 0, 0.16), (0.1, half * 2, 0.2), whitewash)
        add_box("court_wall", (0, side * half, 0.16), (half * 2, 0.1, 0.2), whitewash)

    hall_half = 0.86
    wall_h = 1.14
    hx, hy = -0.55, -0.55
    for step, (size, z) in enumerate(((hall_half * 2 + 0.62, 0.1), (hall_half * 2 + 0.44, 0.18))):
        add_box(f"step_{step}", (hx, hy, z), (size, size, 0.08), marble)
    add_box("cella", (hx, hy, 0.22 + wall_h / 2), (hall_half * 2, hall_half * 2, wall_h), whitewash)
    add_box("architrave", (hx, hy, 0.22 + wall_h + 0.05), (hall_half * 2 + 0.5, hall_half * 2 + 0.5, 0.1), marble)
    add_doorway(hall_half, 0.62, (hx, hy), width=0.42)

    for offset in (-0.62, -0.2, 0.22, 0.64):
        add_cylinder("column_east", (hx + hall_half + 0.24, hy + offset, 0.22 + wall_h / 2), 0.075, wall_h, marble, vertices=16)
        add_cylinder("column_south", (hx + offset, hy - hall_half - 0.24, 0.22 + wall_h / 2), 0.075, wall_h, marble, vertices=16)

    roof_z = 0.22 + wall_h + 0.1
    roof_h = 0.44
    add_hip_roof("roof", (hx, hy, roof_z + roof_h / 2), hall_half + 0.34, roof_h, tiles, ridge_half=0.26)
    add_cylinder("finial", (hx, hy, roof_z + roof_h + 0.1), 0.05, 0.2, bronze, vertices=10)

    add_box("trophy_post", (1.3, -1.2, 0.06 + 0.42), (0.1, 0.1, 0.84), wood)
    add_box("trophy_arms", (1.3, -1.2, 0.06 + 0.72), (0.6, 0.12, 0.12), bronze)
    add_cylinder("trophy_shield", (1.3, -1.2, 0.06 + 0.52), 0.24, 0.06, bronze, vertices=16)

    for leg in ((-0.1, -0.1), (0.1, -0.1), (0.0, 0.12)):
        add_cylinder("tripod_leg", (1.34 + leg[0], 0.9 + leg[1], 0.06 + 0.22), 0.025, 0.44, bronze, vertices=8)
    add_cylinder("tripod_bowl", (1.34, 0.9, 0.06 + 0.5), 0.22, 0.16, bronze, vertices=18)

    add_cypress_pot("cypress1", (-1.6, 1.6, 0.06), 0.52, clay, cypress)
    add_cypress_pot("cypress2", (0.3, 1.66, 0.06), 0.48, clay, cypress)
    add_amphora("jar", (-1.66, -0.2, 0.06), 0.36, clay)

    return {"kind": "heroHall", "variant": 0, "footprint": 4, "height": roof_z + roof_h + 0.36}


def build_tower():
    """Tower: a stone bastion on a plinth, battlemented, with a stair and a brazier."""
    stone = plaster_material("stone", STONE, roughness=0.86, variation=0.06, scale=12.0)
    ashlar = plaster_material("ashlar", hex_rgb("e4dcc4"), roughness=0.82, variation=0.05, scale=9.0)
    earth = plaster_material("earth", EARTH, roughness=0.96, variation=0.08, scale=15.0)
    tiles = roof_material("tiles", hex_rgb("8f4526"), rows_per_unit=18.0)
    wood = material("wood", WOOD, roughness=0.86)
    bronze = material("bronze", BRONZE, roughness=0.35, metallic=1.0)

    half = 0.94
    yard = add_box("yard", (0, 0, 0.03), (half * 2, half * 2, 0.06), earth)
    yard.visible_shadow = False

    tower_half = 0.52
    shaft_h = 1.5
    tx, ty = -0.2, -0.2
    add_box("plinth", (tx, ty, 0.12), (tower_half * 2 + 0.22, tower_half * 2 + 0.22, 0.12), stone)
    add_box("shaft", (tx, ty, 0.18 + shaft_h / 2), (tower_half * 2, tower_half * 2, shaft_h), ashlar)
    add_doorway(tower_half, 0.44, (tx, ty))
    add_window_row(tower_half, 0.9, (0.12, 0.2), (tx, ty), on_door_face=True)

    parapet_z = 0.18 + shaft_h
    add_box("corbel", (tx, ty, parapet_z + 0.05), (tower_half * 2 + 0.2, tower_half * 2 + 0.2, 0.1), stone)
    merlon = 0.14
    for step in (-3, -1, 1, 3):
        offset = step * (tower_half / 3)
        for side in (-1, 1):
            add_box("merlon", (tx + offset, ty + side * (tower_half + 0.08), parapet_z + 0.2), (merlon, 0.1, 0.2), ashlar)
            add_box("merlon", (tx + side * (tower_half + 0.08), ty + offset, parapet_z + 0.2), (0.1, merlon, 0.2), ashlar)

    add_shed_roof("hood", (tx, ty, parapet_z + 0.34), tower_half * 0.7, tower_half * 0.7, 0.06, tiles)
    add_cylinder("brazier", (0.66, 0.6, 0.06 + 0.2), 0.08, 0.4, bronze, vertices=10)
    add_cylinder("brazier_bowl", (0.66, 0.6, 0.06 + 0.42), 0.16, 0.1, bronze, vertices=14)
    for step in range(3):
        add_box("stair", (tx + tower_half + 0.2, ty - 0.5 + step * 0.16, 0.06 + 0.05 + step * 0.09), (0.34, 0.16, 0.1 + step * 0.16), wood)

    return {"kind": "tower", "variant": 0, "footprint": 2, "height": parapet_z + 0.5}


def build_vineyard():
    """Vineyard: trellised rows of vines on the meadow, with a picker's hut and baskets."""
    soil = plaster_material("soil", SOIL, roughness=0.98, variation=0.1, scale=12.0)
    grass = plaster_material("vine_grass", (0.45, 0.47, 0.26), roughness=0.95, variation=0.12, scale=14.0)
    stone = plaster_material("stone", STONE, roughness=0.85, variation=0.06, scale=10.0)
    ochre = plaster_material("ochre", OCHRE, roughness=0.9, variation=0.08, scale=8.0)
    terracotta = roof_material("terracotta", TERRACOTTA)
    wood = material("wood", WOOD, roughness=0.86)
    vine = material("vine", (0.28, 0.4, 0.2), roughness=0.9)
    grape = material("grape", hex_rgb("6b3a63"), roughness=0.75)
    clay = material("clay", CLAY, roughness=0.8)

    add_box("ground", (-0.1, -0.1, 0.02), (1.7, 1.7, 0.04), grass)
    add_wall("wall_south", (-0.1, -0.96, 0.09), 1.7, 0.18, 0.06, stone, along_x=True)

    for row, x in enumerate((-0.66, -0.16, 0.34)):
        add_box(f"bed_{row}", (x, -0.1, 0.05), (0.2, 1.4, 0.03), soil)
        for post_y in (-0.66, 0.0, 0.66):
            add_cylinder(f"post_{row}{post_y}", (x, post_y, 0.2), 0.022, 0.32, wood, vertices=6)
        add_box(f"wire_{row}", (x, -0.1, 0.34), (0.03, 1.4, 0.02), wood)
        for leaf_y in (-0.62, -0.28, 0.06, 0.4, 0.7):
            add_box(f"vine_{row}{leaf_y}", (x, leaf_y, 0.28), (0.22, 0.24, 0.2), vine)
            add_cylinder(f"bunch_{row}{leaf_y}", (x + 0.1, leaf_y, 0.2), 0.05, 0.1, grape, vertices=8)

    hx, hy = 0.68, 0.66
    half = 0.26
    wall_h = 0.36
    add_box("hut_wall", (hx, hy, wall_h / 2), (half * 2, half * 2, wall_h), ochre)
    add_hip_roof("hut_roof", (hx, hy, wall_h + 0.09), half + 0.05, 0.18, terracotta, ridge_half=0.07)
    add_door(half, 0.22, wood, (hx, hy))
    add_amphora("basket", (0.72, -0.3, 0.04), 0.24, clay)

    return {"kind": "vineyard", "variant": 0, "footprint": 2, "height": 0.75}


def build_winery():
    """Winery: a press house with a vat, jars racked in the yard and stained treading floor."""
    paving = plaster_material("paving", STONE, roughness=0.9, variation=0.06, scale=12.0)
    plaster = plaster_material("plaster", hex_rgb("d8c8a4"), roughness=0.86, variation=0.05, scale=8.0)
    tiles = roof_material("tiles", hex_rgb("8f4526"), rows_per_unit=18.0)
    wood = material("wood", WOOD, roughness=0.86)
    must = material("must", hex_rgb("6b2f3e"), roughness=0.4)
    clay = material("clay", CLAY, roughness=0.8)
    vine = material("vine", (0.28, 0.4, 0.2), roughness=0.9)

    half = 0.94
    yard = add_box("yard", (0, 0, 0.03), (half * 2, half * 2, 0.06), paving)
    yard.visible_shadow = False

    house_half = 0.46
    wall_h = 0.62
    hx, hy = -0.38, -0.38
    add_box("press_house", (hx, hy, 0.06 + wall_h / 2), (house_half * 2, house_half * 2, wall_h), plaster)
    add_hip_roof("roof", (hx, hy, 0.06 + wall_h + 0.14), house_half + 0.12, 0.28, tiles, ridge_half=0.12)
    add_doorway(house_half, 0.4, (hx, hy))

    add_cylinder("vat", (0.52, 0.1, 0.06 + 0.22), 0.34, 0.44, wood, vertices=18)
    add_cylinder("must", (0.52, 0.1, 0.06 + 0.43), 0.3, 0.03, must, vertices=18)
    add_box("beam_post", (0.52, 0.72, 0.06 + 0.34), (0.09, 0.09, 0.68), wood)
    add_box("press_beam", (0.52, 0.42, 0.06 + 0.66), (0.12, 0.7, 0.1), wood)

    for jar_y in (-0.86, -0.5):
        add_amphora("jar", (0.72, jar_y, 0.06), 0.34, clay)
    add_amphora("jar", (-0.9, 0.62, 0.06), 0.3, clay)
    add_box("vine_rack", (-0.9, -0.1, 0.06 + 0.2), (0.1, 0.6, 0.4), vine)

    return {"kind": "winery", "variant": 0, "footprint": 2, "height": 1.05}


def build_carding_shed():
    """Carding shed: an open shed of fleeces on racks, with a pen of sheep beside it."""
    earth = plaster_material("earth", EARTH, roughness=0.97, variation=0.09, scale=15.0)
    grass = plaster_material("pen_grass", (0.45, 0.47, 0.26), roughness=0.95, variation=0.12, scale=14.0)
    daub = plaster_material("daub", DAUB_LIGHT, roughness=0.94, variation=0.12, scale=10.0)
    thatch = plaster_material("thatch", THATCH, roughness=0.95, variation=0.1, scale=20.0)
    wool = material("wool", hex_rgb("efe7d6"), roughness=0.95)
    wood = material("wood", WOOD, roughness=0.88)
    clay = material("clay", CLAY, roughness=0.8)

    half = 0.94
    yard = add_box("yard", (0, 0, 0.03), (half * 2, half * 2, 0.06), earth)
    yard.visible_shadow = False
    add_box("pen_ground", (0.4, 0.36, 0.065), (1.0, 1.1, 0.02), grass)

    shed_half = 0.4
    wall_h = 0.44
    sx, sy = -0.44, -0.42
    add_box("shed", (sx, sy, 0.06 + wall_h / 2), (shed_half * 2, shed_half * 2, wall_h), daub)
    add_gable_roof("shed_roof", (sx, sy, 0.06 + wall_h), shed_half + 0.08, shed_half + 0.07, 0.22, 0.05, thatch)
    add_doorway(shed_half, 0.3, (sx, sy))

    for rail in (0.62, 0.82):
        add_box("pen_rail", (0.4, 0.36 + rail * 0.5, 0.06 + 0.16), (1.0, 0.04, 0.06), wood)
    for post_x in (-0.08, 0.4, 0.88):
        add_cylinder("pen_post", (post_x, 0.9, 0.06 + 0.14), 0.03, 0.28, wood, vertices=6)

    for sheep_x, sheep_y in ((0.16, 0.3), (0.6, 0.14), (0.66, 0.62)):
        add_box("sheep", (sheep_x, sheep_y, 0.06 + 0.13), (0.26, 0.16, 0.16), wool)
        add_box("sheep_head", (sheep_x + 0.16, sheep_y, 0.06 + 0.16), (0.09, 0.08, 0.09), daub)

    add_box("rack", (-0.86, 0.5, 0.06 + 0.3), (0.08, 0.7, 0.06), wood)
    for fleece_y in (0.28, 0.62):
        add_box("fleece", (-0.86, fleece_y, 0.06 + 0.2), (0.14, 0.22, 0.2), wool)
    add_amphora("jar", (-0.2, -0.84, 0.06), 0.26, clay)

    return {"kind": "cardingShed", "variant": 0, "footprint": 2, "height": 0.9}


def build_gymnasium():
    """Gymnasium: a sanded palaestra ringed by a colonnade, with weights and a washing basin."""
    sand = plaster_material("sand", hex_rgb("e6d7ab"), roughness=0.97, variation=0.08, scale=16.0)
    paving = plaster_material("paving", STONE, roughness=0.88, variation=0.05, scale=14.0)
    marble = material("marble", MARBLE, roughness=0.3)
    whitewash = plaster_material("whitewash", WHITEWASH, roughness=0.84, variation=0.04, scale=7.0)
    tiles = roof_material("tiles", TERRACOTTA, rows_per_unit=20.0)
    bronze = material("bronze", BRONZE, roughness=0.35, metallic=1.0)
    clay = material("clay", CLAY, roughness=0.8)

    half = 1.44
    yard = add_box("yard", (0, 0, 0.03), (half * 2, half * 2, 0.06), paving)
    yard.visible_shadow = False
    add_box("palaestra", (0.2, 0.2, 0.07), (1.9, 1.9, 0.03), sand)

    room_half = 0.48
    wall_h = 0.6
    rx, ry = -0.86, -0.86
    add_box("changing_room", (rx, ry, 0.06 + wall_h / 2), (room_half * 2, room_half * 2, wall_h), whitewash)
    add_hip_roof("room_roof", (rx, ry, 0.06 + wall_h + 0.14), room_half + 0.12, 0.28, tiles, ridge_half=0.12)
    add_doorway(room_half, 0.4, (rx, ry))

    for offset in (-0.9, -0.3, 0.3, 0.9):
        add_cylinder("column", (half - 0.16, offset + 0.2, 0.06 + 0.36), 0.055, 0.72, marble, vertices=14)
        add_cylinder("column", (offset + 0.2, -half + 0.16, 0.06 + 0.36), 0.055, 0.72, marble, vertices=14)
    add_box("stoa_roof", (half - 0.16, 0.2, 0.06 + 0.76), (0.36, 2.3, 0.08), marble)
    add_box("stoa_roof", (0.2, -half + 0.16, 0.06 + 0.76), (2.3, 0.36, 0.08), marble)

    add_cylinder("basin", (-0.1, 1.0, 0.06 + 0.2), 0.26, 0.4, marble, vertices=18)
    add_cylinder("basin_water", (-0.1, 1.0, 0.06 + 0.4), 0.22, 0.03, bronze, vertices=18)
    for weight_x in (0.6, 0.86):
        add_cylinder("weight", (weight_x, -0.6, 0.09), 0.09, 0.06, bronze, vertices=12)
    add_amphora("oil_jar", (-0.2, -1.1, 0.06), 0.3, clay)

    return {"kind": "gymnasium", "variant": 0, "footprint": 3, "height": 1.05}


def build_drama_school():
    """Drama school: a rehearsal court with masks on the wall and a low stage."""
    paving = plaster_material("paving", STONE, roughness=0.88, variation=0.05, scale=14.0)
    whitewash = plaster_material("whitewash", WHITEWASH, roughness=0.84, variation=0.05, scale=7.0)
    tiles = roof_material("tiles", hex_rgb("c0603a"), rows_per_unit=20.0)
    marble = material("marble", MARBLE, roughness=0.32)
    wood = material("wood", WOOD, roughness=0.86)
    mask = material("mask", hex_rgb("d9c2e0"), roughness=0.7)
    clay = material("clay", CLAY, roughness=0.8)

    half = 1.44
    yard = add_box("yard", (0, 0, 0.03), (half * 2, half * 2, 0.06), paving)
    yard.visible_shadow = False

    hall_half = 0.6
    wall_h = 0.66
    hx, hy = -0.7, -0.7
    add_box("hall", (hx, hy, 0.06 + wall_h / 2), (hall_half * 2, hall_half * 2, wall_h), whitewash)
    add_hip_roof("hall_roof", (hx, hy, 0.06 + wall_h + 0.15), hall_half + 0.12, 0.3, tiles, ridge_half=0.14)
    add_doorway(hall_half, 0.42, (hx, hy))

    add_box("stage", (0.5, 0.4, 0.06 + 0.09), (1.5, 1.3, 0.18), wood)
    add_box("backdrop", (0.5, 1.1, 0.06 + 0.52), (1.5, 0.1, 0.7), whitewash)
    for mask_x in (0.1, 0.5, 0.9):
        add_cylinder("mask", (mask_x, 1.04, 0.06 + 0.66), 0.12, 0.05, mask, vertices=14)
    for offset in (-0.5, 0.5):
        add_cylinder("bench_post", (offset + 0.5, -0.5, 0.06 + 0.1), 0.04, 0.2, wood, vertices=8)
    add_box("bench", (0.5, -0.5, 0.06 + 0.22), (1.3, 0.22, 0.08), marble)
    add_amphora("jar", (-1.1, 0.9, 0.06), 0.3, clay)

    return {"kind": "dramaSchool", "variant": 0, "footprint": 3, "height": 1.1}


def build_theatre():
    """Theatre: a tiered semicircle of stone seats around an orchestra and a skene."""
    paving = plaster_material("paving", STONE, roughness=0.88, variation=0.05, scale=14.0)
    sand = plaster_material("orchestra", hex_rgb("e6d7ab"), roughness=0.96, variation=0.07, scale=16.0)
    marble = material("marble", MARBLE, roughness=0.3)
    whitewash = plaster_material("whitewash", WHITEWASH, roughness=0.84, variation=0.04, scale=7.0)
    tiles = roof_material("tiles", TERRACOTTA, rows_per_unit=20.0)
    wood = material("wood", WOOD, roughness=0.86)
    clay = material("clay", CLAY, roughness=0.8)
    cypress = material("cypress", CYPRESS, roughness=0.9)

    half = 1.92
    yard = add_box("yard", (0, 0, 0.03), (half * 2, half * 2, 0.06), paving)
    yard.visible_shadow = False

    cx, cy = -0.34, 0.2
    add_cylinder("terrace", (cx, cy, 0.06 + 0.07), 1.82, 0.14, marble, vertices=30)
    add_cylinder("orchestra", (cx, cy, 0.06 + 0.15), 0.8, 0.04, sand, vertices=30)
    for radius, rise, count in ((1.04, 0.16, 16), (1.34, 0.3, 20), (1.64, 0.46, 24)):
        for index in range(count):
            angle = math.radians(62 + index * (236 / (count - 1)))
            seat = add_box(
                f"seat_{radius}_{index}",
                (cx + math.cos(angle) * radius, cy + math.sin(angle) * radius, 0.13 + rise / 2),
                (0.32, 2 * math.pi * radius / count * 1.5, rise),
                marble,
            )
            seat.rotation_euler[2] = angle

    add_box("skene", (1.16, 0.2, 0.06 + 0.44), (0.5, 2.0, 0.88), whitewash)
    add_box("skene_cornice", (1.16, 0.2, 0.06 + 0.9), (0.62, 2.12, 0.08), marble)
    add_shed_roof("skene_roof", (1.16, 0.2, 0.06 + 0.98), 0.3, 1.06, 0.07, tiles)
    for door_y in (-0.4, 0.2, 0.8):
        add_box("skene_door", (0.92, door_y, 0.06 + 0.26), (0.05, 0.24, 0.5), wood)

    add_cypress_pot("cypress", (-1.6, -1.5, 0.06), 0.5, clay, cypress)
    add_amphora("jar", (0.4, -1.6, 0.06), 0.34, clay)

    return {"kind": "theatre", "variant": 0, "footprint": 4, "height": 1.3}


def build_stadium():
    """Stadium: a long running track between banked stone seats, with turning posts."""
    paving = plaster_material("paving", STONE, roughness=0.88, variation=0.05, scale=14.0)
    track = plaster_material("track", hex_rgb("e0cf9f"), roughness=0.97, variation=0.07, scale=18.0)
    marble = material("marble", MARBLE, roughness=0.3)
    bronze = material("bronze", BRONZE, roughness=0.35, metallic=1.0)
    clay = material("clay", CLAY, roughness=0.8)
    cypress = material("cypress", CYPRESS, roughness=0.9)

    half = 2.4
    yard = add_box("ground", (0, 0, 0.03), (half * 2, half * 2, 0.06), paving)
    yard.visible_shadow = False
    add_box("track", (0, 0, 0.07), (4.2, 1.5, 0.03), track)

    for side in (-1, 1):
        bank = 1.0 if side > 0 else 0.45
        for tier in range(3):
            rise = (0.22 + tier * 0.4) * bank
            add_box(
                f"seating_{side}_{tier}",
                (0, side * (0.95 + tier * 0.3), 0.06 + rise / 2),
                (4.4, 0.32, rise),
                marble,
            )
    add_box("gate", (-2.2, 0, 0.06 + 0.4), (0.24, 1.6, 0.8), marble)
    add_box("gate_cap", (-2.2, 0, 0.06 + 0.84), (0.36, 1.72, 0.1), marble)

    for post_x in (-1.7, 1.7):
        add_cylinder("turning_post", (post_x, 0, 0.06 + 0.3), 0.08, 0.6, marble, vertices=12)
        add_cylinder("post_cap", (post_x, 0, 0.06 + 0.62), 0.1, 0.06, bronze, vertices=12)

    add_cypress_pot("cypress1", (2.1, 2.0, 0.06), 0.55, clay, cypress)
    add_cypress_pot("cypress2", (-2.0, -2.1, 0.06), 0.5, clay, cypress)

    return {"kind": "stadium", "variant": 0, "footprint": 5, "height": 1.3}


def build_timber_mill():
    """Timber mill: a saw shed with a log pile, trestles and stacked planks."""
    earth = plaster_material("earth", EARTH, roughness=0.97, variation=0.09, scale=15.0)
    daub = plaster_material("daub", DAUB_LIGHT, roughness=0.94, variation=0.1, scale=10.0)
    thatch = plaster_material("thatch", THATCH, roughness=0.95, variation=0.1, scale=20.0)
    wood = material("wood", WOOD, roughness=0.88)
    log = material("log", hex_rgb("8a6134"), roughness=0.9)
    plank = material("plank", hex_rgb("c8ad82"), roughness=0.88)

    half = 0.94
    yard = add_box("yard", (0, 0, 0.03), (half * 2, half * 2, 0.06), earth)
    yard.visible_shadow = False

    shed_half = 0.42
    wall_h = 0.46
    sx, sy = -0.42, -0.4
    add_box("shed", (sx, sy, 0.06 + wall_h / 2), (shed_half * 2, shed_half * 2, wall_h), daub)
    add_gable_roof("shed_roof", (sx, sy, 0.06 + wall_h), shed_half + 0.09, shed_half + 0.08, 0.24, 0.05, thatch)
    add_doorway(shed_half, 0.32, (sx, sy))

    for index, log_y in enumerate((-0.9, -0.62, -0.34)):
        trunk = add_cylinder(f"log_{index}", (0.7, log_y, 0.06 + 0.12), 0.12, 0.9, log, vertices=10)
        trunk.rotation_euler[0] = math.pi / 2
    add_cylinder("log_top", (0.7, -0.62, 0.06 + 0.33), 0.12, 0.9, log, vertices=10).rotation_euler[0] = math.pi / 2

    for post_y in (0.4, 0.9):
        add_cylinder("trestle", (0.5, post_y, 0.06 + 0.16), 0.04, 0.32, wood, vertices=6)
        add_cylinder("trestle", (0.9, post_y, 0.06 + 0.16), 0.04, 0.32, wood, vertices=6)
    add_box("saw_bench", (0.7, 0.65, 0.06 + 0.34), (0.6, 0.6, 0.06), plank)
    for index, z in enumerate((0.0, 0.08, 0.16)):
        add_box(f"planks_{index}", (-0.86, 0.62, 0.06 + 0.04 + z), (0.28, 0.9, 0.07), plank)

    return {"kind": "timberMill", "variant": 0, "footprint": 2, "height": 0.9}


def build_masonry_shop():
    """Masonry shop: a cutting yard of marble blocks, a lifting frame and a dust-covered hut."""
    earth = plaster_material("earth", EARTH, roughness=0.97, variation=0.09, scale=15.0)
    stone = plaster_material("stone", STONE, roughness=0.88, variation=0.06, scale=11.0)
    marble = material("marble", MARBLE, roughness=0.35)
    tiles = roof_material("tiles", hex_rgb("7c6a52"), rows_per_unit=18.0)
    wood = material("wood", WOOD, roughness=0.88)
    rope = material("rope", hex_rgb("b9a06a"), roughness=0.95)

    half = 0.94
    yard = add_box("yard", (0, 0, 0.03), (half * 2, half * 2, 0.06), earth)
    yard.visible_shadow = False

    hut_half = 0.4
    wall_h = 0.46
    hx, hy = -0.46, -0.42
    add_box("hut", (hx, hy, 0.06 + wall_h / 2), (hut_half * 2, hut_half * 2, wall_h), stone)
    add_hip_roof("hut_roof", (hx, hy, 0.06 + wall_h + 0.12), hut_half + 0.1, 0.24, tiles, ridge_half=0.1)
    add_doorway(hut_half, 0.32, (hx, hy))

    for index, (bx, by, bz) in enumerate(((0.62, -0.5, 0.0), (0.62, -0.5, 0.24), (0.9, 0.1, 0.0), (0.5, 0.2, 0.0))):
        add_box(f"block_{index}", (bx, by, 0.06 + 0.12 + bz), (0.34, 0.34, 0.24), marble)

    for post_x in (0.32, 1.0):
        add_cylinder("frame_post", (post_x, 0.78, 0.06 + 0.36), 0.04, 0.72, wood, vertices=6)
    add_box("frame_beam", (0.66, 0.78, 0.06 + 0.72), (0.78, 0.08, 0.08), wood)
    add_cylinder("hoist_rope", (0.66, 0.78, 0.06 + 0.52), 0.015, 0.34, rope, vertices=6)
    add_box("hoisted_block", (0.66, 0.78, 0.06 + 0.28), (0.24, 0.24, 0.18), marble)

    return {"kind": "masonryShop", "variant": 0, "footprint": 2, "height": 0.95}


def build_monument():
    """Commemorative monument: a fluted column on a stepped base, crowned in gilt bronze."""
    paving = plaster_material("paving", STONE, roughness=0.86, variation=0.05, scale=14.0)
    marble = material("marble", MARBLE, roughness=0.28)
    gilt = material("gilt", hex_rgb("d8c06a"), roughness=0.3, metallic=1.0)
    clay = material("clay", CLAY, roughness=0.8)
    cypress = material("cypress", CYPRESS, roughness=0.9)

    half = 1.44
    yard = add_box("court", (0, 0, 0.03), (half * 2, half * 2, 0.06), paving)
    yard.visible_shadow = False

    for step, (size, z) in enumerate(((1.7, 0.12), (1.4, 0.24), (1.1, 0.36))):
        add_box(f"step_{step}", (0, 0, z), (size, size, 0.12), marble)

    add_box("plinth", (0, 0, 0.42 + 0.24), (0.8, 0.8, 0.48), marble)
    add_box("plinth_cap", (0, 0, 0.42 + 0.5), (0.94, 0.94, 0.08), marble)
    add_cylinder("column", (0, 0, 0.98 + 0.72), 0.24, 1.44, marble, vertices=20)
    add_box("capital", (0, 0, 0.98 + 1.5), (0.62, 0.62, 0.14), marble)
    add_cylinder("figure", (0, 0, 0.98 + 1.72), 0.13, 0.34, gilt, vertices=14)
    add_cylinder("wreath", (0, 0, 0.98 + 1.94), 0.17, 0.06, gilt, vertices=18)

    for cx, cy in ((1.1, -1.1), (-1.1, 1.1)):
        add_cypress_pot("cypress", (cx, cy, 0.06), 0.5, clay, cypress)
    add_amphora("jar", (1.12, 1.0, 0.06), 0.34, clay)

    return {"kind": "monument", "variant": 0, "footprint": 3, "height": 3.1}


def build_industry_yard(kind, roof_hex, props, height=0.95):
    """A walled working yard with a tiled shed; props fill the rest."""
    earth = plaster_material("earth", EARTH, roughness=0.97, variation=0.09, scale=15.0)
    plaster = plaster_material("plaster", hex_rgb("d8cdb4"), roughness=0.88, variation=0.05, scale=9.0)
    tiles = roof_material("tiles", hex_rgb(roof_hex), rows_per_unit=18.0)

    half = 0.94
    yard = add_box("yard", (0, 0, 0.03), (half * 2, half * 2, 0.06), earth)
    yard.visible_shadow = False
    add_box("yard_wall", (0, half, 0.15), (half * 2, 0.08, 0.18), plaster)
    add_box("yard_wall_west", (-half, 0, 0.15), (0.08, half * 2, 0.18), plaster)

    shed_half = 0.42
    wall_h = 0.5
    sx, sy = -0.42, -0.4
    add_box("shed", (sx, sy, 0.06 + wall_h / 2), (shed_half * 2, shed_half * 2, wall_h), plaster)
    add_hip_roof("shed_roof", (sx, sy, 0.06 + wall_h + 0.13), shed_half + 0.11, 0.26, tiles, ridge_half=0.11)
    add_doorway(shed_half, 0.34, (sx, sy))

    props()
    return {"kind": kind, "variant": 0, "footprint": 2, "height": height}


def build_foundry():
    bronze = material("bronze", BRONZE, roughness=0.35, metallic=1.0)
    brick = plaster_material("brick", CLAY, roughness=0.92, variation=0.08, scale=9.0)
    wood = material("wood", WOOD, roughness=0.88)

    def props():
        add_cylinder("furnace", (0.6, -0.5, 0.06 + 0.3), 0.28, 0.6, brick, vertices=14)
        add_cylinder("chimney", (0.6, -0.5, 0.06 + 0.72), 0.12, 0.28, brick, vertices=10)
        add_box("bellows", (0.6, 0.2, 0.06 + 0.14), (0.4, 0.3, 0.28), wood)
        for ingot_y in (0.7, 0.86):
            add_box("ingot", (0.5, ingot_y, 0.06 + 0.05), (0.34, 0.12, 0.1), bronze)

    return build_industry_yard("foundry", "6b4a30", props, 1.15)


def build_armoury():
    bronze = material("bronze", BRONZE, roughness=0.35, metallic=1.0)
    wood = material("wood", WOOD, roughness=0.88)

    def props():
        add_box("anvil", (0.52, -0.5, 0.06 + 0.13), (0.34, 0.2, 0.26), bronze)
        add_box("bench", (0.7, 0.3, 0.06 + 0.16), (0.5, 0.7, 0.08), wood)
        for shield_y in (0.1, 0.5):
            shield = add_cylinder("shield", (0.94, shield_y, 0.06 + 0.42), 0.19, 0.06, bronze, vertices=16)
            shield.rotation_euler[0] = math.pi / 2
        add_box("rack", (0.94, 0.3, 0.06 + 0.2), (0.06, 0.8, 0.4), wood)

    return build_industry_yard("armoury", "7c5a34", props)


def build_sculpture_studio():
    marble = material("marble", MARBLE, roughness=0.3)
    bronze = material("bronze", BRONZE, roughness=0.35, metallic=1.0)
    wood = material("wood", WOOD, roughness=0.88)

    def props():
        add_box("plinth", (0.6, -0.5, 0.06 + 0.14), (0.42, 0.42, 0.28), marble)
        add_cylinder("figure", (0.6, -0.5, 0.06 + 0.55), 0.12, 0.54, bronze, vertices=14)
        add_box("workbench", (0.66, 0.5, 0.06 + 0.16), (0.5, 0.7, 0.1), wood)
        add_cylinder("cast", (0.66, 0.5, 0.06 + 0.3), 0.13, 0.18, bronze, vertices=12)

    return build_industry_yard("sculptureStudio", "8a6134", props, 1.2)


def build_mint():
    silver = material("silver", hex_rgb("cdd3d8"), roughness=0.25, metallic=1.0)
    wood = material("wood", WOOD, roughness=0.88)
    stone = plaster_material("stone", STONE, roughness=0.88, variation=0.06, scale=11.0)

    def props():
        add_box("strong_room", (0.6, -0.46, 0.06 + 0.24), (0.6, 0.6, 0.48), stone)
        add_box("press", (0.62, 0.42, 0.06 + 0.2), (0.36, 0.36, 0.4), wood)
        add_cylinder("die", (0.62, 0.42, 0.06 + 0.44), 0.11, 0.1, silver, vertices=12)
        for coin_x in (0.2, 0.34):
            add_cylinder("coin_stack", (coin_x, 0.78, 0.06 + 0.06), 0.08, 0.12, silver, vertices=12)

    return build_industry_yard("mint", "6f6a5c", props)


def build_horse_ranch():
    """Horse ranch: a fenced paddock of horses beside a long stable."""
    grass = plaster_material("paddock", (0.45, 0.47, 0.26), roughness=0.95, variation=0.12, scale=15.0)
    earth = plaster_material("earth", EARTH, roughness=0.97, variation=0.09, scale=15.0)
    plaster = plaster_material("plaster", hex_rgb("d8c8a4"), roughness=0.88, variation=0.05, scale=9.0)
    tiles = roof_material("tiles", hex_rgb("8a6134"), rows_per_unit=18.0)
    wood = material("wood", WOOD, roughness=0.88)
    hide = material("hide", hex_rgb("8a5a34"), roughness=0.9)

    half = 1.92
    yard = add_box("ground", (0, 0, 0.03), (half * 2, half * 2, 0.06), earth)
    yard.visible_shadow = False
    add_box("paddock", (0.4, 0.4, 0.07), (2.6, 2.6, 0.03), grass)

    stable_half = 0.6
    wall_h = 0.6
    sx, sy = -1.0, -1.0
    add_box("stable", (sx, sy, 0.06 + wall_h / 2), (stable_half * 2, stable_half * 2 + 0.6, wall_h), plaster)
    add_hip_roof("stable_roof", (sx, sy, 0.06 + wall_h + 0.15), stable_half + 0.2, 0.3, tiles, ridge_half=0.2)
    add_doorway(stable_half, 0.42, (sx, sy))

    for fence_x in (-0.9, -0.3, 0.3, 0.9, 1.5):
        add_cylinder("fence_post", (fence_x, 1.7, 0.06 + 0.16), 0.035, 0.32, wood, vertices=6)
        add_cylinder("fence_post_east", (1.7, fence_x, 0.06 + 0.16), 0.035, 0.32, wood, vertices=6)
    add_box("fence_rail", (0.4, 1.7, 0.06 + 0.26), (2.6, 0.05, 0.06), wood)
    add_box("fence_rail_east", (1.7, 0.4, 0.06 + 0.26), (0.05, 2.6, 0.06), wood)

    for hx, hy in ((0.2, 0.5), (0.9, 1.0), (1.2, 0.1)):
        add_box("horse", (hx, hy, 0.06 + 0.3), (0.56, 0.22, 0.3), hide)
        add_box("horse_neck", (hx + 0.3, hy, 0.06 + 0.44), (0.16, 0.16, 0.3), hide)
        for leg_x, leg_y in ((-0.2, -0.08), (-0.2, 0.08), (0.2, -0.08), (0.2, 0.08)):
            add_cylinder("leg", (hx + leg_x, hy + leg_y, 0.06 + 0.1), 0.035, 0.2, hide, vertices=6)

    return {"kind": "horseRanch", "variant": 0, "footprint": 4, "height": 1.2}


def build_field_farm(kind, crop_hex, row_count=5):
    """A field of rows with a small hut, in the manner of the wheat farm."""
    soil = plaster_material("soil", SOIL, roughness=0.98, variation=0.1, scale=12.0)
    crop = plaster_material("crop", hex_rgb(crop_hex), roughness=0.94, variation=0.12, scale=14.0)
    ochre = plaster_material("ochre", OCHRE, roughness=0.9, variation=0.08, scale=8.0)
    terracotta = roof_material("terracotta", TERRACOTTA)
    wood = material("wood", WOOD, roughness=0.85)

    field = add_box("field", (-0.1, -0.1, 0.03), (1.74, 1.74, 0.06), soil)
    field.visible_shadow = False
    for row in range(row_count):
        add_box(f"row_{row}", (-0.78 + row * 0.34, -0.1, 0.09), (0.2, 1.5, 0.1), crop)

    hx, hy = 0.66, 0.66
    half = 0.28
    wall_h = 0.4
    add_box("hut", (hx, hy, 0.06 + wall_h / 2), (half * 2, half * 2, wall_h), ochre)
    add_hip_roof("hut_roof", (hx, hy, 0.06 + wall_h + 0.1), half + 0.06, 0.2, terracotta, ridge_half=0.07)
    add_door(half, 0.24, wood, (hx, hy))

    return {"kind": kind, "variant": 0, "footprint": 2, "height": 0.8}


def build_hunting_lodge():
    """Hunting lodge: a timber cabin with drying racks and a stack of pelts."""
    earth = plaster_material("earth", EARTH, roughness=0.97, variation=0.09, scale=15.0)
    daub = plaster_material("daub", DAUB, roughness=0.95, variation=0.12, scale=10.0)
    thatch = plaster_material("thatch", THATCH, roughness=0.95, variation=0.1, scale=20.0)
    wood = material("wood", WOOD, roughness=0.88)
    hide = material("hide", hex_rgb("8a5a34"), roughness=0.92)

    half = 0.94
    yard = add_box("yard", (0, 0, 0.03), (half * 2, half * 2, 0.06), earth)
    yard.visible_shadow = False

    lodge_half = 0.42
    wall_h = 0.46
    lx, ly = -0.42, -0.4
    add_box("lodge", (lx, ly, 0.06 + wall_h / 2), (lodge_half * 2, lodge_half * 2, wall_h), daub)
    add_gable_roof("lodge_roof", (lx, ly, 0.06 + wall_h), lodge_half + 0.09, lodge_half + 0.08, 0.24, 0.05, thatch)
    add_doorway(lodge_half, 0.32, (lx, ly))

    add_rack("rack", (0.6, 0.3, 0.06), 0.6, 0.3, wood, hide)
    for pelt_y in (-0.8, -0.6):
        add_box("pelt", (0.6, pelt_y, 0.06 + 0.07), (0.4, 0.16, 0.14), hide)
    add_stump("stump", (-0.8, 0.72, 0.06), wood)

    return {"kind": "huntingLodge", "variant": 0, "footprint": 2, "height": 0.9}


def build_fishery():
    """Fishery: a jetty over the water with a boat, nets and drying fish."""
    earth = plaster_material("earth", EARTH, roughness=0.97, variation=0.09, scale=15.0)
    plaster = plaster_material("plaster", hex_rgb("bcd0d4"), roughness=0.88, variation=0.05, scale=9.0)
    tiles = roof_material("tiles", hex_rgb("b8502c"), rows_per_unit=18.0)
    wood = material("wood", WOOD, roughness=0.88)
    net = material("net", hex_rgb("cbbf95"), roughness=0.95)

    half = 0.94
    yard = add_box("yard", (0, 0, 0.03), (half * 2, half * 2, 0.06), earth)
    yard.visible_shadow = False

    shed_half = 0.36
    wall_h = 0.44
    sx, sy = -0.5, -0.5
    add_box("shed", (sx, sy, 0.06 + wall_h / 2), (shed_half * 2, shed_half * 2, wall_h), plaster)
    add_hip_roof("shed_roof", (sx, sy, 0.06 + wall_h + 0.12), shed_half + 0.1, 0.24, tiles, ridge_half=0.1)
    add_doorway(shed_half, 0.3, (sx, sy))

    add_box("jetty", (0.42, -0.2, 0.09), (1.0, 0.3, 0.06), wood)
    for post_x in (0.0, 0.42, 0.84):
        add_cylinder("pile", (post_x, -0.2, 0.06), 0.04, 0.14, wood, vertices=6)
    add_box("boat", (0.5, 0.62, 0.1), (0.8, 0.3, 0.14), wood)
    add_box("boat_rim", (0.5, 0.62, 0.17), (0.86, 0.36, 0.04), wood)
    add_box("net", (-0.3, 0.72, 0.06 + 0.16), (0.3, 0.5, 0.3), net)
    for fish_y in (-0.72, -0.5):
        add_box("fish", (-0.86, fish_y, 0.06 + 0.3), (0.1, 0.16, 0.08), material("fish", hex_rgb("9fb6bd"), roughness=0.6))

    return {"kind": "fishery", "variant": 0, "footprint": 2, "height": 0.85}


def build_fountain():
    """Marble basin with a raised centre and a small bronze statue; light blue water."""
    marble = material("marble", MARBLE, roughness=0.3)
    bronze = material("bronze", BRONZE, roughness=0.35, metallic=1.0)
    water = material("water", WATER_LIGHT, roughness=0.06)
    water.node_tree.nodes["Principled BSDF"].inputs["IOR"].default_value = 1.33

    add_cylinder("basin", (0, 0, 0.11), 0.44, 0.22, marble, vertices=32)
    add_cylinder("water", (0, 0, 0.19), 0.37, 0.08, water, vertices=32)
    add_cylinder("pedestal", (0, 0, 0.32), 0.09, 0.28, marble, vertices=16)
    add_cylinder("pedestal_cap", (0, 0, 0.47), 0.14, 0.04, marble, vertices=16)

    add_cylinder("statue_legs", (0, 0, 0.56), 0.045, 0.18, bronze, vertices=12)
    add_cylinder("statue_torso", (0, 0, 0.7), 0.06, 0.12, bronze, vertices=12)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.045, location=(0, 0, 0.79), segments=12, ring_count=8)
    head = bpy.context.active_object
    head.name = "statue_head"
    head.data.materials.append(bronze)
    bpy.ops.object.shade_smooth()

    return {"kind": "fountain", "variant": 0, "footprint": 1, "height": 0.9}


def build_statue():
    """Marble on a stepped plinth, a bronze figure with green patina accents."""
    stone = material("stone", STONE, roughness=0.7)
    marble = material("marble", MARBLE, roughness=0.3)
    bronze = material("bronze", BRONZE, roughness=0.35, metallic=1.0)
    patina = material("patina", PATINA, roughness=0.6)

    add_box("step1", (0, 0, 0.03), (0.42, 0.42, 0.06), stone)
    add_box("step2", (0, 0, 0.085), (0.34, 0.34, 0.05), stone)
    add_box("pedestal", (0, 0, 0.3), (0.24, 0.24, 0.38), marble)
    add_box("cap", (0, 0, 0.51), (0.28, 0.28, 0.04), marble)

    add_cylinder("legs", (0, 0, 0.72), 0.1, 0.34, bronze, vertices=20)
    add_cylinder("hem", (0, 0, 0.57), 0.14, 0.07, patina, vertices=20)
    add_cylinder("torso", (0, 0, 1.0), 0.13, 0.26, bronze, vertices=20)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.095, location=(0, 0, 1.2), segments=20, ring_count=12)
    head = bpy.context.active_object
    head.name = "head"
    head.data.materials.append(bronze)
    bpy.ops.object.shade_smooth()

    bpy.ops.mesh.primitive_cylinder_add(radius=0.045, depth=0.32, location=(0.15, -0.04, 1.08), vertices=14)
    arm = bpy.context.active_object
    arm.name = "arm"
    arm.rotation_euler[1] = math.radians(48)
    arm.data.materials.append(bronze)
    bpy.ops.object.shade_smooth()

    add_cylinder("shoulder_patina", (0, 0, 1.13), 0.15, 0.04, patina, vertices=20)

    return {"kind": "statue", "variant": 0, "footprint": 1, "height": 1.35}


MIRROR_DIAGONAL = Matrix(((0, -1, 0, 0), (-1, 0, 0, 0), (0, 0, 1, 0), (0, 0, 0, 1)))


def mirrored(builder):
    """Reflect across the x = -y plane so the door and windows swap camera-facing sides.

    The reflection is baked into the mesh, from `matrix_basis` rather than `matrix_world`:
    an object matrix cannot hold a reflection, and `matrix_world` is still stale for
    objects the builder has only just created.
    """

    def build():
        spec = builder()
        for obj in bpy.data.objects:
            if obj.type != "MESH":
                continue
            obj.data.transform(MIRROR_DIAGONAL @ obj.matrix_basis)
            obj.data.flip_normals()
            obj.matrix_basis = Matrix.Identity(4)
        return {**spec, "variant": spec["variant"] + 1}

    return build


HOUSES = [
    build_house_0,
    build_house_1,
    build_house_2,
    build_house_3,
    build_house_4,
    build_house_5,
    build_house_6,
]

MODELS = {
    "palace": build_palace,
    "granary": build_granary,
    "trading-post": build_trading_post,
    "tax-office": build_tax_office,
    "agora": build_agora,
    "growers-lodge": build_growers_lodge,
    "college": build_college,
    "gymnasium": build_gymnasium,
    "drama-school": build_drama_school,
    "theatre": build_theatre,
    "stadium": build_stadium,
    "podium": build_podium,
    "maintenance-office": build_maintenance_office,
    "infirmary": build_infirmary,
    "hero-hall": build_hero_hall,
    "monument": build_monument,
    "tower": build_tower,
    "watchpost": build_watchpost,
    "olive-press": build_olive_press,
    "timber-mill": build_timber_mill,
    "masonry-shop": build_masonry_shop,
    "foundry": build_foundry,
    "armoury": build_armoury,
    "sculpture-studio": build_sculpture_studio,
    "mint": build_mint,
    "horse-ranch": build_horse_ranch,
    "vineyard": build_vineyard,
    "winery": build_winery,
    "carding-shed": build_carding_shed,
    "wheat-farm": build_wheat_farm,
    "carrot-farm": lambda: build_field_farm("carrotFarm", "d8a45c"),
    "onion-farm": lambda: build_field_farm("onionFarm", "cdbd8e", row_count=4),
    "hunting-lodge": build_hunting_lodge,
    "fishery": build_fishery,
    "fountain": build_fountain,
    "statue": build_statue,
}
for estate_tier in range(4):
    MODELS[f"estate-{estate_tier}"] = (lambda tier: lambda: build_estate(tier))(estate_tier)

for sanctuary_name, sanctuary_god in SANCTUARIES.items():
    MODELS[sanctuary_name] = sanctuary_builder(sanctuary_name, sanctuary_god)

for tier, builder in enumerate(HOUSES):
    MODELS[f"house-{tier}"] = builder
    MODELS[f"house-{tier}m"] = mirrored(builder)


def add_ground():
    bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, 0))
    ground = bpy.context.active_object
    ground.name = "shadow_catcher"
    ground.is_shadow_catcher = True
    ground.data.materials.append(material("ground", (0.5, 0.5, 0.5), roughness=1.0))
    return ground


def frame_camera(camera, resolution):
    """The camera stays put; a bigger frame simply shows more around the model."""
    scene = bpy.context.scene
    scene.render.resolution_x = resolution[0]
    scene.render.resolution_y = resolution[1]
    scene.render.resolution_percentage = 100
    camera.data.ortho_scale = resolution[0] / (PIXELS_PER_UNIT * SUPERSAMPLE)


def add_camera(footprint, height, resolution):
    bpy.ops.object.camera_add(location=(0, 0, 0))
    camera = bpy.context.active_object
    camera.data.type = "ORTHO"
    camera.rotation_euler = (math.pi / 2 - CAMERA_ELEVATION, 0, CAMERA_YAW)

    bpy.context.scene.camera = camera
    frame_camera(camera, resolution)

    target = Vector((0, 0, height / 2))
    direction = Vector(
        (
            math.cos(CAMERA_ELEVATION) * math.sin(CAMERA_YAW),
            -math.cos(CAMERA_ELEVATION) * math.cos(CAMERA_YAW),
            math.sin(CAMERA_ELEVATION),
        )
    )
    camera.location = target + direction * 30
    return camera


def add_sun():
    """High and near-white, with a bright sky: Zeus lights its city flat, not cinematically."""
    bpy.ops.object.light_add(type="SUN", location=(0, 0, 12))
    sun = bpy.context.active_object
    sun.data.energy = 2.6
    sun.data.color = (1.0, 0.96, 0.9)
    sun.data.angle = math.radians(2.0)
    sun.rotation_euler = (math.pi / 2 - SUN_ALTITUDE, 0, SUN_AZIMUTH)

    world = bpy.data.worlds.new("world")
    bpy.context.scene.world = world
    world.use_nodes = True
    background = world.node_tree.nodes["Background"]
    background.inputs[0].default_value = (0.78, 0.8, 0.84, 1)
    background.inputs[1].default_value = 1.05
    return sun


def render_model(name, spec, out_dir, ground):
    """Two passes: the body with no shadow catcher, then the shadow with no body,
    so the game can lay a shadow under its neighbours instead of over them."""
    resolution = (
        int((spec["footprint"] * TILE_WIDTH + 120) * SUPERSAMPLE),
        int((spec["footprint"] * TILE_HEIGHT + spec["height"] * 90 + 120) * SUPERSAMPLE),
    )
    camera = add_camera(spec["footprint"], spec["height"], resolution)
    add_sun()

    scene = bpy.context.scene
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"

    ground.is_shadow_catcher = False
    ground.visible_camera = False
    body = os.path.join(out_dir, f"{name}.png")
    scene.render.filepath = body
    bpy.ops.render.render(write_still=True)

    ground.is_shadow_catcher = True
    ground.visible_camera = True
    for obj in bpy.data.objects:
        if obj.type == "MESH" and obj is not ground:
            obj.visible_camera = False

    shadow_resolution = shadow_frame(spec, resolution)
    frame_camera(camera, shadow_resolution)
    shadow = os.path.join(out_dir, f"{name}-shadow.png")
    scene.render.filepath = shadow
    bpy.ops.render.render(write_still=True)

    return (("body", body, resolution), ("shadow", shadow, shadow_resolution))


def shadow_frame(spec, resolution):
    """Room for the shadow the sun casts across the ground."""
    reach = (spec["height"] / math.tan(SUN_ALTITUDE) + spec["footprint"]) * PIXELS_PER_UNIT
    pad = int(reach * SUPERSAMPLE)
    return (resolution[0] + 2 * pad, resolution[1] + 2 * pad)


def main():
    args = parse_args()
    out_dir = os.path.abspath(args.out)
    os.makedirs(out_dir, exist_ok=True)

    manifest_path = os.path.join(out_dir, "manifest.json")
    manifest = {"tileWidth": TILE_WIDTH, "tileHeight": TILE_HEIGHT, "supersample": SUPERSAMPLE, "sprites": []}

    names = args.only.split(",") if args.only else list(MODELS)
    rebuilt = {f"{name}.png" for name in names} | {f"{name}-shadow.png" for name in names}

    if len(names) < len(MODELS) and os.path.exists(manifest_path):
        with open(manifest_path) as handle:
            existing = json.load(handle)
        manifest["sprites"] = [s for s in existing["sprites"] if s["file"] not in rebuilt]

    for name in names:
        clear_scene(args.samples, args.device)
        spec = MODELS[name]()
        ground = add_ground()
        for layer, path, resolution in render_model(name, spec, out_dir, ground):
            manifest["sprites"].append(
                {
                    "kind": spec["kind"],
                    "variant": spec["variant"],
                    "layer": layer,
                    "file": os.path.basename(path),
                    "footprint": spec["footprint"],
                    "heightUnits": spec["height"],
                    "width": resolution[0] // SUPERSAMPLE,
                    "height": resolution[1] // SUPERSAMPLE,
                }
            )

    with open(manifest_path, "w") as handle:
        json.dump(manifest, handle, indent=2)
    print(f"rendered {len(manifest['sprites'])} sprites to {out_dir}")


if __name__ == "__main__":
    main()
