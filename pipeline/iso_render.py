"""Render isometric building sprites that drop straight into the game's tile metric.

    blender --background --python pipeline/iso_render.py -- --out pipeline/out

Camera: yaw 45 degrees, elevation 30 degrees, orthographic. Elevation 30 is what
makes one tile step project to exactly TILE_WIDTH/2 across and TILE_HEIGHT/2 down,
matching src/render/iso.ts. One sprite is rendered per sun phase, so the game can
swap textures as the day turns instead of running a normal-mapped shader.
"""

import argparse
import json
import math
import os
import sys

import bpy
from mathutils import Vector

TILE_WIDTH = 120
TILE_HEIGHT = 60
SUN_PHASES = 6
SUPERSAMPLE = 4
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
WINDOW_GLOW = (1.0, 0.55, 0.15)
STONE = (0.70, 0.66, 0.58)
FIELDSTONE = (0.62, 0.58, 0.50)
OCHRE = (0.78, 0.58, 0.34)
CLAY = (0.70, 0.34, 0.19)
WOOD = (0.22, 0.13, 0.07)
PATINA = (0.33, 0.52, 0.44)
CYPRESS = (0.13, 0.30, 0.18)
WATER_LIGHT = (0.40, 0.74, 0.77)
SOIL = (0.36, 0.27, 0.17)


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="pipeline/out")
    parser.add_argument("--only", default="", help="comma-separated model names")
    parser.add_argument("--phases", default="", help="comma-separated phase indices")
    return parser.parse_args(argv)


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 48
    scene.cycles.use_denoising = True
    scene.render.film_transparent = True
    scene.view_settings.view_transform = "Standard"
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


def add_box(name, centre, size, mat):
    bpy.ops.mesh.primitive_cube_add(size=1, location=centre)
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


def add_hip_roof(name, centre, radius, depth, mat, ridge_radius=0.12):
    """A pyramid roof flattened at the peak — reads as a hip roof, not a shack point."""
    bpy.ops.mesh.primitive_cone_add(radius1=radius, radius2=ridge_radius, depth=depth, location=centre, vertices=4)
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


def window_material(night):
    mat = bpy.data.materials.new("window")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    if night:
        bsdf.inputs["Base Color"].default_value = (*WINDOW_GLOW, 1)
        bsdf.inputs["Emission Color"].default_value = (*WINDOW_GLOW, 1)
        bsdf.inputs["Emission Strength"].default_value = 8.0
    else:
        bsdf.inputs["Base Color"].default_value = (0.09, 0.07, 0.05, 1)
        bsdf.inputs["Roughness"].default_value = 0.4
    return mat


def door_glow_material():
    mat = bpy.data.materials.new("doorway_glow")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*WINDOW_GLOW, 1)
    bsdf.inputs["Emission Color"].default_value = (*WINDOW_GLOW, 1)
    bsdf.inputs["Emission Strength"].default_value = 5.0
    return mat


def add_openings(half, sill, tall, night, door_mat, centre=(0.0, 0.0)):
    """Door on the +X face and windows on the -Y face — the two the camera sees."""
    cx, cy = centre
    glass = window_material(night)
    door_w = max(0.2, half * 0.5)
    add_box("door", (cx + half - 0.01, cy, sill * 0.55), (0.05, door_w, sill * 1.1), door_mat)
    if night:
        add_box("doorway_glow", (cx + half + 0.008, cy, sill * 0.5), (0.015, door_w * 1.15, sill * 0.85), door_glow_material())

    window_w = max(0.16, tall * 0.26)
    window_h = max(0.18, tall * 0.3)
    offset_mag = half * 0.58
    for offset in (-offset_mag, offset_mag):
        if abs(offset) + window_w / 2 > half:
            continue
        add_box("window", (cx + offset, cy - half + 0.01, sill + tall * 0.15), (window_w, 0.06, window_h), glass)


