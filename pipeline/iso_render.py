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
import random
import sys

import bpy
from mathutils import Matrix, Vector

TILE_WIDTH = 120
TILE_HEIGHT = 60
SUN_ALTITUDE = math.radians(50)
SUN_AZIMUTH = math.radians(-25)
SUPERSAMPLE = 2
SAMPLES = 16
PAINT_VARIATION = 0.16
GRIME = 0.22
PIXELS_PER_UNIT = TILE_WIDTH / math.sqrt(2)
CAMERA_ELEVATION = math.radians(30)
CAMERA_YAW = math.radians(45)


def hex_rgb(code):
    return tuple(int(code[i : i + 2], 16) / 255 for i in (0, 2, 4))


def shade_hex(code, factor):
    return tuple(min(1.0, channel * factor) for channel in hex_rgb(code))


WHITEWASH = hex_rgb("f8e0b0")
TERRACOTTA = hex_rgb("b4451c")
TERRACOTTA_LIGHT = hex_rgb("cf5e2a")
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
EARTH = hex_rgb("c4a94f")
DAUB = hex_rgb("a4794c")
DAUB_LIGHT = hex_rgb("b98d5c")
THATCH = hex_rgb("b8964a")
THATCH_DARK = hex_rgb("8f7236")
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
    """Base material with a painterly mottle: a broad blotch of noise for the wash of
    the brush, a fine one for its grain, and a darker grime near the ground. The
    original's walls are anything but flat."""
    mat = material(name, colour, roughness=roughness)
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    bsdf = nodes["Principled BSDF"]
    variation = max(variation, PAINT_VARIATION)

    blotch = nodes.new("ShaderNodeTexNoise")
    blotch.inputs["Scale"].default_value = scale
    blotch.inputs["Detail"].default_value = 2.0
    link_object_coords(mat, blotch)
    grain = nodes.new("ShaderNodeTexNoise")
    grain.inputs["Scale"].default_value = scale * 6
    grain.inputs["Detail"].default_value = 1.0
    link_object_coords(mat, grain)
    mottle = nodes.new("ShaderNodeMath")
    mottle.operation = "MULTIPLY_ADD"
    mottle.inputs[1].default_value = 0.65
    mottle.inputs[2].default_value = 0.0
    links.new(blotch.outputs["Fac"], mottle.inputs[0])
    fine = nodes.new("ShaderNodeMath")
    fine.operation = "MULTIPLY_ADD"
    fine.inputs[1].default_value = 0.35
    links.new(grain.outputs["Fac"], fine.inputs[0])
    links.new(mottle.outputs["Value"], fine.inputs[2])

    darker = tuple(to_linear(c) * (1 - variation * 2) for c in colour)
    mix = nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.inputs["A"].default_value = (*darker, 1)
    mix.inputs["B"].default_value = bsdf.inputs["Base Color"].default_value
    links.new(fine.outputs["Value"], mix.inputs["Factor"])

    coords = nodes.new("ShaderNodeTexCoord")
    separate = nodes.new("ShaderNodeSeparateXYZ")
    links.new(coords.outputs["Object"], separate.inputs["Vector"])
    grime = nodes.new("ShaderNodeMapRange")
    grime.inputs["From Min"].default_value = -0.5
    grime.inputs["From Max"].default_value = 0.1
    grime.inputs["To Min"].default_value = 1 - GRIME
    grime.inputs["To Max"].default_value = 1.0
    links.new(separate.outputs["Z"], grime.inputs["Value"])
    grimed = nodes.new("ShaderNodeMix")
    grimed.data_type = "RGBA"
    grimed.blend_type = "MULTIPLY"
    grimed.inputs["Factor"].default_value = 1.0
    links.new(mix.outputs["Result"], grimed.inputs["A"])
    links.new(grime.outputs["Result"], grimed.inputs["B"])
    links.new(grimed.outputs["Result"], bsdf.inputs["Base Color"])
    return mat


def roof_material(name, colour, rows_per_unit=5.0, roughness=0.78):
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
    brick.inputs["Color1"].default_value = (1.05, 1.0, 0.95, 1)
    brick.inputs["Color2"].default_value = (0.82, 0.8, 0.78, 1)
    brick.inputs["Mortar"].default_value = (0.32, 0.3, 0.3, 1)
    link_object_coords(mat, brick)
    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.7
    bump.inputs["Distance"].default_value = 0.03
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


def cobble_material(name, colour, stones_per_unit=9.0, roughness=0.9, spread=0.16):
    """Cobbles: one Voronoi cell to a stone, tinting each a little differently, with a
    second Voronoi for the gaps between them driving the bump."""
    mat = plaster_material(name, colour, roughness=roughness, variation=0.05, scale=stones_per_unit * 2)
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    bsdf = nodes["Principled BSDF"]

    stones = nodes.new("ShaderNodeTexVoronoi")
    stones.feature = "F1"
    stones.inputs["Scale"].default_value = stones_per_unit
    stones.inputs["Randomness"].default_value = 0.85
    link_object_coords(mat, stones)

    gaps = nodes.new("ShaderNodeTexVoronoi")
    gaps.feature = "DISTANCE_TO_EDGE"
    gaps.inputs["Scale"].default_value = stones_per_unit
    gaps.inputs["Randomness"].default_value = 0.85
    link_object_coords(mat, gaps)

    tint = nodes.new("ShaderNodeValToRGB")
    tint.color_ramp.elements[0].position = 0.0
    tint.color_ramp.elements[0].color = (1 - spread, 1 - spread, 1 - spread * 0.7, 1)
    tint.color_ramp.elements[1].position = 1.0
    tint.color_ramp.elements[1].color = (1 + spread, 1 + spread, 1 + spread * 0.7, 1)
    links.new(stones.outputs["Color"], tint.inputs["Fac"])

    shade = nodes.new("ShaderNodeMix")
    shade.data_type = "RGBA"
    shade.blend_type = "MULTIPLY"
    shade.inputs["Factor"].default_value = 1.0
    links.new(bsdf.inputs["Base Color"].links[0].from_socket, shade.inputs["A"])
    links.new(tint.outputs["Color"], shade.inputs["B"])
    links.new(shade.outputs["Result"], bsdf.inputs["Base Color"])

    grout = nodes.new("ShaderNodeValToRGB")
    grout.color_ramp.elements[0].position = 0.0
    grout.color_ramp.elements[0].color = (0.42, 0.4, 0.35, 1)
    grout.color_ramp.elements[1].position = 0.07
    grout.color_ramp.elements[1].color = (1, 1, 1, 1)
    links.new(gaps.outputs["Distance"], grout.inputs["Fac"])

    joints = nodes.new("ShaderNodeMix")
    joints.data_type = "RGBA"
    joints.blend_type = "MULTIPLY"
    joints.inputs["Factor"].default_value = 1.0
    links.new(bsdf.inputs["Base Color"].links[0].from_socket, joints.inputs["A"])
    links.new(grout.outputs["Color"], joints.inputs["B"])
    links.new(joints.outputs["Result"], bsdf.inputs["Base Color"])

    rounded = nodes.new("ShaderNodeValToRGB")
    rounded.color_ramp.elements[0].position = 0.0
    rounded.color_ramp.elements[1].position = 0.2
    links.new(gaps.outputs["Distance"], rounded.inputs["Fac"])

    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 1.0
    bump.inputs["Distance"].default_value = 0.05
    links.new(rounded.outputs["Color"], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
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
    """The ground of a housing plot. The tile beneath is drawn by the game, as in
    the original, so the yard is not rendered: it only catches the light that keeps
    the walls from floating."""
    yard = add_box("yard", (0, 0, 0.0025), (half * 2, half * 2, 0.005), mat)
    yard.visible_shadow = False
    yard.visible_camera = False
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


STAKE_HEIGHT = 0.26
STAKE_SPACING = 0.85
STRING_HEIGHT = 0.2


def add_survey_stake(name, centre, wood, cap):
    """One marker: a peeled post driven in. What lies beside it is its own shadow."""
    cx, cy, cz = centre
    add_cylinder(f"{name}_post", (cx, cy, cz + STAKE_HEIGHT / 2), 0.03, STAKE_HEIGHT, wood, vertices=10)
    add_cylinder(f"{name}_cap", (cx, cy, cz + STAKE_HEIGHT + 0.003), 0.031, 0.014, cap, vertices=10)


def add_string(name, start, end, z, mat):
    """Surveyor's twine run from stake to stake."""
    (ax, ay), (bx, by) = start, end
    cord = add_box(name, ((ax + bx) / 2, (ay + by) / 2, z), (math.hypot(bx - ax, by - ay), 0.016, 0.016), mat)
    cord.rotation_euler[2] = math.atan2(by - ay, bx - ax)
    cord.visible_shadow = False
    return cord


def plot_boundary(footprint, rng):
    """Stake positions walked round the edge of the plot, each nudged off true."""
    reach = footprint / 2 - 0.18
    corners = [(-reach, -reach), (reach, -reach), (reach, reach), (-reach, reach)]
    steps = max(2, round(footprint / STAKE_SPACING)) * 4

    spots = []
    for step in range(steps):
        walk = step / steps * 4
        side = int(walk)
        along = walk - side
        (ax, ay), (bx, by) = corners[side], corners[(side + 1) % 4]
        spots.append(
            (
                ax + (bx - ax) * along + rng.uniform(-0.07, 0.07),
                ay + (by - ay) * along + rng.uniform(-0.07, 0.07),
            )
        )
    return spots


def build_plot(kind, footprint):
    """A plot pegged out and left: stakes stood about the trodden ground in no
    particular order, and nothing else built yet."""
    wood = material("wood", hex_rgb("6b4a26"), roughness=0.92)
    cap = material("cap", hex_rgb("cbb184"), roughness=0.9)
    twine = material("twine", hex_rgb("e2d8b4"), roughness=0.95)

    rng = random.Random(footprint * 7717)
    boundary = plot_boundary(footprint, rng)

    for index, spot in enumerate(boundary):
        add_string(f"string{index}", spot, boundary[(index + 1) % len(boundary)], STRING_HEIGHT, twine)

    for index, (sx, sy) in enumerate(boundary + [(rng.uniform(-0.1, 0.1), rng.uniform(-0.1, 0.1))]):
        add_survey_stake(f"stake{index}", (sx, sy, 0.0), wood, cap)

    return {"kind": kind, "variant": 0, "footprint": footprint, "height": 0.3}


BLUE_PAINT = hex_rgb("3d6a9c")
HIDE = hex_rgb("9c7a44")
SACK = hex_rgb("cdb37c")


def house_materials():
    return {
        "earth": plaster_material("earth", EARTH, roughness=0.98, variation=0.1, scale=16.0),
        "daub": plaster_material("daub", DAUB, roughness=0.97, variation=0.18, scale=9.0),
        "daub_light": plaster_material("daub_light", DAUB_LIGHT, roughness=0.95, variation=0.16, scale=9.0),
        "ochre": plaster_material("ochre", OCHRE, roughness=0.9, variation=0.16, scale=7.0),
        "whitewash": plaster_material("whitewash", WHITEWASH, roughness=0.86, variation=0.14, scale=5.0),
        "thatch": plaster_material("thatch", THATCH, roughness=0.96, variation=0.18, scale=22.0),
        "thatch_dark": plaster_material("thatch_dark", THATCH_DARK, roughness=0.96, variation=0.16, scale=18.0),
        "terracotta": roof_material("terracotta", TERRACOTTA),
        "stone": plaster_material("stone", STONE, roughness=0.88, variation=0.12, scale=11.0),
        "wood": material("wood", WOOD, roughness=0.9),
        "clay": material("clay", CLAY, roughness=0.85),
        "blue": material("blue", BLUE_PAINT, roughness=0.7),
        "hide": plaster_material("hide", HIDE, roughness=0.95, variation=0.2, scale=8.0),
        "sack": plaster_material("sack", SACK, roughness=0.98, variation=0.14, scale=20.0),
    }


def add_lean_to(name, centre, half_x, half_y, pitch_x, mat, wood, post_height):
    """A sheet of roof on two posts, sloping down towards +X."""
    cx, cy, cz = centre
    add_shed_roof(f"{name}_sheet", (cx, cy, cz), half_x, half_y, 0.035, mat, pitch=pitch_x)
    for sy in (-1, 1):
        add_cylinder(f"{name}_post", (cx + half_x - 0.04, cy + sy * (half_y - 0.05), cz - post_height / 2 - 0.02), 0.02, post_height, wood, vertices=6)


def add_picket_fence(name, start, end, wood, height=0.26, spacing=0.22):
    """Posts and two rails, from one point to another on the ground."""
    (ax, ay), (bx, by) = start, end
    length = math.hypot(bx - ax, by - ay)
    angle = math.atan2(by - ay, bx - ax)
    posts = max(2, int(length / spacing) + 1)
    for index in range(posts):
        t = index / (posts - 1)
        add_cylinder(f"{name}_post", (ax + (bx - ax) * t, ay + (by - ay) * t, height / 2), 0.022, height, wood, vertices=6)
    for z in (height * 0.45, height * 0.85):
        rail = add_box(f"{name}_rail", ((ax + bx) / 2, (ay + by) / 2, z), (length, 0.03, 0.03), wood)
        rail.rotation_euler[2] = angle


def add_sack(name, centre, mat):
    cx, cy, cz = centre
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.11, location=(cx, cy, cz + 0.09), segments=10, ring_count=6)
    sack = bpy.context.active_object
    sack.name = name
    sack.scale = (1.0, 1.0, 0.8)
    sack.data.materials.append(mat)
    bpy.ops.object.shade_smooth()
    return sack


