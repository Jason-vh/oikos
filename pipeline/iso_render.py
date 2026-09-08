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


def add_eaves(name, half_side, z, mat):
    """Thin slab under the roof edge so the overhang reads from below."""
    return add_box(name, (0, 0, z - 0.0125), (half_side * 2, half_side * 2, 0.025), mat)


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


def build_house_0():
    """Shack: rough fieldstone walls, deep straw roof, lean-to, pot by the door."""
    fieldstone = plaster_material("fieldstone", FIELDSTONE, roughness=0.95, variation=0.12, scale=14.0)
    straw_dull = plaster_material("straw_dull", STRAW_DULL, roughness=0.95, variation=0.1, scale=20.0)
    straw_ridge = material("straw_ridge", STRAW_RIDGE, roughness=0.85)
    wood = material("wood", WOOD, roughness=0.85)
    clay = material("clay", CLAY, roughness=0.8)

    half = 0.32
    wall_h = 0.34
    add_box("walls", (0, 0, wall_h / 2), (half * 2, half * 2, wall_h), fieldstone)
    add_door(half, 0.26, wood)
    add_window_row(half, 0.2, (0.1, 0.1))

    eave_half = half + 0.07
    eave_h = 0.05
    cap_h = 0.24
    ridge_h = 0.05
    add_hip_roof("roof_eave", (0, 0, wall_h + eave_h / 2), eave_half, eave_h, straw_dull, ridge_half=eave_half - 0.02)
    add_hip_roof("roof_cap", (0, 0, wall_h + eave_h + cap_h / 2), eave_half - 0.02, cap_h, straw_dull, ridge_half=0.07)
    add_hip_roof("roof_ridge", (0, 0, wall_h + eave_h + cap_h + ridge_h / 2), 0.08, ridge_h, straw_ridge, ridge_half=0.02)
    top = wall_h + eave_h + cap_h + ridge_h

    lean_x = half + 0.08
    add_box("leanto_roof", (lean_x, -0.02, 0.24), (0.16, 0.3, 0.02), straw_dull)
    for y in (-0.15, 0.11):
        add_cylinder("leanto_post", (lean_x + 0.07, y, 0.12), 0.014, 0.23, wood, vertices=8)
    add_amphora("pot", (half + 0.07, 0.2, 0.0), 0.12, clay)

    return {"kind": "house", "variant": 0, "footprint": 1, "height": top + 0.1}


def build_house_1():
    """Hovel: mud-plaster ochre walls, pitched terracotta roof, small wooden awning."""
    ochre = plaster_material("ochre", OCHRE, roughness=0.9, variation=0.08, scale=8.0)
    terracotta = roof_material("terracotta", TERRACOTTA)
    stone = plaster_material("stone", STONE, roughness=0.85, variation=0.06, scale=10.0)
    wood = material("wood", WOOD, roughness=0.85)

    half = 0.34
    wall_h = 0.42
    add_box("plinth", (0, 0, 0.02), (half * 2 + 0.05, half * 2 + 0.05, 0.04), stone)
    add_box("walls", (0, 0, 0.04 + wall_h / 2), (half * 2, half * 2, wall_h), ochre)
    add_door(half, 0.3, wood)
    add_window_row(half, 0.28, (0.12, 0.12))

    roof_z = 0.04 + wall_h
    roof_h = 0.2
    add_hip_roof("roof", (0, 0, roof_z + roof_h / 2), half + 0.05, roof_h, terracotta, ridge_half=0.09)
    add_box("ridge", (0, 0, roof_z + roof_h + 0.01), (0.2, 0.05, 0.03), terracotta)

    add_box("awning", (half + 0.05, 0, 0.3), (0.1, 0.32, 0.02), wood)
    for y in (-0.13, 0.13):
        add_cylinder("awning_post", (half + 0.09, y, 0.15), 0.014, 0.29, wood, vertices=8)

    return {"kind": "house", "variant": 2, "footprint": 1, "height": roof_z + roof_h + 0.1}