def build_house_0(phase):
    """Shack: rough fieldstone walls, straw roof, lean-to, pot by the door."""
    night = phase >= SUN_PHASES
    fieldstone = material("fieldstone", FIELDSTONE, roughness=0.92)
    straw_dull = material("straw_dull", STRAW_DULL, roughness=0.95)
    straw_ridge = material("straw_ridge", STRAW_RIDGE, roughness=0.85)
    wood = material("wood", WOOD, roughness=0.85)
    clay = material("clay", CLAY, roughness=0.8)

    s = 0.425 / 0.26
    half = 0.26 * s
    wall_h = 0.56 * s
    add_box("walls", (0, 0, wall_h / 2), (half * 2, half * 2, wall_h), fieldstone)
    add_openings(half, wall_h * 0.5, wall_h, night, wood)

    base_r = half + 0.07 * s
    eave_h = 0.06 * s
    eave_top_r = base_r * 0.94
    cap_h = 0.34 * s
    cap_top_r = base_r * 0.3
    ridge_h = 0.12 * s
    add_hip_roof("roof_eave", (0, 0, wall_h + eave_h / 2), base_r, eave_h, straw_dull, ridge_radius=eave_top_r)
    add_hip_roof("roof_cap", (0, 0, wall_h + eave_h + cap_h / 2), eave_top_r, cap_h, straw_dull, ridge_radius=cap_top_r)
    add_pyramid("roof_ridge", (0, 0, wall_h + eave_h + cap_h + ridge_h / 2), cap_top_r, ridge_h, straw_ridge)
    depth = eave_h + cap_h + ridge_h

    lean_x = half + 0.1 * s
    add_box("leanto_roof", (lean_x, -0.02 * s, 0.36 * s), (0.2 * s, 0.4 * s, 0.02 * s), straw_dull)
    add_cylinder("leanto_post1", (lean_x + 0.1 * s, -0.2 * s, 0.18 * s), 0.018 * s, 0.34 * s, wood, vertices=8)
    add_cylinder("leanto_post2", (lean_x + 0.1 * s, 0.16 * s, 0.18 * s), 0.018 * s, 0.34 * s, wood, vertices=8)

    add_amphora("pot", (half + 0.08 * s, 0.2 * s, 0.0), 0.16 * s, clay)

    return {"kind": "house", "variant": 0, "footprint": 1, "height": wall_h + depth + 0.15}


def build_house_1(phase):
    """Hovel: mud-plaster ochre walls, low terracotta roof, small wooden awning."""
    night = phase >= SUN_PHASES
    ochre = material("ochre", OCHRE, roughness=0.9)
    terracotta = material("terracotta", TERRACOTTA, roughness=0.55)
    stone = material("stone", STONE, roughness=0.8)
    wood = material("wood", WOOD, roughness=0.85)

    s = 0.425 / 0.30
    half = 0.3 * s
    add_box("plinth", (0, 0, 0.03 * s), (half * 2 + 0.06 * s, half * 2 + 0.06 * s, 0.06 * s), stone)
    add_box("walls", (0, 0, 0.4 * s), (half * 2, half * 2, 0.68 * s), ochre)
    add_hip_roof("roof", (0, 0, 0.78 * s), 0.32 * s, 0.08 * s, terracotta, ridge_radius=0.2 * s)
    add_openings(half, 0.38 * s, 0.68 * s, night, wood)

    add_box("awning", (half + 0.04 * s, 0, 0.48 * s), (0.1 * s, 0.42 * s, 0.02 * s), wood)
    add_cylinder("awning_post1", (half + 0.1 * s, -0.16 * s, 0.24 * s), 0.018 * s, 0.48 * s, wood, vertices=8)
    add_cylinder("awning_post2", (half + 0.1 * s, 0.16 * s, 0.24 * s), 0.018 * s, 0.48 * s, wood, vertices=8)

    return {"kind": "house", "variant": 1, "footprint": 1, "height": 0.84 * s + 0.1}