def add_shutters(half, z, size, mat, centre=(0.0, 0.0), on_door_face=False):
    """Painted shutters either side of the windows on the -Y face, and on +X if asked."""
    cx, cy = centre
    window_w, window_h = size
    for offset in (-half * 0.55, half * 0.55):
        for side in (-1, 1):
            add_box("shutter", (cx + offset + side * window_w * 0.75, cy - half + 0.015, z), (window_w * 0.45, 0.03, window_h), mat)
            if on_door_face:
                add_box("shutter", (cx + half - 0.015, cy + offset + side * window_w * 0.75, z), (0.03, window_w * 0.45, window_h), mat)


def build_house_0():
    """Hut: a cone of poles and hide pitched on the bare plot, a jar and a fire ring."""
    m = house_materials()
    add_yard(m["earth"])

    tx, ty = -0.18, 0.14
    add_pyramid("tent", (tx, ty, 0.36), 0.56, 0.72, m["hide"], vertices=8)
    for angle in (0.3, 1.5, 2.9, 4.4):
        pole = add_cylinder("pole", (tx + math.cos(angle) * 0.04, ty + math.sin(angle) * 0.04, 0.62), 0.014, 0.42, m["wood"], vertices=5)
        pole.rotation_euler = (math.sin(angle) * 0.22, -math.cos(angle) * 0.22, 0)
    dark = material("doorway", SHADOW_DARK, roughness=0.9)
    add_box("opening", (tx + 0.42, ty - 0.04, 0.13), (0.14, 0.2, 0.26), dark)

    add_cylinder("fire_ring", (0.5, 0.42, 0.02), 0.15, 0.04, m["stone"], vertices=10)
    add_cylinder("embers", (0.5, 0.42, 0.035), 0.09, 0.03, m["wood"], vertices=8)
    add_amphora("pot", (0.52, -0.5, 0.0), 0.2, m["clay"])
    add_stump("stump", (-0.64, -0.6, 0.0), m["wood"])

    return {"kind": "house", "variant": 0, "footprint": 2, "height": 0.9}


def build_house_1():
    """Shack: one low room of daub under a flat straw roof, a sheet propped on poles, a fence."""
    m = house_materials()
    add_yard(m["earth"])

    cx, cy = -0.22, 0.08
    add_box("walls", (cx, cy, 0.21), (0.92, 0.72, 0.42), m["daub"])
    add_doorway(0.46, 0.3, (cx, cy), width=0.2)
    roof = add_box("roof", (cx, cy, 0.46), (1.06, 0.86, 0.07), m["thatch"])
    roof.rotation_euler[1] = 0.1
    add_box("eave_beam", (cx, cy - 0.4, 0.4), (1.0, 0.04, 0.04), m["wood"])

    add_lean_to("lean", (cx + 0.2, cy - 0.66, 0.34), 0.34, 0.22, 0.28, m["thatch_dark"], m["wood"], 0.3)
    add_picket_fence("fence", (0.2, -0.86), (0.86, -0.86), m["wood"])
    add_picket_fence("fence2", (0.86, -0.86), (0.86, -0.3), m["wood"])
    add_amphora("jar", (0.6, 0.5, 0.0), 0.2, m["clay"])
    add_stump("stump", (0.5, -0.5, 0.0), m["wood"])

    return {"kind": "house", "variant": 2, "footprint": 2, "height": 0.62}


def build_house_2():
    """Hovel: mud-brick walls under a pitched thatch, a lean-to store, a barrel and jars."""
    m = house_materials()
    add_yard(m["earth"])

    cx, cy = -0.14, 0.08
    add_box("walls", (cx, cy, 0.25), (1.0, 0.8, 0.5), m["ochre"])
    add_doorway(0.5, 0.32, (cx, cy), width=0.2)
    add_window_row(0.5, 0.34, (0.11, 0.1), (cx, cy))
    add_gable_roof("roof", (cx, cy, 0.5), 0.6, 0.5, 0.3, 0.07, m["thatch"])
    add_box("eave_beam", (cx, cy - 0.46, 0.46), (1.1, 0.04, 0.04), m["wood"])

    add_lean_to("store", (0.62, cy - 0.02, 0.42), 0.28, 0.34, 0.36, m["thatch_dark"], m["wood"], 0.32)
    add_cylinder("barrel", (0.6, -0.62, 0.11), 0.1, 0.22, m["wood"], vertices=10)
    add_amphora("jar1", (-0.7, -0.6, 0.0), 0.22, m["clay"])
    add_amphora("jar2", (-0.48, -0.7, 0.0), 0.17, m["clay"])
    add_picket_fence("fence", (-0.86, -0.86), (-0.2, -0.86), m["wood"], height=0.22)

    return {"kind": "house", "variant": 4, "footprint": 2, "height": 0.86}


def build_house_3():
    """Homestead: two low tiled ranges round a fenced yard with a well and sacks."""
    m = house_materials()
    add_yard(m["earth"])

    ax, ay = -0.36, 0.42
    add_box("range", (ax, ay, 0.24), (0.96, 0.62, 0.48), m["ochre"])
    add_gable_roof("range_roof", (ax, ay, 0.48), 0.56, 0.4, 0.24, 0.06, m["terracotta"])
    add_window_row(0.31, 0.3, (0.1, 0.1), (ax, ay))

    bx, by = 0.46, 0.4
    add_box("wing", (bx, by, 0.2), (0.6, 0.62, 0.4), m["whitewash"])
    add_shed_roof("wing_roof", (bx + 0.02, by, 0.46), 0.36, 0.38, 0.06, m["terracotta"], pitch=0.34)
    add_doorway(0.3, 0.3, (bx, by), width=0.18)

    add_wall("yard_wall_s", (-0.02, -0.84, 0.1), 1.7, 0.2, 0.08, m["stone"], along_x=True)
    add_wall("yard_wall_w", (-0.86, -0.2, 0.1), 1.24, 0.2, 0.08, m["stone"], along_x=False)
    add_picket_fence("fence", (0.86, -0.84), (0.86, 0.02), m["wood"], height=0.24)

    add_cylinder("well", (0.34, -0.36, 0.12), 0.14, 0.24, m["stone"], vertices=10)
    add_sack("sack1", (-0.5, -0.5, 0.0), m["sack"])
    add_sack("sack2", (-0.3, -0.62, 0.0), m["sack"])
    add_amphora("jar", (0.7, -0.6, 0.0), 0.22, m["clay"])

    return {"kind": "house", "variant": 6, "footprint": 2, "height": 0.86}


def build_house_4():
    """Tenement: a two-storey block with a single-storey wing, tiled at both levels, and a walled court."""
    m = house_materials()
    add_yard(m["earth"])

    mx, my = -0.34, 0.34
    add_box("main", (mx, my, 0.5), (1.0, 0.82, 1.0), m["whitewash"])
    add_gable_roof("main_roof", (mx, my, 1.0), 0.6, 0.5, 0.28, 0.06, m["terracotta"])
    add_window_row(0.41, 0.34, (0.12, 0.13), (mx, my))
    add_window_row(0.41, 0.78, (0.12, 0.14), (mx, my), on_door_face=True)
    add_shutters(0.41, 0.78, (0.12, 0.14), m["blue"], (mx, my))

    wx, wy = 0.5, 0.16
    add_box("wing", (wx, wy, 0.26), (0.64, 0.74, 0.52), m["ochre"])
    add_shed_roof("wing_roof", (wx + 0.02, wy, 0.58), 0.38, 0.44, 0.06, m["terracotta"], pitch=0.34)
    add_doorway(0.32, 0.34, (wx, wy), width=0.2)
    add_box("door_frame", (wx + 0.33, wy, 0.36), (0.02, 0.26, 0.04), m["blue"])

    add_wall("court_wall", (-0.28, -0.84, 0.15), 1.2, 0.3, 0.08, m["stone"], along_x=True)
    add_wall("court_wall_w", (-0.86, -0.42, 0.15), 0.84, 0.3, 0.08, m["stone"], along_x=False)
    add_amphora("jar1", (-0.6, -0.5, 0.0), 0.26, m["clay"])
    add_amphora("jar2", (-0.36, -0.62, 0.0), 0.2, m["clay"])
    add_sack("sack", (0.7, -0.66, 0.0), m["sack"])

    return {"kind": "house", "variant": 8, "footprint": 2, "height": 1.4}


def build_house_5():
    """Apartment: two storeys on both wings, a wooden balcony, blue shutters and a court."""
    m = house_materials()
    add_yard(m["earth"])

    mx, my = -0.3, 0.32
    add_box("main", (mx, my, 0.56), (1.12, 0.9, 1.12), m["whitewash"])
    add_hip_roof("main_roof", (mx, my, 1.12 + 0.15), 0.66, 0.3, m["terracotta"], ridge_half=0.16)
    add_window_row(0.45, 0.36, (0.12, 0.14), (mx, my))
    add_window_row(0.45, 0.84, (0.12, 0.15), (mx, my), on_door_face=True)
    add_shutters(0.45, 0.84, (0.12, 0.15), m["blue"], (mx, my), on_door_face=True)

    wx, wy = 0.52, -0.3
    add_box("wing", (wx, wy, 0.44), (0.66, 0.78, 0.88), m["ochre"])
    add_gable_roof("wing_roof", (wx, wy, 0.88), 0.4, 0.46, 0.22, 0.06, m["terracotta"])
    add_doorway(0.33, 0.36, (wx, wy), width=0.2)
    add_box("door_frame", (wx + 0.34, wy, 0.38), (0.02, 0.26, 0.04), m["blue"])

    balcony_z = 0.6
    add_box("balcony", (wx + 0.42, wy, balcony_z), (0.2, 0.5, 0.04), m["wood"])
    add_box("balcony_rail", (wx + 0.5, wy, balcony_z + 0.13), (0.03, 0.5, 0.03), m["blue"])
    for y in (wy - 0.22, wy, wy + 0.22):
        add_cylinder("baluster", (wx + 0.5, y, balcony_z + 0.07), 0.014, 0.14, m["blue"], vertices=6)
    add_box("balcony_window", (wx + 0.335, wy, balcony_z + 0.16), (0.02, 0.18, 0.24), m["blue"])

    add_wall("court_wall", (-0.3, -0.84, 0.16), 1.1, 0.32, 0.08, m["stone"], along_x=True)
    add_amphora("jar", (-0.62, -0.56, 0.0), 0.26, m["clay"])
    add_sack("sack", (-0.36, -0.62, 0.0), m["sack"])

    return {"kind": "house", "variant": 10, "footprint": 2, "height": 1.6}


def build_house_6():
    """Townhouse: a three-storey tower stepping down to two, then one, roofs at every level,
    a blue balcony and a painted band round the base."""
    m = house_materials()
    add_yard(m["earth"])
    add_box("kerb", (0, 0, 0.02), (PLOT_HALF * 2, PLOT_HALF * 2, 0.04), m["stone"])

    tx, ty = -0.4, 0.36
    add_box("tower", (tx, ty, 0.04 + 0.78), (0.92, 0.8, 1.56), m["whitewash"])
    add_gable_roof("tower_roof", (tx, ty, 0.04 + 1.56), 0.56, 0.5, 0.3, 0.06, m["terracotta"])
    for z in (0.4, 0.86, 1.3):
        add_window_row(0.4, 0.04 + z, (0.12, 0.14), (tx, ty))
    add_shutters(0.4, 0.04 + 1.3, (0.12, 0.14), m["blue"], (tx, ty))

    mx, my = 0.36, 0.38
    add_box("middle", (mx, my, 0.04 + 0.52), (0.7, 0.72, 1.04), m["whitewash"])
    add_hip_roof("middle_roof", (mx, my, 0.04 + 1.04 + 0.12), 0.42, 0.24, m["terracotta"], ridge_half=0.1)
    add_window_row(0.36, 0.04 + 0.8, (0.11, 0.13), (mx, my), on_door_face=True)

    fx, fy = 0.3, -0.44
    add_box("front", (fx, fy, 0.04 + 0.3), (0.72, 0.64, 0.6), m["ochre"])
    add_shed_roof("front_roof", (fx + 0.02, fy, 0.04 + 0.66), 0.42, 0.4, 0.06, m["terracotta"], pitch=0.32)
    add_doorway(0.36, 0.36, (fx, fy), width=0.2)
    add_box("door_frame", (fx + 0.37, fy, 0.04 + 0.4), (0.02, 0.28, 0.04), m["blue"])
    add_box("band", (fx, fy - 0.325, 0.04 + 0.1), (0.7, 0.02, 0.05), m["blue"])
    add_box("band_x", (fx + 0.365, fy, 0.04 + 0.1), (0.02, 0.62, 0.05), m["blue"])

    balcony_z = 0.04 + 1.1
    add_box("balcony", (tx + 0.56, ty - 0.1, balcony_z), (0.22, 0.5, 0.04), m["wood"])
    add_box("balcony_rail", (tx + 0.65, ty - 0.1, balcony_z + 0.14), (0.03, 0.5, 0.03), m["blue"])
    for y in (ty - 0.32, ty - 0.1, ty + 0.12):
        add_cylinder("baluster", (tx + 0.65, y, balcony_z + 0.08), 0.014, 0.16, m["blue"], vertices=6)
    add_box("balcony_door", (tx + 0.465, ty - 0.1, balcony_z + 0.18), (0.02, 0.2, 0.28), m["blue"])

    add_amphora("jar", (-0.72, -0.62, 0.04), 0.24, m["clay"])
    add_amphora("jar2", (-0.5, -0.74, 0.04), 0.18, m["clay"])

    return {"kind": "house", "variant": 12, "footprint": 2, "height": 2.0}