def build_house_2():
    """Tenement: whitewashed walls, terracotta hip roof, pergola, amphorae, chimney."""
    whitewash = plaster_material("whitewash", WHITEWASH, roughness=0.85, variation=0.05, scale=6.0)
    terracotta = roof_material("terracotta", TERRACOTTA)
    stone = plaster_material("stone", STONE, roughness=0.8, variation=0.06, scale=10.0)
    wood = material("wood", WOOD, roughness=0.8)
    clay = material("clay", CLAY, roughness=0.8)
    brick = material("brick", (0.5, 0.3, 0.22), roughness=0.85)

    half = 0.35
    wall_h = 0.54
    add_box("plinth", (0, 0, 0.025), (half * 2 + 0.05, half * 2 + 0.05, 0.05), stone)
    add_box("walls", (0, 0, 0.05 + wall_h / 2), (half * 2, half * 2, wall_h), whitewash)
    add_box("cornice", (0, 0, 0.05 + wall_h + 0.015), (half * 2 + 0.04, half * 2 + 0.04, 0.03), stone)
    add_door(half, 0.32, wood)
    add_window_row(half, 0.4, (0.12, 0.14), on_door_face=True)

    roof_z = 0.05 + wall_h + 0.03
    roof_h = 0.22
    eave = half + 0.09
    add_eaves("eaves", eave, roof_z, wood)
    add_hip_roof("roof", (0, 0, roof_z + roof_h / 2), eave, roof_h, terracotta, ridge_half=0.1)
    add_box("ridge", (0, 0, roof_z + roof_h + 0.01), (0.22, 0.05, 0.03), terracotta)
    add_box("chimney", (-0.16, 0.16, roof_z + roof_h - 0.02), (0.07, 0.07, 0.2), brick)

    add_pergola("pergola", -half, 0.0, 0.0, 0.12, 0.44, 0.3, wood)
    add_amphora("jar1", (half + 0.07, -0.2, 0.0), 0.14, clay)
    add_amphora("jar2", (half + 0.07, 0.24, 0.0), 0.12, clay)

    return {"kind": "house", "variant": 4, "footprint": 1, "height": roof_z + roof_h + 0.1}


def build_house_3():
    """Homestead: two storeys of whitewash with marble trim, clerestory roof, columned porch, cypress."""
    whitewash = plaster_material("whitewash", WHITEWASH, roughness=0.85, variation=0.05, scale=6.0)
    terracotta = roof_material("terracotta", TERRACOTTA)
    marble = material("marble", MARBLE, roughness=0.35)
    stone = plaster_material("stone", STONE, roughness=0.8, variation=0.06, scale=10.0)
    wood = material("wood", WOOD, roughness=0.8)
    clay = material("clay", CLAY, roughness=0.8)
    cypress = material("cypress", CYPRESS, roughness=0.9)
    brick = material("brick", (0.5, 0.3, 0.22), roughness=0.85)

    half = 0.36
    wall_h = 0.72
    add_box("plinth", (0, 0, 0.03), (half * 2 + 0.05, half * 2 + 0.05, 0.06), stone)
    add_box("walls", (0, 0, 0.06 + wall_h / 2), (half * 2, half * 2, wall_h), whitewash)
    add_box("string_course", (0, 0, 0.06 + 0.38), (half * 2 + 0.03, half * 2 + 0.03, 0.025), marble)
    add_box("cornice", (0, 0, 0.06 + wall_h + 0.02), (half * 2 + 0.05, half * 2 + 0.05, 0.04), marble)
    add_door(half, 0.34, wood)
    add_window_row(half, 0.26, (0.12, 0.14))
    add_window_row(half, 0.6, (0.12, 0.14), on_door_face=True)

    roof_z = 0.06 + wall_h + 0.04
    roof_h = 0.18
    eave = half + 0.09
    add_eaves("eaves", eave, roof_z, wood)
    add_hip_roof("roof", (0, 0, roof_z + roof_h / 2), eave, roof_h, terracotta, ridge_half=0.14)
    add_box("clerestory", (0, 0, roof_z + roof_h + 0.06), (0.22, 0.22, 0.12), whitewash)
    add_box("chimney", (-0.2, 0.2, roof_z + roof_h * 0.45 + 0.1), (0.07, 0.07, 0.24), brick)
    add_hip_roof("clerestory_roof", (0, 0, roof_z + roof_h + 0.12 + 0.04), 0.15, 0.08, terracotta, ridge_half=0.03)
    top = roof_z + roof_h + 0.2

    porch_x = half + 0.06
    for y in (-0.18, 0.18):
        add_cylinder("column", (porch_x, y, 0.06 + 0.19), 0.03, 0.38, marble, vertices=14)
        add_box("capital", (porch_x, y, 0.06 + 0.39), (0.08, 0.08, 0.03), marble)
    add_box("porch_roof", (half + 0.05, 0, 0.06 + 0.42), (0.14, 0.44, 0.03), marble)

    add_wall("courtyard_wall", (0.05, -half - 0.08, 0.08), 0.5, 0.16, 0.035, stone, along_x=True)
    add_cypress_pot("cypress", (-half - 0.09, half + 0.05, 0.0), 0.32, clay, cypress)

    return {"kind": "house", "variant": 6, "footprint": 1, "height": top + 0.1}