def build_house_2(phase):
    """Tenement: whitewashed walls, terracotta hip roof, pergola, amphorae, chimney."""
    night = phase >= SUN_PHASES
    whitewash = material("whitewash", WHITEWASH, roughness=0.8)
    terracotta = material("terracotta", TERRACOTTA, roughness=0.55)
    stone = material("stone", STONE, roughness=0.75)
    wood = material("wood", WOOD, roughness=0.8)
    clay = material("clay", CLAY, roughness=0.8)
    brick = material("brick", (0.5, 0.3, 0.22), roughness=0.85)

    s = 0.46 / 0.32
    half = 0.32 * s
    add_box("plinth", (0, 0, 0.04 * s), (half * 2 + 0.06 * s, half * 2 + 0.06 * s, 0.08 * s), stone)
    add_box("walls", (0, 0, 0.4 * s), (half * 2, half * 2, 0.72 * s), whitewash)
    add_box("cornice", (0, 0, 0.83 * s), (half * 2 + 0.06 * s, half * 2 + 0.06 * s, 0.05 * s), stone)
    add_hip_roof("roof", (0, 0, 0.94 * s), 0.34 * s, 0.09 * s, terracotta, ridge_radius=0.2 * s)
    add_box("chimney", (-0.18 * s, 0.18 * s, 0.98 * s), (0.08 * s, 0.08 * s, 0.2 * s), brick)
    add_openings(half, 0.44 * s, 0.72 * s, night, wood)

    add_pergola("pergola", -half, 0.0, 0.0, 0.16 * s, 0.5 * s, 0.34 * s, wood)
    add_amphora("jar1", (half + 0.08 * s, -0.22 * s, 0.0), 0.2 * s, clay)
    add_amphora("jar2", (half + 0.08 * s, 0.22 * s, 0.0), 0.18 * s, clay)

    return {"kind": "house", "variant": 2, "footprint": 1, "height": 1.1 * s + 0.15}


def build_house_3(phase):
    """Homestead: whitewash + marble trim, clerestory roof, columned porch, courtyard, cypress."""
    night = phase >= SUN_PHASES
    whitewash = material("whitewash", WHITEWASH, roughness=0.8)
    terracotta = material("terracotta", TERRACOTTA, roughness=0.55)
    marble = material("marble", MARBLE, roughness=0.35)
    stone = material("stone", STONE, roughness=0.75)
    wood = material("wood", WOOD, roughness=0.8)
    clay = material("clay", CLAY, roughness=0.8)
    cypress = material("cypress", CYPRESS, roughness=0.9)

    s = 0.46 / 0.34
    half = 0.34 * s
    add_box("plinth", (0, 0, 0.05 * s), (half * 2 + 0.06 * s, half * 2 + 0.06 * s, 0.1 * s), stone)
    add_box("walls", (0, 0, 0.48 * s), (half * 2, half * 2, 0.76 * s), whitewash)
    add_box("cornice", (0, 0, 0.89 * s), (half * 2 + 0.06 * s, half * 2 + 0.06 * s, 0.06 * s), marble)
    add_hip_roof("roof", (0, 0, 1.01 * s), 0.36 * s, 0.1 * s, terracotta, ridge_radius=0.22 * s)
    add_box("clerestory", (0, 0, 1.14 * s), (0.22 * s, 0.22 * s, 0.14 * s), whitewash)
    add_hip_roof("clerestory_roof", (0, 0, 1.24 * s), 0.16 * s, 0.06 * s, terracotta, ridge_radius=0.1 * s)

    porch_x = half - 0.02 * s
    for y in (-0.2 * s, 0.2 * s):
        add_cylinder("column", (porch_x, y, 0.48 * s), 0.04 * s, 0.76 * s, marble, vertices=14)
        add_box("capital", (porch_x, y, 0.89 * s), (0.1 * s, 0.1 * s, 0.04 * s), marble)
    add_box("porch_roof", (half + 0.02 * s, 0, 0.89 * s), (0.1 * s, 0.46 * s, 0.03 * s), marble)

    add_openings(half, 0.4 * s, 0.76 * s, night, wood)

    add_wall("courtyard_wall", (0, -half - 0.09 * s, 0.11 * s), 0.6 * s, 0.2 * s, 0.04 * s, stone, along_x=True)

    add_cypress_pot("cypress", (-half - 0.1 * s, half + 0.05 * s, 0.0), 0.38 * s, clay, cypress)

    return {"kind": "house", "variant": 3, "footprint": 1, "height": 1.4 * s + 0.2}