def build_growers_lodge():
    """The original's: the green-tiled farmhouse, olive trees in the plot before it."""
    olive = plaster_material("olive", hex_rgb("6f8a3a"), roughness=0.95, variation=0.2, scale=12.0)
    trunk = material("trunk", hex_rgb("5a3f22"), roughness=0.9)
    add_farmhouse((-0.15, 0.4))
    for index, (tx, ty) in enumerate(((-0.7, -0.5), (-0.2, -0.65), (0.3, -0.5), (0.7, -0.7))):
        add_cylinder(f"trunk{index}", (tx, ty, 0.12), 0.03, 0.24, trunk, vertices=6)
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.2, location=(tx, ty, 0.36), segments=10, ring_count=6)
        crown = bpy.context.active_object
        crown.name = f"crown{index}"
        crown.scale = (1.0, 1.0, 0.7)
        crown.data.materials.append(olive)
    return {"kind": "growersLodge", "variant": 0, "footprint": 2, "height": 1.2}

def workshop_materials():
    m = civic_materials()
    m["frame"] = plaster_material("frame", hex_rgb("c9a35a"), roughness=0.92, variation=0.16, scale=10.0)
    m["rubble"] = plaster_material("rubble", hex_rgb("c8b48a"), roughness=0.95, variation=0.18, scale=14.0)
    m["iron"] = material("iron", hex_rgb("3a3a40"), roughness=0.6, metallic=0.6)
    m["brick"] = plaster_material("brick", hex_rgb("a85a3a"), roughness=0.9, variation=0.16, scale=12.0)
    m["straw"] = plaster_material("straw", THATCH, roughness=0.96, variation=0.18, scale=22.0)
    return m


def add_timber_frame(name, centre, size, wood, roof_mat, roof_pitch=0.3):
    """An open frame, as the original's workshops are: four posts carrying beams, and
    a strip of plank roof along the back edge only, so the work stays in view."""
    cx, cy, cz = centre
    sx, sy, sz = size
    for px, py in ((cx - sx / 2, cy - sy / 2), (cx + sx / 2, cy - sy / 2), (cx - sx / 2, cy + sy / 2), (cx + sx / 2, cy + sy / 2)):
        add_cylinder(f"{name}_post", (px, py, cz + sz / 2), 0.025, sz, wood, vertices=6)
    for py in (cy - sy / 2, cy + sy / 2):
        add_box(f"{name}_beam", (cx, py, cz + sz), (sx + 0.06, 0.04, 0.04), wood)
    for px in (cx - sx / 2, cx + sx / 2):
        add_box(f"{name}_beam", (px, cy, cz + sz), (0.04, sy + 0.06, 0.04), wood)
    add_shed_roof(f"{name}_roof", (cx - sx / 4, cy, cz + sz + 0.04), sx / 4 + 0.06, sy / 2 + 0.08, 0.035, roof_mat, pitch=roof_pitch)
    add_box(f"{name}_rail", (cx - sx / 2, cy, cz + sz * 0.5), (0.03, sy, 0.03), wood)


def add_workshop_base(centre, size, stone):
    """The raised bed every workshop stands on, stepped down at the front corner."""
    cx, cy = centre
    sx, sy = size
    add_box("base", (cx, cy, 0.04 + 0.1), (sx, sy, 0.2), stone)
    for index in range(2):
        add_box(f"base_step{index}", (cx + sx / 2 + 0.1 + index * 0.12, cy - sy / 2 + 0.3, 0.04 + 0.15 - index * 0.06), (0.12, 0.5, 0.1), stone)


def add_stone_yard(mat, half=0.94):
    return add_box("yard", (0, 0, 0.02), (half * 2, half * 2, 0.04), mat)


def add_kiln(name, centre, height, brick, iron):
    cx, cy, cz = centre
    add_cylinder(f"{name}_base", (cx, cy, cz + 0.1), 0.24, 0.2, brick, vertices=12)
    add_cylinder(f"{name}_stack", (cx, cy, cz + 0.2 + height / 2), 0.16, height, brick, vertices=12)
    add_cylinder(f"{name}_band", (cx, cy, cz + 0.2 + height * 0.5), 0.17, 0.04, iron, vertices=12)
    add_cylinder(f"{name}_mouth", (cx, cy, cz + 0.2 + height + 0.02), 0.14, 0.04, iron, vertices=12)


def add_press(name, centre, wood, stone):
    """A screw press: a beam on two uprights, a stone bed and a basin below."""
    cx, cy, cz = centre
    add_cylinder(f"{name}_bed", (cx, cy, cz + 0.08), 0.22, 0.16, stone, vertices=12)
    add_cylinder(f"{name}_drum", (cx, cy, cz + 0.26), 0.16, 0.2, stone, vertices=12)
    for sy in (-1, 1):
        add_cylinder(f"{name}_upright", (cx, cy + sy * 0.22, cz + 0.4), 0.025, 0.8, wood, vertices=6)
    add_box(f"{name}_beam", (cx, cy, cz + 0.78), (0.9, 0.05, 0.05), wood)
    add_cylinder(f"{name}_screw", (cx, cy, cz + 0.55), 0.03, 0.5, wood, vertices=6)