def build_house_4():
    """Apartment: a taller block with a loggia, tiled roof, balcony rail and a roof terrace."""
    whitewash = plaster_material("whitewash", WHITEWASH, roughness=0.85, variation=0.05, scale=6.0)
    terracotta = roof_material("terracotta", TERRACOTTA)
    marble = material("marble", MARBLE, roughness=0.32)
    stone = plaster_material("stone", STONE, roughness=0.8, variation=0.06, scale=10.0)
    wood = material("wood", WOOD, roughness=0.8)
    clay = material("clay", CLAY, roughness=0.8)
    cypress = material("cypress", CYPRESS, roughness=0.9)

    half = 0.38
    wall_h = 0.92
    add_box("plinth", (0, 0, 0.035), (half * 2 + 0.07, half * 2 + 0.07, 0.07), stone)
    add_box("walls", (0, 0, 0.07 + wall_h / 2), (half * 2, half * 2, wall_h), whitewash)
    add_box("string_course", (0, 0, 0.07 + 0.44), (half * 2 + 0.04, half * 2 + 0.04, 0.03), marble)
    add_box("cornice", (0, 0, 0.07 + wall_h + 0.02), (half * 2 + 0.06, half * 2 + 0.06, 0.045), marble)
    add_door(half, 0.36, wood)
    add_window_row(half, 0.24, (0.12, 0.14))
    add_window_row(half, 0.58, (0.12, 0.16), on_door_face=True)
    add_window_row(half, 0.78, (0.12, 0.14))

    balcony_z = 0.07 + 0.56
    add_box("balcony", (half + 0.07, 0, balcony_z), (0.18, half * 1.5, 0.04), marble)
    for y in (-0.26, 0.0, 0.26):
        add_cylinder("baluster", (half + 0.14, y, balcony_z + 0.07), 0.018, 0.14, marble, vertices=8)
    add_box("balcony_rail", (half + 0.14, 0, balcony_z + 0.15), (0.05, half * 1.5, 0.025), marble)

    roof_z = 0.07 + wall_h + 0.045
    roof_h = 0.2
    eave = half + 0.1
    add_eaves("eaves", eave, roof_z, wood)
    add_hip_roof("roof", (0, 0, roof_z + roof_h / 2), eave, roof_h, terracotta, ridge_half=0.16)
    top = roof_z + roof_h

    add_cypress_pot("cypress", (-half - 0.11, half + 0.06, 0.0), 0.34, clay, cypress)
    add_amphora("jar", (half + 0.12, -half - 0.06, 0.0), 0.26, clay)

    return {"kind": "house", "variant": 8, "footprint": 1, "height": top + 0.1}


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
    """Reflect across the x = -y plane so the door and windows swap camera-facing sides."""

    def build():
        spec = builder()
        for obj in bpy.data.objects:
            if obj.type == "MESH":
                obj.matrix_world = MIRROR_DIAGONAL @ obj.matrix_world
        return {**spec, "variant": spec["variant"] + 1}

    return build


HOUSES = [build_house_0, build_house_1, build_house_2, build_house_3, build_house_4]

MODELS = {
    "granary": build_granary,
    "tax-office": build_tax_office,
    "agora": build_agora,
    "growers-lodge": build_growers_lodge,
    "college": build_college,
    "podium": build_podium,
    "maintenance-office": build_maintenance_office,
    "olive-press": build_olive_press,
    "wheat-farm": build_wheat_farm,
    "fountain": build_fountain,
    "statue": build_statue,
}
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