def build_wheat_farm(phase):
    """Farmhouse with a terracotta roof; low golden wheat rows behind a stone wall."""
    night = phase >= SUN_PHASES
    soil = material("soil", SOIL, roughness=0.98)
    crop = material("crop", STRAW, roughness=0.85)
    ochre = material("ochre", OCHRE, roughness=0.9)
    terracotta = material("terracotta", TERRACOTTA, roughness=0.55)
    stone = material("stone", STONE, roughness=0.8)
    wood = material("wood", WOOD, roughness=0.85)

    add_box("field", (-0.2, -0.2, 0.03), (1.5, 1.5, 0.06), soil)
    for index in range(8):
        y = -0.85 + index * 0.2
        add_box("row", (-0.2, y, 0.13), (1.3, 0.12, 0.14), crop)

    add_wall("wall_south", (-0.2, -1.0, 0.11), 1.6, 0.22, 0.08, stone, along_x=True)
    add_wall("wall_west", (-1.0, -0.2, 0.11), 1.6, 0.22, 0.08, stone, along_x=False)

    hx, hy = 0.62, 0.62
    add_box("hut_wall", (hx, hy, 0.23), (0.44, 0.44, 0.46), ochre)
    add_hip_roof("hut_roof", (hx, hy, 0.51), 0.24, 0.07, terracotta, ridge_radius=0.15)
    add_openings(0.22, 0.28, 0.46, night, wood, (hx, hy))

    return {"kind": "wheatFarm", "variant": 0, "footprint": 2, "height": 0.65}


def build_granary(phase):
    """Stone base, whitewashed walls, a big terracotta roof, storage jars, loading door."""
    stone = material("stone", STONE, roughness=0.75)
    whitewash = material("whitewash", WHITEWASH, roughness=0.85)
    terracotta = material("terracotta", TERRACOTTA, roughness=0.55)
    wood = material("wood", WOOD, roughness=0.8)
    clay = material("clay", CLAY, roughness=0.8)
    vent = material("vent", (0.08, 0.06, 0.05), roughness=0.6)

    add_box("base", (0, 0, 0.09), (1.7, 1.7, 0.18), stone)
    add_box("walls", (0, 0, 0.53), (1.1, 1.1, 0.7), whitewash)
    add_box("cornice", (0, 0, 0.91), (1.5, 1.5, 0.06), stone)
    add_hip_roof("roof", (0, 0, 1.04), 0.6, 0.16, terracotta, ridge_radius=0.34)

    add_box("loading_door", (0.56, 0, 0.42), (0.05, 0.36, 0.5), wood)
    for y in (-0.35, 0.35):
        add_box("vent", (-0.56, y, 0.68), (0.05, 0.14, 0.16), vent)

    add_amphora("jar1", (0.95, -0.3, 0.0), 0.4, clay)
    add_amphora("jar2", (0.95, 0.1, 0.0), 0.36, clay)

    return {"kind": "granary", "variant": 0, "footprint": 2, "height": 1.25}


def build_fountain(phase):
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


def build_statue(phase):
    """Marble on a stepped plinth, a bronze figure with green patina accents."""
    stone = material("stone", STONE, roughness=0.7)
    marble = material("marble", MARBLE, roughness=0.3)
    bronze = material("bronze", BRONZE, roughness=0.35, metallic=1.0)
    patina = material("patina", PATINA, roughness=0.6)

    add_box("step1", (0, 0, 0.05), (0.76, 0.76, 0.1), stone)
    add_box("step2", (0, 0, 0.13), (0.6, 0.6, 0.08), stone)
    add_box("pedestal", (0, 0, 0.33), (0.46, 0.46, 0.32), marble)
    add_box("cap", (0, 0, 0.51), (0.52, 0.52, 0.05), marble)

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


MODELS = {
    "granary": build_granary,
    "wheat-farm": build_wheat_farm,
    "fountain": build_fountain,
    "statue": build_statue,
    "house-0": build_house_0,
    "house-1": build_house_1,
    "house-2": build_house_2,
    "house-3": build_house_3,
}