def add_crates(name, centre, count, mat):
    cx, cy, cz = centre
    for index in range(count):
        add_box(f"{name}_{index}", (cx + (index % 2) * 0.24, cy + (index // 2) * 0.24, cz + 0.1), (0.2, 0.2, 0.2), mat)


def build_olive_press():
    """The original's: an open press house, its beam held on tall uprights, olives
    heaped in a basket, a basin at the foot."""
    m = workshop_materials()
    add_stone_yard(m["rubble"])

    add_workshop_base((-0.3, 0.2), (1.2, 1.1), m["stone"])
    add_timber_frame("shed", (-0.3, 0.2, 0.04 + 0.2), (1.0, 0.9, 1.0), m["wood"], m["plank"])
    add_press("press", (-0.3, 0.2, 0.04 + 0.2), m["wood"], m["stone"])
    add_barrel("basin", (0.5, -0.5, 0.04), m["clay"], radius=0.14, height=0.16)
    add_amphora("jar1", (0.7, 0.2, 0.04), 0.26, m["clay"])
    add_amphora("jar2", (0.4, 0.6, 0.04), 0.2, m["clay"])
    add_hedge("olives", (-0.7, -0.6), (0.3, 0.3, 0.2), m["hedge"])

    return {"kind": "olivePress", "variant": 0, "footprint": 2, "height": 1.3}

GREEN_TILE = hex_rgb("7f8f2a")
TEAL_PAINT = hex_rgb("2a8a80")
PLANK = hex_rgb("c9a462")


def add_farmhouse(origin):
    """The original's farmhouse: plastered stone in an L under green glazed tile, a
    trimmed doorway, jars against the wall. Fills the back half of a 2x2 plot."""
    ox, oy = origin
    plaster = plaster_material("farm_plaster", hex_rgb("efe3c4"), roughness=0.9, variation=0.16, scale=6.0)
    course = plaster_material("farm_course", hex_rgb("b9b09a"), roughness=0.9, variation=0.12, scale=12.0)
    green = roof_material("green_tile", GREEN_TILE, rows_per_unit=6.0)
    trim = material("farm_trim", hex_rgb("5a6a22"), roughness=0.8)
    clay = material("clay", CLAY, roughness=0.85)

    add_box("main", (ox - 0.25, oy + 0.1, 0.4), (1.3, 0.9, 0.8), plaster)
    add_box("main_course", (ox - 0.25, oy + 0.1, 0.12), (1.32, 0.92, 0.24), course)
    add_gable_roof("main_roof", (ox - 0.25, oy + 0.1, 0.8), 0.74, 0.56, 0.36, 0.07, green)
    add_box("main_trim", (ox - 0.25, oy - 0.36, 0.78), (1.4, 0.04, 0.05), trim)
    add_window_row(0.45, 0.5, (0.13, 0.16), (ox - 0.25, oy + 0.1))

    add_box("wing", (ox + 0.55, oy - 0.1, 0.32), (0.6, 0.7, 0.64), plaster)
    add_box("wing_course", (ox + 0.55, oy - 0.1, 0.12), (0.62, 0.72, 0.24), course)
    add_shed_roof("wing_roof", (ox + 0.57, oy - 0.1, 0.7), 0.38, 0.44, 0.07, green, pitch=0.34)
    add_doorway(0.3, 0.42, (ox + 0.55, oy - 0.1), width=0.22)
    add_box("door_trim", (ox + 0.86, oy - 0.1, 0.44), (0.02, 0.28, 0.04), trim)

    add_amphora("jar1", (ox + 0.5, oy - 0.62, 0.0), 0.22, clay)
    add_amphora("jar2", (ox + 0.8, oy - 0.5, 0.0), 0.18, clay)


def add_crop_rows(origin, span, crop, rows, along_x=True):
    ox, oy = origin
    for index in range(rows):
        offset = -span / 2 + (index + 0.5) * span / rows
        centre = (ox + offset, oy, 0.07) if along_x else (ox, oy + offset, 0.07)
        size = (span / rows * 0.45, span * 0.9, 0.09) if along_x else (span * 0.9, span / rows * 0.45, 0.09)
        add_box(f"row_{index}", centre, size, crop)


def build_wheat_farm():
    """Farmhouse at the back of the plot, a strip of wheat before it."""
    crop = plaster_material("crop", STRAW_DULL, roughness=0.9, variation=0.2, scale=30.0)
    add_farmhouse((-0.15, 0.4))
    add_crop_rows((-0.2, -0.6), 1.4, crop, 6)
    return {"kind": "wheatFarm", "variant": 0, "footprint": 2, "height": 1.2}


def build_granary():
    """The original's granary: a teal-painted timber store on a plank deck, a flat
    board roof on posts, jars waiting by the door and a signal pole."""
    stone = plaster_material("stone", STONE, roughness=0.85, variation=0.12, scale=10.0)
    deck = plaster_material("deck", PLANK, roughness=0.92, variation=0.14, scale=14.0)
    teal = plaster_material("teal", TEAL_PAINT, roughness=0.8, variation=0.2, scale=9.0)
    board = plaster_material("board", hex_rgb("6e4f2a"), roughness=0.9, variation=0.16, scale=12.0)
    wood = material("wood", WOOD, roughness=0.85)
    clay = material("clay", CLAY, roughness=0.8)
    vent = material("vent", (0.05, 0.05, 0.04), roughness=0.6)

    add_box("plinth", (0, 0, 0.05), (1.9, 1.9, 0.1), stone)
    add_box("deck", (0, 0, 0.115), (1.8, 1.8, 0.03), deck)
    for index in range(9):
        add_box("deck_gap", (-0.8 + index * 0.2, 0, 0.132), (0.015, 1.8, 0.005), board)

    sx, sy = -0.26, 0.18
    add_box("store", (sx, sy, 0.13 + 0.36), (1.0, 0.82, 0.72), teal)
    for z in (0.3, 0.55):
        add_box("board_line", (sx, sy, 0.13 + z), (1.01, 0.83, 0.015), board)
    for y in (sy - 0.22, sy + 0.22):
        add_box("vent", (sx + 0.5, y, 0.13 + 0.5), (0.03, 0.14, 0.09), vent)
    add_doorway(0.5, 0.36, (sx, sy), width=0.22)
    roof = add_box("roof", (sx + 0.04, sy, 0.13 + 0.76), (1.14, 0.92, 0.035), deck)
    roof.rotation_euler[1] = 0.06
    for px, py in ((sx + 0.6, sy - 0.48), (sx + 0.6, sy + 0.48), (sx - 0.6, sy - 0.48), (sx - 0.6, sy + 0.48)):
        add_cylinder("post", (px, py, 0.13 + 0.38), 0.025, 0.76, wood, vertices=6)

    add_amphora("jar1", (0.56, -0.52, 0.13), 0.28, clay)
    add_amphora("jar2", (0.3, -0.66, 0.13), 0.22, clay)
    add_amphora("jar3", (-0.66, -0.6, 0.13), 0.24, clay)
    add_cylinder("pole", (0.7, 0.62, 0.13 + 0.6), 0.02, 1.2, wood, vertices=6)
    add_box("crossbar", (0.7, 0.62, 0.13 + 1.1), (0.26, 0.03, 0.03), wood)

    return {"kind": "granary", "variant": 0, "footprint": 2, "height": 1.4}


def build_agora(kind, across, along, variant):
    """The agora itself is only its floor: cobbles inside a marble kerb, with a dark
    inlay running round them. Everything on it is a stall the player puts there."""
    cobbles = cobble_material("cobbles", hex_rgb("ece2c2"), stones_per_unit=10.0, spread=0.22)
    kerb = plaster_material("kerb", hex_rgb("e0d6ba"), roughness=0.6, variation=0.04, scale=9.0)
    inlay = cobble_material("inlay", hex_rgb("947c4e"), stones_per_unit=14.0, spread=0.14)

    width = along if variant == 0 else across
    depth = across if variant == 0 else along
    kerb_width = 0.3
    field_x = width - kerb_width * 2
    field_y = depth - kerb_width * 2

    add_box("kerb", (0, 0, 0.03), (width, depth, 0.06), kerb)
    add_box("cobbles", (0, 0, 0.065), (field_x, field_y, 0.02), cobbles)

    for sign in (-1, 1):
        add_box("inlay", (0, sign * (field_y / 2 + 0.1), 0.068), (field_x + 0.3, 0.14, 0.016), inlay)
        add_box("inlay", (sign * (field_x / 2 + 0.1), 0, 0.068), (0.14, field_y + 0.3, 0.016), inlay)

    return {"kind": kind, "variant": variant, "footprint": [width, depth], "height": 0.09}


def build_college():
    """The original's: a teal-tiled hall behind a colonnade, a curved flight of steps
    down to the paving, a lower wing at its side."""
    m = civic_materials()

    add_box("paving", (0, 0, 0.02), (2.9, 2.9, 0.04), m["paving"])
    hx, hy = -0.45, 0.35
    add_box("stylobate", (hx, hy, 0.04 + 0.1), (2.0, 1.5, 0.2), m["marble"])
    add_box("hall", (hx, hy + 0.2, 0.04 + 0.2 + 0.55), (1.8, 0.9, 1.1), m["blue_wall"])
    add_gable_roof("hall_roof", (hx, hy + 0.2, 0.04 + 0.2 + 1.1), 0.64, 1.0, 0.4, 0.07, m["teal_tile"])
    for x in (hx - 0.7, hx - 0.35, hx, hx + 0.35, hx + 0.7):
        add_column("column", (x, hy - 0.5, 0.04 + 0.2), 1.0, 0.045, m["marble"], m["teal_tile"])
    add_box("architrave", (hx, hy - 0.5, 0.04 + 0.2 + 1.04), (1.9, 0.2, 0.08), m["marble"])
    add_box("porch_roof", (hx, hy - 0.4, 0.04 + 0.2 + 1.12), (1.9, 0.5, 0.06), m["teal_tile"])
    add_doorway(0.45, 0.5, (hx, hy + 0.2), width=0.3)
    for x in (hx - 0.6, hx + 0.6):
        add_box("window", (x, hy - 0.24, 0.04 + 0.2 + 0.6), (0.18, 0.04, 0.3), m["dark"])

    for index in range(4):
        add_ring(f"step{index}", (hx + 0.3, hy - 0.9, 0.04), 0.9 - index * 0.16, 0.0, 0.05 + index * 0.05, m["marble"],
                 keep=((hx + 0.3, hy - 1.6, 0.5), (3.0, 1.4, 2.0)))

    wx, wy = 0.95, -0.4
    add_box("wing", (wx, wy, 0.04 + 0.35), (0.8, 1.0, 0.7), m["blue_wall"])
    add_shed_roof("wing_roof", (wx + 0.02, wy, 0.04 + 0.76), 0.46, 0.56, 0.06, m["teal_tile"], pitch=0.3)
    add_doorway(0.4, 0.4, (wx, wy), width=0.22)
    add_flag("flag", (hx + 0.9, hy + 0.6, 0.04 + 1.7), 0.3, m["wood"], m["flag"])
    add_cypress("cypress", (-1.25, -1.15, 0.04), 0.7, m["cypress"])

    return {"kind": "college", "variant": 0, "footprint": 3, "height": 1.9}

STALL_AWNINGS = ["2e9a8a", "4a5aa0", "c8b040", "a03a8a", "c83a2a", "c9a462"]


STALL_WARES = ["e0b451", "efe9dc", "b6cf6d", "7c2f45", "9aa4b2", "8a5a34"]
STALL_BANNERS = ["d84a3a", "e8e2d2", "3a8a3a", "a03a8a", "c83a2a", "6a4a2a"]


def build_stall(variant):
    """The original's: a flat canvas awning in the stall's colour on four poles, a
    counter of wares beneath, a banner on a tall pole, the plot paved in cream."""
    canvas = plaster_material("canvas", hex_rgb(STALL_AWNINGS[variant]), roughness=0.94, variation=0.18, scale=9.0)
    banner = material("banner", hex_rgb(STALL_BANNERS[variant]), roughness=0.9)
    wares = material("wares", hex_rgb(STALL_WARES[variant]), roughness=0.85)
    wood = material("wood", hex_rgb("7a5730"), roughness=0.9)
    plank = plaster_material("plank", PLANK, roughness=0.92, variation=0.14, scale=14.0)
    clay = material("clay", CLAY, roughness=0.85)

    add_yard(plank, half=0.95)
    ax, ay = -0.3, 0.3
    for sx, sy in ((-0.4, -0.3), (0.4, -0.3), (-0.4, 0.3), (0.4, 0.3)):
        add_cylinder("post", (ax + sx, ay + sy, 0.04 + 0.3), 0.022, 0.6, wood, vertices=6)
    awning = add_box("awning", (ax, ay, 0.04 + 0.64), (0.96, 0.76, 0.035), canvas)
    awning.rotation_euler[0] = 0.12
    add_box("fringe", (ax, ay - 0.38, 0.04 + 0.58), (0.98, 0.02, 0.08), canvas)

    add_box("counter", (ax, ay - 0.16, 0.04 + 0.16), (0.8, 0.36, 0.32), plank)
    for index, wx in enumerate((-0.24, 0.0, 0.24)):
        add_box(f"ware{index}", (ax + wx, ay - 0.16, 0.04 + 0.37), (0.18, 0.26, 0.1), wares)
    add_box("side_counter", (-0.7, -0.5, 0.04 + 0.14), (0.36, 0.7, 0.28), plank)
    add_box("side_wares", (-0.7, -0.5, 0.04 + 0.32), (0.3, 0.6, 0.08), wares)
    add_box("table", (0.6, -0.5, 0.04 + 0.16), (0.5, 0.4, 0.04), plank)
    for sx, sy in ((0.4, -0.65), (0.8, -0.35)):
        add_cylinder("table_leg", (sx, sy, 0.04 + 0.07), 0.02, 0.14, wood, vertices=6)
    add_amphora("jar1", (0.7, 0.5, 0.04), 0.26, clay)
    add_amphora("jar2", (-0.7, -0.7, 0.04), 0.2, clay)
    add_flag("banner", (0.75, 0.75, 0.04), 1.2, wood, banner)
    add_box("banner_cloth", (0.75 + 0.06, 0.75, 0.04 + 1.04), (0.28, 0.012, 0.24), banner)

    return {"kind": "stall", "variant": variant, "footprint": 2, "height": 1.4}
def build_podium():
    """The original's: a stepped platform, four columns and a teal gable over it."""
    m = civic_materials()

    add_box("paving", (0, 0, 0.02), (1.9, 1.9, 0.04), m["paving"])
    for index, size in enumerate((1.5, 1.2)):
        add_box(f"step{index}", (0, 0, 0.04 + 0.06 + index * 0.12), (size, size, 0.12), m["marble"])
    add_box("dais", (0, 0, 0.04 + 0.3), (0.9, 0.9, 0.12), m["blue_wall"])
    for sx, sy in ((-0.34, -0.34), (0.34, -0.34), (-0.34, 0.34), (0.34, 0.34)):
        add_column("column", (sx, sy, 0.04 + 0.36), 0.8, 0.045, m["marble"], m["teal_tile"])
    add_box("entablature", (0, 0, 0.04 + 1.2), (1.0, 1.0, 0.08), m["marble"])
    add_gable_roof("roof", (0, 0, 0.04 + 1.24), 0.6, 0.56, 0.3, 0.07, m["teal_tile"])
    add_box("lectern", (0.1, -0.1, 0.04 + 0.52), (0.16, 0.16, 0.32), m["marble"])
    add_flag("flag", (0.0, 0.0, 0.04 + 1.54), 0.3, m["wood"], m["flag"])

    return {"kind": "podium", "variant": 0, "footprint": 2, "height": 1.9}

BLUE_TILE = hex_rgb("2f5e9c")
BLUE_WALL = hex_rgb("4a6ea0")
TEAL_TILE = hex_rgb("2e8a84")
GOLD_TILE = hex_rgb("d9a020")
CREAM_STONE = hex_rgb("e6dcc0")
FLAG_RED = hex_rgb("c8402a")


def civic_materials():
    return {
        "paving": plaster_material("paving", CREAM_STONE, roughness=0.85, variation=0.12, scale=14.0),
        "marble": plaster_material("marble", hex_rgb("cfd6e0"), roughness=0.5, variation=0.1, scale=8.0),
        "blue_wall": plaster_material("blue_wall", BLUE_WALL, roughness=0.8, variation=0.18, scale=6.0),
        "blue_tile": roof_material("blue_tile", BLUE_TILE, rows_per_unit=6.0),
        "teal_tile": roof_material("teal_tile", TEAL_TILE, rows_per_unit=6.0),
        "gold_tile": roof_material("gold_tile", GOLD_TILE, rows_per_unit=6.0),
        "whitewash": plaster_material("whitewash", WHITEWASH, roughness=0.86, variation=0.14, scale=5.0),
        "stone": plaster_material("stone", STONE, roughness=0.88, variation=0.12, scale=11.0),
        "wood": material("wood", WOOD, roughness=0.9),
        "plank": plaster_material("plank", PLANK, roughness=0.92, variation=0.14, scale=14.0),
        "clay": material("clay", CLAY, roughness=0.85),
        "bronze": material("bronze", BRONZE, roughness=0.35, metallic=1.0),
        "cypress": material("cypress", CYPRESS, roughness=0.9),
        "hedge": plaster_material("hedge", hex_rgb("3a6a22"), roughness=0.95, variation=0.2, scale=12.0),
        "water": material("water", hex_rgb("3c9aa6"), roughness=0.1),
        "flag": material("flag", FLAG_RED, roughness=0.8),
        "dark": material("dark", SHADOW_DARK, roughness=0.9),
        "ochre": plaster_material("ochre", OCHRE, roughness=0.9, variation=0.16, scale=7.0),
        "sack": plaster_material("sack", SACK, roughness=0.98, variation=0.14, scale=20.0),
    }


def add_barrel(name, centre, mat, radius=0.09, height=0.2):
    cx, cy, cz = centre
    return add_cylinder(name, (cx, cy, cz + height / 2), radius, height, mat, vertices=10)


def add_ladder(name, foot, top, wood):
    """Two rails and rungs leaning from a point on the ground to a point above."""
    (ax, ay, az), (bx, by, bz) = foot, top
    length = math.hypot(bx - ax, by - ay, bz - az)
    yaw = math.atan2(by - ay, bx - ax)
    pitch = math.atan2(math.hypot(bx - ax, by - ay), bz - az)
    centre = ((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2)
    for side in (-1, 1):
        rail = add_box(f"{name}_rail", centre, (0.025, 0.025, length), wood)
        rail.rotation_euler = (0, pitch, yaw)
        rail.location = (centre[0] - math.sin(yaw) * side * 0.09, centre[1] + math.cos(yaw) * side * 0.09, centre[2])
    rungs = max(2, int(length / 0.14))
    for index in range(rungs):
        t = (index + 0.5) / rungs
        rung = add_box(f"{name}_rung", (ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t), (0.02, 0.2, 0.02), wood)
        rung.rotation_euler[2] = yaw


def add_column(name, centre, height, radius, mat, cap_mat=None):
    cx, cy, cz = centre
    add_cylinder(name, (cx, cy, cz + height / 2), radius, height, mat, vertices=12)
    add_box(f"{name}_cap", (cx, cy, cz + height + 0.02), (radius * 2.6, radius * 2.6, 0.04), cap_mat or mat)
    add_box(f"{name}_base", (cx, cy, cz + 0.015), (radius * 2.4, radius * 2.4, 0.03), cap_mat or mat)


def add_flag(name, centre, height, wood, cloth):
    cx, cy, cz = centre
    add_cylinder(f"{name}_pole", (cx, cy, cz + height / 2), 0.015, height, wood, vertices=6)
    add_box(f"{name}_cloth", (cx + 0.08, cy, cz + height - 0.08), (0.16, 0.01, 0.12), cloth)


def add_hedge(name, centre, size, mat):
    return add_box(name, (centre[0], centre[1], size[2] / 2), size, mat)


def add_cypress(name, centre, height, mat):
    cx, cy, cz = centre
    bpy.ops.mesh.primitive_cone_add(radius1=height * 0.17, radius2=0.01, depth=height, location=(cx, cy, cz + height / 2), vertices=8)
    tree = bpy.context.active_object
    tree.name = name
    tree.data.materials.append(mat)
    return tree


def subtract(target, cutter):
    modifier = target.modifiers.new("cut", "BOOLEAN")
    modifier.operation = "DIFFERENCE"
    modifier.object = cutter
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.modifier_apply(modifier="cut")
    bpy.data.objects.remove(cutter, do_unlink=True)


def add_ring(name, centre, outer, inner, height, mat, vertices=32, keep=None):
    """A flat ring; `keep` is a box (centre, size) outside which the ring is cut away."""
    cx, cy, cz = centre
    ring = add_cylinder(name, (cx, cy, cz + height / 2), outer, height, mat, vertices=vertices)
    hole = add_cylinder(f"{name}_hole", (cx, cy, cz + height / 2), inner, height + 0.1, mat, vertices=vertices)
    subtract(ring, hole)
    if keep:
        (kx, ky, kz), (sx, sy, sz) = keep
        outside = add_box(f"{name}_outside", (kx, ky, kz), (sx, sy, sz), mat)
        inside = add_box(f"{name}_inside", (cx, cy, cz + height / 2), (outer * 3, outer * 3, height + 0.2), mat)
        subtract(inside, outside)
        subtract(ring, inside)
    return ring


def add_tiers(name, centre, inner, rows, row_width, row_rise, mat, keep=None):
    """Concentric rings stepping up and out: an amphitheatre's seating."""
    for row in range(rows):
        add_ring(f"{name}_{row}", centre, inner + (row + 1) * row_width, inner + row * row_width, (row + 1) * row_rise, mat, keep=keep)


def add_statue(name, centre, height, mat):
    cx, cy, cz = centre
    add_cylinder(f"{name}_legs", (cx, cy, cz + height * 0.3), height * 0.09, height * 0.6, mat, vertices=10)
    add_cylinder(f"{name}_torso", (cx, cy, cz + height * 0.72), height * 0.12, height * 0.28, mat, vertices=10)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=height * 0.09, location=(cx, cy, cz + height * 0.94), segments=10, ring_count=6)
    head = bpy.context.active_object
    head.name = f"{name}_head"
    head.data.materials.append(mat)


def build_maintenance_office():
    """The original's: a blue-tiled hut, water butts stacked round it, a ladder up to a lookout."""
    m = civic_materials()
    barrel = plaster_material("barrel", hex_rgb("2c3f6e"), roughness=0.8, variation=0.16, scale=10.0)

    hx, hy = 0.1, 0.1
    add_box("hut", (hx, hy, 0.3), (0.9, 0.8, 0.6), m["whitewash"])
    add_box("hut_course", (hx, hy, 0.08), (0.92, 0.82, 0.16), m["stone"])
    add_gable_roof("roof", (hx, hy, 0.6), 0.6, 0.54, 0.5, 0.07, m["blue_tile"])
    add_box("eave", (hx, hy - 0.52, 0.58), (1.16, 0.04, 0.05), m["wood"])
    add_doorway(0.45, 0.34, (hx, hy), width=0.2)
    add_window_row(0.4, 0.4, (0.1, 0.12), (hx, hy))

    for index, (bx, by) in enumerate(((0.72, -0.3), (0.72, -0.56), (0.5, -0.7), (-0.5, -0.66), (-0.72, -0.4), (0.78, 0.5))):
        add_barrel(f"butt{index}", (bx, by, 0.0), barrel, radius=0.1, height=0.22)
        add_box(f"hoop{index}", (bx, by, 0.11), (0.21, 0.21, 0.02), m["wood"])

    tx, ty = -0.62, 0.58
    for px, py in ((tx - 0.12, ty - 0.12), (tx + 0.12, ty - 0.12), (tx - 0.12, ty + 0.12), (tx + 0.12, ty + 0.12)):
        add_cylinder("tower_post", (px, py, 0.6), 0.02, 1.2, m["wood"], vertices=6)
    add_box("platform", (tx, ty, 1.2), (0.36, 0.36, 0.04), m["plank"])
    add_box("lookout_roof", (tx, ty, 1.5), (0.4, 0.4, 0.04), m["plank"])
    for px, py in ((tx - 0.16, ty - 0.16), (tx + 0.16, ty + 0.16)):
        add_cylinder("lookout_post", (px, py, 1.36), 0.012, 0.28, m["wood"], vertices=6)
    add_ladder("ladder", (tx + 0.5, ty - 0.5, 0.0), (tx + 0.16, ty - 0.14, 1.18), m["wood"])

    return {"kind": "maintenanceOffice", "variant": 0, "footprint": 2, "height": 1.6}

def build_tax_office():
    """The original's: a blue-walled hall under a gold roof, its emblem over the door, on cream paving."""
    m = civic_materials()

    add_box("paving", (0, 0, 0.02), (1.9, 1.9, 0.04), m["paving"])
    hx, hy = 0.0, 0.08
    add_box("hall", (hx, hy, 0.04 + 0.7), (0.9, 0.8, 1.4), m["blue_wall"])
    add_box("plinth", (hx, hy, 0.04 + 0.1), (0.98, 0.88, 0.2), m["marble"])
    add_box("cornice", (hx, hy, 0.04 + 1.42), (1.04, 0.94, 0.06), m["marble"])
    add_gable_roof("roof", (hx, hy, 0.04 + 1.45), 0.62, 0.56, 0.42, 0.07, m["gold_tile"])
    add_doorway(0.45, 0.7, (hx, hy), width=0.3)
    add_box("door_frame", (hx + 0.46, hy, 0.04 + 0.72), (0.02, 0.4, 0.06), m["marble"])
    for y in (hy - 0.3, hy + 0.3):
        add_box("pilaster", (hx + 0.46, y, 0.04 + 0.7), (0.03, 0.08, 1.4), m["marble"])
    add_cylinder("emblem", (hx + 0.465, hy, 0.04 + 1.1), 0.12, 0.02, m["bronze"], vertices=16)
    emblem = bpy.context.active_object
    emblem.rotation_euler[1] = math.pi / 2
    add_window_row(0.4, 0.04 + 0.9, (0.12, 0.2), (hx, hy))

    add_amphora("jar", (0.7, -0.66, 0.04), 0.22, m["clay"])
    add_box("strongbox", (-0.7, -0.62, 0.04 + 0.1), (0.24, 0.18, 0.2), m["wood"])

    return {"kind": "taxOffice", "variant": 0, "footprint": 2, "height": 2.0}

def build_palace():
    """Palace: a colonnaded hall on a stepped marble terrace, flanked by wings and statues.
    Coloured as the original's: gold-glazed tile, blue-grey marble, red columns."""
    marble = plaster_material("marble", hex_rgb("c9d0dc"), roughness=0.5, variation=0.1, scale=8.0)
    paving = plaster_material("paving", hex_rgb("e8e2cc"), roughness=0.7, variation=0.08, scale=18.0)
    whitewash = plaster_material("whitewash", hex_rgb("b9c2d2"), roughness=0.8, variation=0.14, scale=6.0)
    terracotta = roof_material("gold_tile", hex_rgb("d9a020"), rows_per_unit=6.0)
    stone = plaster_material("stone", STONE, roughness=0.8, variation=0.05, scale=10.0)
    bronze = material("bronze", BRONZE, roughness=0.35, metallic=1.0)
    clay = material("clay", CLAY, roughness=0.8)
    cypress = material("cypress", CYPRESS, roughness=0.9)
    column = material("column_red", hex_rgb("a83a2a"), roughness=0.7)

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
        add_cylinder("column_east", (hx + hall_half + 0.24, hy + offset, base_z + 0.1 + 0.6), 0.07, 1.2, column, vertices=16)
        add_box("capital_east", (hx + hall_half + 0.24, hy + offset, base_z + 0.1 + 1.22), (0.18, 0.18, 0.06), marble)
        add_cylinder("column_south", (hx + offset, hy - hall_half - 0.24, base_z + 0.1 + 0.6), 0.07, 1.2, column, vertices=16)
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


def hera_emblem(marble, bronze, wood, clay, cypress):
    for tree_x, tree_y in ((1.0, -0.9), (1.3, -0.4)):
        add_cylinder("orange_trunk", (tree_x, tree_y, 0.06 + 0.18), 0.06, 0.36, wood, vertices=8)
        add_pyramid("orange_crown", (tree_x, tree_y, 0.06 + 0.52), 0.3, 0.36, material("orange_leaf", (0.32, 0.44, 0.24), roughness=0.9), vertices=7)
    add_cylinder("peacock_perch", (-1.02, 1.0, 0.06 + 0.2), 0.05, 0.4, marble, vertices=10)
    add_cylinder("peacock", (-1.02, 1.0, 0.06 + 0.5), 0.11, 0.22, bronze, vertices=12)


def atlas_emblem(marble, bronze, wood, clay, cypress):
    add_box("pillar_base", (1.0, -0.9, 0.06 + 0.1), (0.5, 0.5, 0.2), marble)
    add_cylinder("pillar", (1.0, -0.9, 0.06 + 0.62), 0.16, 0.84, marble, vertices=16)
    add_cylinder("sky", (1.0, -0.9, 0.06 + 1.14), 0.26, 0.24, bronze, vertices=18)
    add_box("block", (-1.0, 1.0, 0.06 + 0.16), (0.5, 0.5, 0.32), marble)


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
    "sanctuary-hera": {"roof": hex_rgb("b0603c"), "emblem": hera_emblem},
    "sanctuary-atlas": {"roof": hex_rgb("94553a"), "emblem": atlas_emblem},
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
    """The original's: a curved marble stoa round a court, red tile over the
    colonnade, cypresses at the gate."""
    m = civic_materials()
    add_box("paving", (0, 0, 0.02), (1.9, 1.9, 0.04), m["paving"])
    back = add_ring("back", (0.1, 0.1, 0.04), 0.95, 0.75, 0.9, m["marble"])
    front = add_box("front_cut", (0.9, -0.9, 0.5), (2.6, 2.6, 1.4), m["marble"])
    front.rotation_euler[2] = math.radians(45)
    subtract(back, front)
    for angle in (0.2, 0.6, 1.0, 1.4):
        add_column("column", (0.1 + math.cos(angle) * 0.85, 0.1 - math.sin(angle) * 0.85, 0.04), 0.7, 0.04, m["marble"])
        add_column("column", (0.1 - math.cos(angle) * 0.85, 0.1 + math.sin(angle) * 0.85, 0.04), 0.7, 0.04, m["marble"])
    add_box("stoa_roof_x", (0.55, -0.4, 0.04 + 0.78), (0.9, 0.3, 0.05), m["terracotta"] if "terracotta" in m else roof_material("terracotta", TERRACOTTA))
    add_box("stoa_roof_y", (-0.4, 0.55, 0.04 + 0.78), (0.3, 0.9, 0.05), roof_material("terracotta2", TERRACOTTA))
    add_cypress("cypress1", (-0.75, -0.75, 0.04), 0.9, m["cypress"])
    add_cypress("cypress2", (0.8, 0.8, 0.04), 0.8, m["cypress"])
    add_crates("crates", (0.3, 0.3, 0.04), 2, m["plank"])
    return {"kind": "tradingPost", "variant": 0, "footprint": 2, "height": 1.3}

def build_estate(tier):
    """The elite ladder, after the original: a tall mansion of blue-grey stone under
    tiled roofs, growing a storey and a colonnade with each tier, in a walled garden."""
    m = house_materials()
    grey = plaster_material("grey", hex_rgb("b8c2d4"), roughness=0.82, variation=0.16, scale=5.0)
    cream = plaster_material("cream", hex_rgb("f2e4c0"), roughness=0.86, variation=0.14, scale=5.0)
    marble = plaster_material("marble", hex_rgb("d8dde6"), roughness=0.5, variation=0.1, scale=8.0)
    cypress = material("cypress", CYPRESS, roughness=0.9)
    hedge = plaster_material("hedge", hex_rgb("3a6a22"), roughness=0.95, variation=0.2, scale=12.0)
    paving = plaster_material("paving", CREAM_STONE, roughness=0.85, variation=0.12, scale=14.0)

    plate = add_box("paving", (0, 0, 0.02), (3.9, 3.9, 0.04), paving)
    plate.visible_camera = False
    add_wall("garden_wall_s", (0.0, -1.9, 0.04 + 0.16), 3.9, 0.32, 0.1, m["stone"], along_x=True)
    add_wall("garden_wall_w", (-1.9, 0.0, 0.04 + 0.16), 3.9, 0.32, 0.1, m["stone"], along_x=False)
    add_box("court", (0.2, 0.2, 0.04 + 0.03), (3.0, 3.0, 0.06), paving)

    storeys = 1 + (tier >= 2)
    mx, my = -0.4, 0.4
    main_h = 1.1 * storeys + 0.3
    add_box("main", (mx, my, 0.04 + main_h / 2), (1.8, 1.5, main_h), grey)
    add_box("main_course", (mx, my, 0.04 + 0.12), (1.84, 1.54, 0.24), marble)
    add_gable_roof("main_roof", (mx, my, 0.04 + main_h), 0.98, 0.85, 0.5, 0.07, m["terracotta"])
    for level in range(storeys):
        add_window_row(0.75, 0.04 + 0.55 + level * 1.1, (0.16, 0.22), (mx, my), on_door_face=True)
        add_shutters(0.75, 0.04 + 0.55 + level * 1.1, (0.16, 0.22), m["blue"], (mx, my))

    wx, wy = 0.85, -0.6
    add_box("wing", (wx, wy, 0.04 + 0.45), (1.2, 1.2, 0.9), cream)
    add_shed_roof("wing_roof", (wx + 0.02, wy, 0.04 + 0.96), 0.66, 0.68, 0.07, m["terracotta"], pitch=0.34)
    add_doorway(0.6, 0.6, (wx, wy), width=0.34)
    add_box("door_frame", (wx + 0.61, wy, 0.04 + 0.64), (0.02, 0.44, 0.06), m["blue"])

    if tier >= 1:
        for y in (wy - 0.8, wy - 0.45, wy - 0.1, wy + 0.25):
            add_column("stoa_column", (wx + 0.72, y, 0.04), 0.8, 0.045, marble)
        add_box("stoa_roof", (wx + 0.72, wy - 0.28, 0.04 + 0.88), (0.44, 1.3, 0.06), m["terracotta"])
    if tier >= 2:
        add_box("balcony", (mx + 1.0, my, 0.04 + 1.2), (0.26, 1.0, 0.05), marble)
        for y in (my - 0.4, my, my + 0.4):
            add_cylinder("baluster", (mx + 1.1, y, 0.04 + 1.3), 0.015, 0.16, marble, vertices=6)
        add_box("balcony_rail", (mx + 1.1, my, 0.04 + 1.4), (0.03, 1.0, 0.03), marble)
    if tier >= 3:
        add_box("tower", (mx - 0.4, my + 0.3, 0.04 + main_h + 0.35), (0.5, 0.5, 0.7), grey)
        add_hip_roof("tower_roof", (mx - 0.4, my + 0.3, 0.04 + main_h + 0.82), 0.32, 0.24, m["terracotta"], ridge_half=0.06)

    for index, (tx, ty) in enumerate(((-1.5, -1.4), (-1.5, 1.3), (1.4, 1.4), (1.5, -1.5))):
        if index < 2 + tier:
            add_cypress(f"cypress{index}", (tx, ty, 0.04), 1.0, cypress)
    add_hedge("hedge1", (0.4, 1.4), (1.2, 0.3, 0.3), hedge)
    add_hedge("hedge2", (-1.4, -0.2), (0.3, 1.2, 0.3), hedge)
    add_amphora("jar", (1.5, 0.4, 0.04), 0.3, m["clay"])

    return {"kind": "estate", "variant": tier, "footprint": 4, "height": main_h + 1.4}
def build_infirmary():
    """The original's: a blue-tiled ward with a round tower at its corner, benches in the
    court, shrubs against the walls, on cream paving."""
    m = civic_materials()

    add_box("paving", (0, 0, 0.02), (2.9, 2.9, 0.04), m["paving"])
    wx, wy = -0.3, 0.5
    add_box("ward", (wx, wy, 0.04 + 0.5), (2.0, 1.0, 1.0), m["blue_wall"])
    add_box("ward_trim", (wx, wy, 0.04 + 0.12), (2.04, 1.04, 0.06), m["teal_tile"])
    add_gable_roof("ward_roof", (wx, wy, 0.04 + 1.0), 0.6, 1.04, 0.36, 0.07, m["blue_tile"])
    for x in (wx - 0.6, wx - 0.2, wx + 0.2, wx + 0.6):
        add_box("ward_window", (x, wy - 0.5, 0.04 + 0.6), (0.18, 0.04, 0.3), m["dark"])

    ex, ey = 0.9, -0.2
    add_box("wing", (ex, ey, 0.04 + 0.45), (0.8, 1.2, 0.9), m["blue_wall"])
    add_box("wing_trim", (ex, ey, 0.04 + 0.12), (0.84, 1.24, 0.06), m["teal_tile"])
    add_gable_roof("wing_roof", (ex, ey, 0.04 + 0.9), 0.5, 0.64, 0.3, 0.07, m["blue_tile"])
    add_doorway(0.4, 0.46, (ex, ey), width=0.24)

    tx, ty = -1.0, -0.1
    add_cylinder("tower", (tx, ty, 0.04 + 0.7), 0.42, 1.4, m["blue_wall"], vertices=16)
    add_cylinder("tower_band", (tx, ty, 0.04 + 1.05), 0.44, 0.06, m["marble"], vertices=16)
    for angle in (0.5, 1.5, 2.5):
        add_box("tower_window", (tx + math.cos(angle) * 0.41, ty - math.sin(angle) * 0.41, 0.04 + 1.2), (0.1, 0.1, 0.2), m["dark"])
    bpy.ops.mesh.primitive_cone_add(radius1=0.5, radius2=0.04, depth=0.36, location=(tx, ty, 0.04 + 1.58), vertices=16)
    cap = bpy.context.active_object
    cap.name = "tower_roof"
    cap.data.materials.append(m["blue_tile"])

    for bx, by in ((0.1, -0.9), (-0.4, -1.0)):
        add_box("bench", (bx, by, 0.04 + 0.14), (0.5, 0.18, 0.04), m["plank"])
        for sx in (-0.2, 0.2):
            add_box("bench_leg", (bx + sx, by, 0.04 + 0.06), (0.03, 0.14, 0.12), m["wood"])
    add_hedge("shrub1", (-1.2, 1.2), (0.3, 0.3, 0.3), m["hedge"])
    add_hedge("shrub2", (1.25, 0.6), (0.25, 0.25, 0.28), m["hedge"])

    return {"kind": "infirmary", "variant": 0, "footprint": 3, "height": 2.0}

def build_watchpost():
    """The original's: a tall blue tower with a sand-floored lookout, stairs up its flank."""
    m = civic_materials()

    add_box("paving", (0, 0, 0.02), (1.9, 1.9, 0.04), m["paving"])
    tx, ty = -0.1, 0.1
    add_box("tower", (tx, ty, 0.04 + 0.7), (0.9, 0.9, 1.4), m["blue_wall"])
    add_box("tower_base", (tx, ty, 0.04 + 0.12), (0.98, 0.98, 0.24), m["marble"])
    add_box("flare", (tx, ty, 0.04 + 1.38), (1.16, 1.16, 0.08), m["marble"])
    add_box("parapet", (tx, ty, 0.04 + 1.5), (1.24, 1.24, 0.16), m["blue_wall"])
    add_box("parapet_cap", (tx, ty, 0.04 + 1.59), (1.28, 1.28, 0.03), m["marble"])
    add_box("lookout_floor", (tx, ty, 0.04 + 1.5), (1.1, 1.1, 0.02), m["paving"])
    add_doorway(0.45, 0.5, (tx, ty), width=0.26)
    add_box("arch", (tx + 0.46, ty, 0.04 + 0.56), (0.02, 0.36, 0.12), m["marble"])
    add_window_row(0.45, 0.04 + 1.0, (0.1, 0.16), (tx, ty), on_door_face=True)
    for index in range(6):
        add_box("step", (0.62, -0.64 + index * 0.16, 0.04 + 0.04 + index * 0.08), (0.3, 0.16, 0.08 + index * 0.16), m["marble"])
    add_flag("flag", (tx - 0.35, ty + 0.35, 0.04 + 1.5), 0.5, m["wood"], m["flag"])

    return {"kind": "watchpost", "variant": 0, "footprint": 2, "height": 2.1}

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
    """The original's: the same farmhouse, vines on trellises before it."""
    vine = plaster_material("vine", hex_rgb("4f7a2a"), roughness=0.95, variation=0.2, scale=12.0)
    wood = material("wood", WOOD, roughness=0.9)
    add_farmhouse((-0.15, 0.4))
    for row in range(3):
        y = -0.35 - row * 0.22
        add_box(f"trellis{row}", (-0.2, y, 0.2), (1.4, 0.02, 0.02), wood)
        for x in (-0.8, -0.4, 0.0, 0.4):
            add_cylinder(f"stake{row}", (x, y, 0.12), 0.012, 0.24, wood, vertices=5)
        add_box(f"vine{row}", (-0.2, y, 0.16), (1.36, 0.1, 0.2), vine)
    return {"kind": "vineyard", "variant": 0, "footprint": 2, "height": 1.2}

def build_winery():
    """The original's: a treading vat under a plank roof, purple must in the trough,
    amphorae racked at the side."""
    m = workshop_materials()
    must = material("must", hex_rgb("5a2450"), roughness=0.4)
    add_stone_yard(m["rubble"])

    add_workshop_base((-0.2, 0.3), (1.3, 1.0), m["stone"])
    add_timber_frame("shed", (-0.2, 0.3, 0.04 + 0.2), (1.1, 0.8, 0.9), m["wood"], m["plank"])
    add_box("vat", (-0.2, 0.3, 0.04 + 0.2 + 0.18), (0.8, 0.6, 0.36), m["stone"])
    add_box("must", (-0.2, 0.3, 0.04 + 0.2 + 0.35), (0.7, 0.5, 0.02), must)
    add_box("trough", (0.45, 0.0, 0.04 + 0.08), (0.3, 0.5, 0.16), m["stone"])
    add_box("trough_must", (0.45, 0.0, 0.04 + 0.15), (0.24, 0.44, 0.02), must)
    for index, (jx, jy) in enumerate(((-0.7, -0.6), (-0.45, -0.7), (-0.2, -0.6), (0.6, -0.6))):
        add_amphora(f"jar{index}", (jx, jy, 0.04), 0.24, m["clay"])
    add_box("rack", (-0.45, -0.65, 0.04 + 0.02), (0.7, 0.3, 0.04), m["wood"])

    return {"kind": "winery", "variant": 0, "footprint": 2, "height": 1.3}

def build_carding_shed():
    """The original's: a tall wooden frame with dyed cloth hung from it, fleece
    heaped on the ground, the loom in the open."""
    m = workshop_materials()
    add_stone_yard(m["rubble"])
    cloths = [material(f"cloth{i}", hex_rgb(c), roughness=0.9) for i, c in enumerate(("c84a3a", "d8a030", "3a8a6a", "3a5a9c"))]

    fx, fy = -0.2, 0.2
    for px, py in ((fx - 0.4, fy - 0.4), (fx + 0.4, fy - 0.4), (fx - 0.4, fy + 0.4), (fx + 0.4, fy + 0.4)):
        add_cylinder("frame_post", (px, py, 0.04 + 0.75), 0.03, 1.5, m["wood"], vertices=6)
    add_box("frame_top", (fx, fy, 0.04 + 1.5), (0.9, 0.9, 0.05), m["wood"])
    add_box("frame_mid", (fx, fy - 0.4, 0.04 + 1.0), (0.9, 0.04, 0.04), m["wood"])
    for index, cloth in enumerate(cloths):
        sheet = add_box(f"cloth{index}", (fx - 0.42 + index * 0.06, fy - 0.1, 0.04 + 1.05), (0.02, 0.5, 0.8), cloth)
        sheet.rotation_euler[1] = 0.25
    add_box("loom", (0.55, -0.4, 0.04 + 0.2), (0.4, 0.6, 0.4), m["wood"])
    add_box("loom_cloth", (0.55, -0.4, 0.04 + 0.42), (0.36, 0.5, 0.02), m["whitewash"])
    for index, (px, py) in enumerate(((-0.65, -0.6), (-0.4, -0.7), (0.1, -0.7))):
        add_sack(f"fleece{index}", (px, py, 0.04), m["whitewash"])

    return {"kind": "cardingShed", "variant": 0, "footprint": 2, "height": 1.7}

def build_gymnasium():
    """The original's: a ring of columns round a sand floor, a curved marble wall at
    the back, teal capitals."""
    m = civic_materials()
    sand = plaster_material("sand", hex_rgb("d8c078"), roughness=0.98, variation=0.16, scale=20.0)

    add_box("paving", (0, 0, 0.02), (2.9, 2.9, 0.04), m["paving"])
    add_cylinder("floor", (0, 0, 0.04 + 0.03), 1.1, 0.06, sand, vertices=32)
    add_ring("kerb", (0, 0, 0.04), 1.16, 1.06, 0.1, m["marble"])
    back = add_ring("back_wall", (0, 0, 0.04), 1.3, 1.16, 0.5, m["marble"])
    front = add_box("front_cut", (0.9, -0.9, 0.3), (2.6, 2.6, 1.2), m["marble"])
    front.rotation_euler[2] = math.radians(45)
    subtract(back, front)
    for angle in (1.6, 2.0, 2.4, 2.8, 3.2):
        add_column("column", (math.cos(angle) * 1.24, math.sin(angle) * 1.24, 0.04), 0.9, 0.05, m["marble"], m["teal_tile"])
    lintel = add_box("lintel", (-0.8, 0.8, 0.04 + 0.96), (1.5, 0.16, 0.08), m["marble"])
    lintel.rotation_euler[2] = math.radians(-45)
    add_statue("statue", (-0.85, 0.85, 0.04 + 1.0), 0.4, m["marble"])
    add_hedge("hedge", (1.2, 1.1), (0.4, 0.3, 0.26), m["hedge"])

    return {"kind": "gymnasium", "variant": 0, "footprint": 3, "height": 1.3}

def build_drama_school():
    """The original's: a curved colonnade carrying an arch, statues raised on its
    columns, a chequered floor, masks hung on the arch."""
    m = civic_materials()
    chequer = plaster_material("chequer", hex_rgb("9fb8b0"), roughness=0.85, variation=0.2, scale=30.0)

    add_box("paving", (0, 0, 0.02), (2.9, 2.9, 0.04), m["paving"])
    add_cylinder("floor", (0.1, -0.1, 0.04 + 0.02), 1.0, 0.04, chequer, vertices=32)
    add_ring("kerb", (0.1, -0.1, 0.04), 1.06, 0.98, 0.08, m["marble"])
    for index in range(5):
        angle = 2.0 + index * 0.45
        cx, cy = -math.cos(angle) * 0.95 + 0.1, -math.sin(angle) * 0.95 - 0.1
        add_column(f"column{index}", (cx, cy, 0.04), 1.1 + (index % 2) * 0.3, 0.05, m["marble"], m["teal_tile"])
        if index % 2 == 0:
            add_statue(f"statue{index}", (cx, cy, 0.04 + 1.16), 0.42, m["marble"])
    arch = add_ring("arch", (0.1, -0.1, 0.04 + 1.42), 1.02, 0.9, 0.1, m["marble"], keep=((-0.9, 0.9, 1.5), (2.4, 2.4, 1.0)))
    add_box("stage", (0.5, -0.5, 0.04 + 0.06), (0.9, 0.9, 0.12), m["plank"])
    add_hedge("hedge", (1.1, 1.0), (0.4, 0.4, 0.3), m["hedge"])
    add_amphora("jar", (-1.2, -1.1, 0.04), 0.26, m["clay"])

    return {"kind": "dramaSchool", "variant": 0, "footprint": 3, "height": 1.9}

def build_theatre():
    """The original's: marble tiers round a round teal orchestra, a stage house
    with columns at the back, cypresses at the corners."""
    m = civic_materials()
    orchestra = plaster_material("orchestra", hex_rgb("3aa39a"), roughness=0.7, variation=0.12, scale=10.0)

    add_box("paving", (0, 0, 0.02), (3.9, 3.9, 0.04), m["paving"])
    cx, cy = 0.2, -0.2
    add_cylinder("orchestra", (cx, cy, 0.04 + 0.03), 0.9, 0.06, orchestra, vertices=32)
    add_tiers("tiers", (cx, cy, 0.04), 0.95, 4, 0.18, 0.14, m["marble"])
    add_ring("rim", (cx, cy, 0.04), 1.72, 1.66, 0.62, m["marble"], keep=((cx - 0.9, cy + 0.9, 0.5), (2.6, 2.6, 2.0)))
    add_box("stair", (cx + 0.95, cy - 0.95, 0.04 + 0.2), (0.5, 0.5, 0.4), m["marble"])
    bpy.context.active_object.rotation_euler[2] = math.radians(45)

    sx, sy = -0.9, 0.9
    add_box("skene", (sx, sy, 0.04 + 0.5), (1.6, 0.8, 1.0), m["blue_wall"])
    add_box("skene_cornice", (sx, sy, 0.04 + 1.02), (1.7, 0.9, 0.06), m["marble"])
    for offset in (-0.5, 0.0, 0.5):
        add_column("skene_column", (sx + offset * 0.7, sy - offset * 0.7, 0.04 + 1.05), 0.7, 0.045, m["marble"], m["teal_tile"])
    arch = add_ring("skene_arch", (sx, sy, 0.04 + 1.78), 0.8, 0.7, 0.1, m["marble"], keep=((sx - 0.5, sy + 0.5, 1.8), (1.5, 1.5, 1.0)))
    for offset in (-0.4, 0.4):
        add_box("skene_door", (sx + 0.3 + offset * 0.7, sy - 0.3 - offset * 0.7, 0.04 + 0.35), (0.16, 0.16, 0.7), m["dark"])

    for tx, ty in ((-1.7, -1.5), (1.5, 1.6), (-1.5, 1.7)):
        add_cypress("cypress", (tx, ty, 0.04), 0.9, m["cypress"])
    add_hedge("hedge", (1.4, -1.6), (0.6, 0.3, 0.3), m["hedge"])

    return {"kind": "theatre", "variant": 0, "footprint": 4, "height": 2.2}

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
    """The original's: a saw frame on tall posts, logs stacked, a plank roof."""
    m = workshop_materials()
    add_stone_yard(m["rubble"])
    log = plaster_material("log", hex_rgb("6e4a28"), roughness=0.95, variation=0.18, scale=10.0)

    add_workshop_base((-0.3, 0.3), (1.2, 1.1), m["stone"])
    add_timber_frame("shed", (-0.3, 0.3, 0.04 + 0.2), (1.0, 0.9, 1.1), m["wood"], m["plank"], roof_pitch=0.2)
    add_box("saw_bed", (-0.3, 0.3, 0.04 + 0.5), (0.9, 0.3, 0.06), m["plank"])
    for sy in (-0.12, 0.12):
        add_cylinder("saw_post", (-0.3, 0.3 + sy, 0.04 + 0.9), 0.02, 0.8, m["wood"], vertices=6)
    add_box("saw", (-0.3, 0.3, 0.04 + 0.9), (0.02, 0.28, 0.6), m["iron"])
    for index in range(4):
        beam = add_cylinder(f"log{index}", (0.55, -0.4 + (index % 2) * 0.22, 0.04 + 0.1 + (index // 2) * 0.2), 0.1, 0.9, log, vertices=8)
        beam.rotation_euler[0] = math.pi / 2
    for index in range(3):
        add_box(f"plank{index}", (-0.6, -0.65 + index * 0.06, 0.04 + 0.05 + index * 0.04), (0.9, 0.12, 0.03), m["plank"])

    return {"kind": "timberMill", "variant": 0, "footprint": 2, "height": 1.5}

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
    """The original's: a brick furnace with an iron band, a stone bench under a
    lean-to, ingots stacked, smoke to come from the game."""
    m = workshop_materials()
    add_stone_yard(m["rubble"])

    add_workshop_base((-0.3, 0.3), (1.2, 1.0), m["stone"])
    add_kiln("furnace", (0.0, 0.4, 0.04 + 0.2), 0.9, m["brick"], m["iron"])
    add_timber_frame("shed", (-0.55, 0.0, 0.04 + 0.2), (0.7, 0.9, 0.8), m["wood"], m["plank"])
    add_box("bench", (-0.55, 0.0, 0.04 + 0.2 + 0.15), (0.5, 0.7, 0.3), m["stone"])
    add_cylinder("anvil", (-0.55, 0.0, 0.04 + 0.2 + 0.36), 0.08, 0.12, m["iron"], vertices=8)
    for index in range(4):
        add_box(f"ingot{index}", (0.5 + (index % 2) * 0.16, -0.5 + (index // 2) * 0.12, 0.04 + 0.03), (0.14, 0.08, 0.06), m["bronze"])
    add_crates("crates", (-0.7, -0.7, 0.04), 2, m["wood"])

    return {"kind": "foundry", "variant": 0, "footprint": 2, "height": 1.4}

def build_armoury():
    """The original's: a forge house of ochre stone with a brick chimney, shields
    racked on the wall, an anvil at the door."""
    m = workshop_materials()
    add_stone_yard(m["rubble"])
    shield = material("shield", hex_rgb("b0803a"), roughness=0.5, metallic=0.4)

    hx, hy = -0.3, 0.3
    add_box("house", (hx, hy, 0.04 + 0.35), (1.0, 0.9, 0.7), m["ochre"] if "ochre" in m else m["stone"])
    add_gable_roof("roof", (hx, hy, 0.04 + 0.7), 0.6, 0.55, 0.3, 0.06, m["plank"])
    add_doorway(0.5, 0.4, (hx, hy), width=0.28)
    add_kiln("chimney", (hx - 0.3, hy + 0.3, 0.04 + 0.3), 0.7, m["brick"], m["iron"])
    add_box("rack", (0.55, 0.2, 0.04 + 0.35), (0.05, 0.6, 0.7), m["wood"])
    for index, y in enumerate((0.0, 0.2, 0.4)):
        add_cylinder(f"shield{index}", (0.6, y, 0.04 + 0.4), 0.1, 0.03, shield, vertices=12)
        bpy.context.active_object.rotation_euler[1] = math.pi / 2
    add_cylinder("anvil_block", (0.4, -0.5, 0.04 + 0.12), 0.1, 0.24, m["wood"], vertices=8)
    add_box("anvil", (0.4, -0.5, 0.04 + 0.3), (0.26, 0.12, 0.1), m["iron"])
    for index in range(3):
        add_cylinder(f"spear{index}", (-0.7 + index * 0.1, -0.7, 0.04 + 0.5), 0.012, 1.0, m["wood"], vertices=5)

    return {"kind": "armoury", "variant": 0, "footprint": 2, "height": 1.3}

def build_sculpture_studio():
    """The original's: a stone hut with a carved cornice, a block half-cut on a
    bench, chisels and dust."""
    m = workshop_materials()
    add_stone_yard(m["rubble"])

    hx, hy = -0.3, 0.3
    add_box("house", (hx, hy, 0.04 + 0.4), (1.0, 0.8, 0.8), m["stone"])
    add_box("cornice", (hx, hy, 0.04 + 0.82), (1.1, 0.9, 0.06), m["marble"])
    add_box("roof", (hx, hy, 0.04 + 0.88), (1.0, 0.8, 0.06), m["plank"])
    add_doorway(0.5, 0.5, (hx, hy), width=0.3)
    for y in (hy - 0.3, hy + 0.3):
        add_box("pilaster", (hx + 0.5, y, 0.04 + 0.4), (0.03, 0.08, 0.8), m["marble"])
    add_box("bench", (0.5, -0.3, 0.04 + 0.16), (0.5, 0.4, 0.32), m["wood"])
    add_box("block", (0.5, -0.3, 0.04 + 0.5), (0.3, 0.3, 0.36), m["marble"])
    add_statue("statue", (-0.6, -0.6, 0.04), 0.5, m["marble"])
    add_crates("crates", (0.3, 0.5, 0.04), 2, m["wood"])

    return {"kind": "sculptureStudio", "variant": 0, "footprint": 2, "height": 1.2}

def build_mint():
    """The original's: a tall drum furnace on a scaffold, a ladder up to it, a
    second furnace at the foot, coin sacks by the wall."""
    m = workshop_materials()
    add_stone_yard(m["rubble"])
    coin = material("coin", hex_rgb("e0b040"), roughness=0.3, metallic=0.8)

    tx, ty = -0.3, 0.3
    for px, py in ((tx - 0.35, ty - 0.35), (tx + 0.35, ty - 0.35), (tx - 0.35, ty + 0.35), (tx + 0.35, ty + 0.35)):
        add_cylinder("scaffold_post", (px, py, 0.04 + 0.5), 0.025, 1.0, m["wood"], vertices=6)
    add_box("scaffold_deck", (tx, ty, 0.04 + 1.0), (0.9, 0.9, 0.05), m["plank"])
    add_cylinder("drum", (tx, ty, 0.04 + 1.0 + 0.35), 0.24, 0.7, m["stone"], vertices=14)
    add_cylinder("drum_band", (tx, ty, 0.04 + 1.0 + 0.5), 0.25, 0.05, m["iron"], vertices=14)
    add_ladder("ladder", (tx + 0.8, ty - 0.6, 0.04), (tx + 0.4, ty - 0.2, 0.04 + 0.98), m["wood"])
    add_kiln("hearth", (0.55, -0.4, 0.04), 0.4, m["brick"], m["iron"])
    for index in range(3):
        add_sack(f"sack{index}", (-0.7 + index * 0.22, -0.68, 0.04), m["sack"] if "sack" in m else m["plank"])
    add_cylinder("coins", (-0.3, -0.5, 0.04 + 0.02), 0.12, 0.04, coin, vertices=10)

    return {"kind": "mint", "variant": 0, "footprint": 2, "height": 2.0}

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
    """A farm of another crop: the same farmhouse, a different strip before it."""
    crop = plaster_material("crop", hex_rgb(crop_hex), roughness=0.94, variation=0.16, scale=14.0)
    add_farmhouse((-0.15, 0.4))
    add_crop_rows((-0.2, -0.6), 1.4, crop, row_count)
    return {"kind": kind, "variant": 0, "footprint": 2, "height": 1.2}


def build_hunting_lodge():
    """The original's: the farmhouse with a stone forecourt and a drying rack of pelts."""
    m = civic_materials()
    hide = plaster_material("hide", HIDE, roughness=0.95, variation=0.2, scale=8.0)
    add_farmhouse((-0.15, 0.4))
    add_box("forecourt", (-0.2, -0.55, 0.02), (1.5, 0.7, 0.04), m["paving"])
    add_rack("rack", (0.5, -0.6, 0.04), 0.5, 0.4, m["wood"], hide)
    add_box("pelt", (-0.5, -0.6, 0.04 + 0.02), (0.3, 0.2, 0.04), hide)
    return {"kind": "huntingLodge", "variant": 0, "footprint": 2, "height": 1.2}

def build_fishery():
    """The original's: a plank deck on the shore, nets hung from a tall frame, a
    boat drawn up, a fish basket."""
    m = civic_materials()
    net = plaster_material("net", hex_rgb("6a6a3a"), roughness=0.95, variation=0.2, scale=30.0)
    add_box("deck", (0, 0, 0.06), (1.9, 1.9, 0.12), m["plank"])
    for index in range(9):
        add_box("deck_gap", (-0.8 + index * 0.2, 0, 0.125), (0.015, 1.9, 0.005), m["wood"])
    fx, fy = -0.5, 0.4
    for px, py in ((fx - 0.3, fy), (fx + 0.3, fy)):
        add_cylinder("frame_post", (px, py, 0.12 + 0.6), 0.025, 1.2, m["wood"], vertices=6)
    add_box("frame_top", (fx, fy, 0.12 + 1.2), (0.7, 0.04, 0.04), m["wood"])
    sheet = add_box("net", (fx, fy, 0.12 + 0.7), (0.6, 0.02, 0.9), net)
    sheet.rotation_euler[0] = 0.1
    add_box("boat", (0.5, -0.4, 0.12 + 0.12), (0.9, 0.36, 0.24), m["wood"])
    add_box("boat_inner", (0.5, -0.4, 0.12 + 0.2), (0.8, 0.26, 0.1), m["dark"])
    add_barrel("basket", (-0.5, -0.6, 0.12), m["clay"], radius=0.14, height=0.18)
    add_box("crate", (0.7, 0.6, 0.12 + 0.1), (0.24, 0.24, 0.2), m["plank"])
    return {"kind": "fishery", "variant": 0, "footprint": 2, "height": 1.5}

def build_artisans_guild():
    """Artisans' guild: a working yard of half-cut stone, scaffolding poles and tool benches."""
    def props():
        marble = material("marble", MARBLE, roughness=0.34)
        wood = material("wood", WOOD, roughness=0.88)
        bronze = material("bronze", BRONZE, roughness=0.35, metallic=1.0)

        add_box("block", (0.6, -0.5, 0.06 + 0.14), (0.4, 0.4, 0.28), marble)
        add_box("half_cut", (0.62, 0.14, 0.06 + 0.1), (0.36, 0.3, 0.2), marble)
        for pole_x, pole_y in ((0.3, 0.62), (0.94, 0.62), (0.3, 0.94), (0.94, 0.94)):
            add_cylinder("scaffold", (pole_x, pole_y, 0.06 + 0.34), 0.03, 0.68, wood, vertices=6)
        add_box("scaffold_deck", (0.62, 0.78, 0.06 + 0.66), (0.74, 0.42, 0.06), wood)
        add_box("bench", (-0.86, 0.5, 0.06 + 0.14), (0.22, 0.7, 0.28), wood)
        add_box("chisels", (-0.86, 0.5, 0.06 + 0.3), (0.14, 0.4, 0.04), bronze)

    return build_industry_yard("artisansGuild", "8a6134", props, 1.1)


def build_pyramid(kind, footprint, courses):
    """A stepped pyramid on a paved court, in ashlar marble."""
    paving = plaster_material("paving", STONE, roughness=0.88, variation=0.05, scale=14.0)
    marble = plaster_material("ashlar", hex_rgb("f0e8d2"), roughness=0.5, variation=0.04, scale=7.0)
    capstone = material("capstone", hex_rgb("e0c884"), roughness=0.35, metallic=0.6)
    clay = material("clay", CLAY, roughness=0.8)
    cypress = material("cypress", CYPRESS, roughness=0.9)

    half = footprint / 2 - 0.06
    court = add_box("court", (0, 0, 0.03), (half * 2, half * 2, 0.06), paving)
    court.visible_shadow = False

    base = half * 0.86
    rise = base / courses * 1.1
    for course in range(courses):
        size = base * (1 - course / courses)
        add_box(
            f"course_{course}",
            (0, 0, 0.06 + rise * course + rise / 2),
            (size * 2, size * 2, rise),
            marble,
        )
    add_pyramid("cap", (0, 0, 0.06 + rise * courses), base / courses * 1.4, rise, capstone, vertices=4)

    add_cypress_pot("cypress", (half - 0.4, -half + 0.4, 0.06), 0.5, clay, cypress)
    add_amphora("jar", (-half + 0.4, half - 0.5, 0.06), 0.36, clay)

    return {"kind": kind, "variant": 0, "footprint": footprint, "height": 0.06 + rise * (courses + 1)}


def build_hippodrome():
    """Hippodrome: a long sanded track around a spina, banked seats on the far side."""
    paving = plaster_material("paving", STONE, roughness=0.88, variation=0.05, scale=14.0)
    track = plaster_material("track", hex_rgb("e0cf9f"), roughness=0.97, variation=0.07, scale=18.0)
    marble = material("marble", MARBLE, roughness=0.3)
    tiles = roof_material("tiles", TERRACOTTA, rows_per_unit=20.0)
    bronze = material("bronze", BRONZE, roughness=0.35, metallic=1.0)
    clay = material("clay", CLAY, roughness=0.8)
    cypress = material("cypress", CYPRESS, roughness=0.9)

    half = 2.4
    ground = add_box("ground", (0, 0, 0.03), (half * 2, half * 2, 0.06), paving)
    ground.visible_shadow = False
    add_box("track", (0, 0, 0.07), (4.4, 2.6, 0.03), track)

    add_box("spina", (0, 0, 0.06 + 0.16), (2.6, 0.4, 0.32), marble)
    for post_x in (-1.1, 1.1):
        add_cylinder("turning_post", (post_x, 0, 0.06 + 0.42), 0.09, 0.84, marble, vertices=12)
        add_cylinder("post_cap", (post_x, 0, 0.06 + 0.86), 0.12, 0.08, bronze, vertices=12)
    add_cylinder("egg_counter", (0, 0, 0.06 + 0.46), 0.14, 0.28, bronze, vertices=14)

    for tier in range(3):
        rise = 0.24 + tier * 0.34
        add_box(
            f"stand_{tier}",
            (0, 1.55 + tier * 0.3, 0.06 + rise / 2),
            (4.4, 0.32, rise),
            marble,
        )
    add_box("box_seat", (1.4, 1.9, 0.06 + 1.0), (1.0, 0.7, 0.36), marble)
    add_shed_roof("box_roof", (1.4, 1.9, 0.06 + 1.24), 0.55, 0.4, 0.08, tiles)

    add_box("stalls", (-2.1, -1.4, 0.06 + 0.3), (0.5, 1.6, 0.6), marble)
    add_cypress_pot("cypress", (2.1, -2.0, 0.06), 0.55, clay, cypress)
    add_amphora("jar", (-2.1, 1.9, 0.06), 0.36, clay)

    return {"kind": "hippodrome", "variant": 0, "footprint": 5, "height": 1.6}


def build_fountain():
    """The original's, at a single tile: a blue-rimmed basin, a canopied spout on
    four columns, a fringe of flowers."""
    m = civic_materials()
    flower = material("flower", hex_rgb("d84a3a"), roughness=0.9)

    add_cylinder("basin", (0, 0, 0.09), 0.44, 0.18, m["blue_wall"], vertices=24)
    add_cylinder("rim", (0, 0, 0.19), 0.46, 0.03, m["marble"], vertices=24)
    add_cylinder("water", (0, 0, 0.17), 0.4, 0.02, m["water"], vertices=24)
    for angle in (0.8, 2.35, 3.9, 5.5):
        add_column("column", (math.cos(angle) * 0.2, math.sin(angle) * 0.2, 0.19), 0.42, 0.028, m["marble"])
    add_box("canopy", (0, 0, 0.66), (0.5, 0.5, 0.05), m["blue_wall"])
    add_pyramid("canopy_roof", (0, 0, 0.76), 0.36, 0.16, m["blue_tile"], vertices=4)
    add_cylinder("spout", (0, 0, 0.32), 0.05, 0.26, m["bronze"], vertices=8)
    for angle in (0.4, 1.6, 2.8, 4.0, 5.2):
        add_hedge("flowers", (math.cos(angle) * 0.42, math.sin(angle) * 0.42), (0.08, 0.08, 0.06), m["hedge"])
        add_box("bloom", (math.cos(angle) * 0.42, math.sin(angle) * 0.42, 0.07), (0.04, 0.04, 0.03), flower)

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
    "agora": lambda: build_agora("agora", 3, 6, 0),
    "agora-turned": lambda: build_agora("agora", 3, 6, 1),
    "grand-agora": lambda: build_agora("grandAgora", 5, 6, 0),
    "grand-agora-turned": lambda: build_agora("grandAgora", 5, 6, 1),
    "growers-lodge": build_growers_lodge,
    "college": build_college,
    "gymnasium": build_gymnasium,
    "drama-school": build_drama_school,
    "theatre": build_theatre,
    "stadium": build_stadium,
    "hippodrome": build_hippodrome,
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
    "artisans-guild": build_artisans_guild,
    "pyramid-modest": lambda: build_pyramid("pyramidModest", 3, 3),
    "pyramid": lambda: build_pyramid("pyramid", 5, 4),
    "pyramid-great": lambda: build_pyramid("pyramidGreat", 7, 5),
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

    "house-plot": lambda: build_plot("housePlot", 2),
    "estate-plot": lambda: build_plot("estatePlot", 4),
}
for stall_variant in range(len(STALL_AWNINGS)):
    MODELS[f"stall-{stall_variant}"] = (lambda variant: lambda: build_stall(variant))(stall_variant)

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
    """From the front-left and high, as the original's renders were lit: the face
    the camera sees on the left is warm and bright, the one on the right falls into
    a blue-grey sky shadow at roughly a third of the brightness."""
    bpy.ops.object.light_add(type="SUN", location=(0, 0, 12))
    sun = bpy.context.active_object
    sun.data.energy = 3.6
    sun.data.color = (1.0, 0.9, 0.72)
    sun.data.angle = math.radians(2.0)
    sun.rotation_euler = (math.pi / 2 - SUN_ALTITUDE, 0, SUN_AZIMUTH)

    world = bpy.data.worlds.new("world")
    bpy.context.scene.world = world
    world.use_nodes = True
    background = world.node_tree.nodes["Background"]
    background.inputs[0].default_value = (0.5, 0.52, 0.68, 1)
    background.inputs[1].default_value = 0.34
    return sun


def footprint_sides(spec):
    """A footprint is a square side, or a pair of sides for a building laid long."""
    footprint = spec["footprint"]
    if isinstance(footprint, (list, tuple)):
        return footprint[0], footprint[1]
    return footprint, footprint


def diagonal_of(spec):
    across, along = footprint_sides(spec)
    return (across + along) / 2


def render_model(name, spec, out_dir, ground):
    """Two passes: the body with no shadow catcher, then the shadow with no body,
    so the game can lay a shadow under its neighbours instead of over them."""
    spread = diagonal_of(spec)
    resolution = (
        int((spread * TILE_WIDTH + 120) * SUPERSAMPLE),
        int((spread * TILE_HEIGHT + spec["height"] * 90 + 120) * SUPERSAMPLE),
    )
    camera = add_camera(spread, spec["height"], resolution)
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
    reach = (spec["height"] / math.tan(SUN_ALTITUDE) + diagonal_of(spec)) * PIXELS_PER_UNIT
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