def add_ground():
    bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, 0))
    ground = bpy.context.active_object
    ground.name = "shadow_catcher"
    ground.is_shadow_catcher = True
    ground.data.materials.append(material("ground", (0.5, 0.5, 0.5), roughness=1.0))
    return ground


def add_camera(footprint, height, resolution):
    bpy.ops.object.camera_add(location=(0, 0, 0))
    camera = bpy.context.active_object
    camera.data.type = "ORTHO"
    camera.rotation_euler = (math.pi / 2 - CAMERA_ELEVATION, 0, CAMERA_YAW)

    scene = bpy.context.scene
    scene.camera = camera
    scene.render.resolution_x = resolution[0]
    scene.render.resolution_y = resolution[1]
    scene.render.resolution_percentage = 100
    camera.data.ortho_scale = resolution[0] / (PIXELS_PER_UNIT * SUPERSAMPLE)

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


def add_sun(phase):
    """Phase 0..SUN_PHASES-1 walks the day arc; SUN_PHASES is night."""
    night = phase >= SUN_PHASES
    bpy.ops.object.light_add(type="SUN", location=(0, 0, 12))
    sun = bpy.context.active_object

    if night:
        sun.data.energy = 0.6
        sun.data.color = (0.55, 0.68, 1.0)
        sun.data.angle = math.radians(20)
        altitude = math.radians(55)
        azimuth = math.radians(200)
    else:
        progress = (phase + 0.5) / SUN_PHASES
        altitude = math.radians(12 + 62 * math.sin(progress * math.pi))
        azimuth = math.radians(20 + 140 * progress)
        warmth = 1 - math.sin(progress * math.pi)
        sun.data.energy = 2.4
        sun.data.color = (1.0, 0.94 - 0.16 * warmth, 0.84 - 0.34 * warmth)
        sun.data.angle = math.radians(5 + 8 * warmth)

    sun.rotation_euler = (math.pi / 2 - altitude, 0, azimuth)

    world = bpy.data.worlds.new("world")
    bpy.context.scene.world = world
    world.use_nodes = True
    background = world.node_tree.nodes["Background"]
    background.inputs[0].default_value = (0.42, 0.52, 0.68, 1) if night else (0.55, 0.62, 0.72, 1)
    background.inputs[1].default_value = 0.35 if night else 0.9
    return sun


def render_phase(name, spec, phase, out_dir):
    resolution = (
        int((spec["footprint"] * TILE_WIDTH + 120) * SUPERSAMPLE),
        int((spec["footprint"] * TILE_HEIGHT + spec["height"] * 90 + 120) * SUPERSAMPLE),
    )
    add_camera(spec["footprint"], spec["height"], resolution)
    add_sun(phase)

    path = os.path.join(out_dir, f"{name}-{phase}.png")
    bpy.context.scene.render.filepath = path
    bpy.context.scene.render.image_settings.file_format = "PNG"
    bpy.context.scene.render.image_settings.color_mode = "RGBA"
    bpy.ops.render.render(write_still=True)
    return path, resolution


def main():
    args = parse_args()
    out_dir = os.path.abspath(args.out)
    os.makedirs(out_dir, exist_ok=True)

    manifest_path = os.path.join(out_dir, "manifest.json")
    manifest = {"tileWidth": TILE_WIDTH, "tileHeight": TILE_HEIGHT, "supersample": SUPERSAMPLE, "sprites": []}

    names = args.only.split(",") if args.only else list(MODELS)
    phases = [int(phase) for phase in args.phases.split(",")] if args.phases else list(range(SUN_PHASES + 1))
    rebuilt = {f"{name}-{phase}.png" for name in names for phase in phases}

    if len(rebuilt) < len(MODELS) * (SUN_PHASES + 1) and os.path.exists(manifest_path):
        with open(manifest_path) as handle:
            existing = json.load(handle)
        manifest["sprites"] = [s for s in existing["sprites"] if s["file"] not in rebuilt]

    for name in names:
        for phase in phases:
            clear_scene()
            spec = MODELS[name](phase)
            add_ground()
            path, resolution = render_phase(name, spec, phase, out_dir)

            manifest["sprites"].append(
                {
                    "kind": spec["kind"],
                    "variant": spec["variant"],
                    "phase": phase,
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
