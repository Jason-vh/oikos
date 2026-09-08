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


def window_material(night):
    mat = bpy.data.materials.new("window")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    if night:
        bsdf.inputs["Base Color"].default_value = (1.0, 0.42, 0.08, 1)
        bsdf.inputs["Emission Color"].default_value = (1.0, 0.42, 0.08, 1)
        bsdf.inputs["Emission Strength"].default_value = 2.0
    else:
        bsdf.inputs["Base Color"].default_value = (0.09, 0.07, 0.05, 1)
        bsdf.inputs["Roughness"].default_value = 0.4
    return mat


def add_openings(half, sill, tall, night, door_mat, centre=(0.0, 0.0)):
    """Door on the +X face and windows on the -Y face — the two the camera sees."""
    cx, cy = centre
    glass = window_material(night)
    add_box("door", (cx + half - 0.01, cy, sill * 0.55), (0.05, 0.2, sill * 1.1), door_mat)
    for offset in (-0.22, 0.22):
        if abs(offset) > half:
            continue
        add_box("window", (cx + offset, cy - half + 0.01, sill + tall * 0.15), (0.15, 0.05, 0.16), glass)


def build_granary(phase):
    """A 2x2 Greek granary: stone plinth, columned portico, tiled roof, dome."""
    stone = material("stone", (0.78, 0.74, 0.64), roughness=0.75)
    plaster = material("plaster", (0.86, 0.82, 0.70), roughness=0.85)
    roof = material("roof", (0.42, 0.17, 0.10), roughness=0.6)
    marble = material("marble", (0.92, 0.90, 0.83), roughness=0.35)
    add_openings(0.59, 0.3, 0.58, phase >= SUN_PHASES, material("wood", (0.24, 0.15, 0.09)))

    add_box("step", (0, 0, 0.05), (1.9, 1.9, 0.1), stone)
    add_box("plinth", (0, 0, 0.14), (1.7, 1.7, 0.1), stone)
    add_box("walls", (0, 0, 0.47), (1.18, 1.18, 0.58), plaster)
    add_box("cornice", (0, 0, 0.79), (1.6, 1.6, 0.08), stone)

    for x in (-0.7, 0.7):
        for y in (-0.7, 0.7):
            add_cylinder("column", (x, y, 0.47), 0.1, 0.58, marble)
            add_box("capital", (x, y, 0.78), (0.28, 0.28, 0.07), marble)

    bpy.ops.mesh.primitive_cone_add(
        radius1=0.99, radius2=0.0, depth=0.44, location=(0, 0, 1.03), vertices=4
    )
    roof_obj = bpy.context.active_object
    roof_obj.name = "roof"
    roof_obj.rotation_euler[2] = math.radians(45)
    roof_obj.data.materials.append(roof)

    add_cylinder("silo", (0, 0, 1.06), 0.26, 0.34, plaster, vertices=20)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.26, location=(0, 0, 1.23), segments=24, ring_count=12)
    dome = bpy.context.active_object
    dome.name = "dome"
    dome.scale[2] = 0.6
    dome.data.materials.append(marble)
    bpy.ops.object.shade_smooth()

    return {"kind": "granary", "variant": 0, "footprint": 2, "height": 1.4}


def build_house(tier, phase):
    night = phase >= SUN_PHASES
    wood = material("wood", (0.22, 0.13, 0.07), roughness=0.8)
    thatch = material("thatch", (0.42, 0.31, 0.13), roughness=0.95)
    tiles = material("tiles", (0.4, 0.13, 0.07), roughness=0.6)
    mud = material("mud", (0.44, 0.34, 0.24), roughness=0.95)
    plaster = material("plaster", (0.8, 0.74, 0.6), roughness=0.85)
    marble = material("marble", (0.9, 0.88, 0.8), roughness=0.4)

    if tier == 0:
        add_box("walls", (0, 0, 0.23), (0.6, 0.6, 0.46), mud)
        add_pyramid("roof", (0, 0, 0.56), 0.36, 0.2, thatch)
        add_openings(0.3, 0.24, 0.46, night, wood)
        return {"kind": "house", "variant": 0, "footprint": 1, "height": 0.7}

    if tier == 1:
        add_box("plinth", (0, 0, 0.03), (0.74, 0.74, 0.06), mud)
        add_box("walls", (0, 0, 0.32), (0.68, 0.68, 0.52), mud)
        add_pyramid("roof", (0, 0, 0.69), 0.41, 0.22, thatch)
        add_openings(0.34, 0.3, 0.52, night, wood)
        return {"kind": "house", "variant": 1, "footprint": 1, "height": 0.84}

    if tier == 2:
        add_box("plinth", (0, 0, 0.04), (0.82, 0.82, 0.08), material("stone", (0.72, 0.68, 0.6)))
        add_box("walls", (0, 0, 0.39), (0.76, 0.76, 0.62), plaster)
        add_box("cornice", (0, 0, 0.73), (0.82, 0.82, 0.05), material("stone", (0.68, 0.63, 0.54)))
        add_pyramid("roof", (0, 0, 0.87), 0.45, 0.24, tiles)
        add_box("chimney", (-0.22, 0.22, 0.9), (0.09, 0.09, 0.26), material("brick", (0.44, 0.34, 0.28)))
        add_openings(0.38, 0.34, 0.62, night, wood)
        return {"kind": "house", "variant": 2, "footprint": 1, "height": 1.05}

    add_box("plinth", (0, 0, 0.05), (0.88, 0.88, 0.1), material("stone", (0.75, 0.71, 0.62)))
    add_box("walls", (0, 0, 0.47), (0.8, 0.8, 0.74), plaster)
    add_box("cornice", (0, 0, 0.87), (0.86, 0.86, 0.06), marble)
    add_pyramid("roof", (0, 0, 1.03), 0.48, 0.26, tiles)
    add_box("chimney", (-0.24, 0.24, 1.06), (0.1, 0.1, 0.28), material("brick", (0.44, 0.34, 0.28)))
    for y in (-0.26, 0.26):
        add_cylinder("column", (0.43, y, 0.47), 0.055, 0.74, marble, vertices=16)
    add_openings(0.4, 0.4, 0.74, night, wood)
    return {"kind": "house", "variant": 3, "footprint": 1, "height": 1.24}


def build_wheat_farm(phase):
    soil = material("soil", (0.31, 0.22, 0.14), roughness=0.98)
    crop = material("crop", (0.74, 0.63, 0.24), roughness=0.9)
    mud = material("mud", (0.56, 0.45, 0.33), roughness=0.95)
    thatch = material("thatch", (0.6, 0.48, 0.23), roughness=0.95)

    add_box("field", (0, 0, 0.03), (1.92, 1.92, 0.06), soil)
    for index in range(9):
        y = -0.82 + index * 0.205
        add_box("row", (0.1, y, 0.12), (1.7, 0.12, 0.16), crop)

    add_box("hut", (-0.62, 0.62, 0.24), (0.52, 0.52, 0.36), mud)
    add_pyramid("hut_roof", (-0.62, 0.62, 0.54), 0.33, 0.24, thatch, vertices=12)
    add_openings(0.26, 0.24, 0.3, phase >= SUN_PHASES, material("wood", (0.26, 0.16, 0.09)), (-0.62, 0.62))
    return {"kind": "wheatFarm", "variant": 0, "footprint": 2, "height": 0.8}


def build_fountain(phase):
    stone = material("stone", (0.8, 0.77, 0.68), roughness=0.7)
    marble = material("marble", (0.92, 0.9, 0.84), roughness=0.35)
    water = material("water", (0.18, 0.45, 0.62), roughness=0.08)
    water.node_tree.nodes["Principled BSDF"].inputs["IOR"].default_value = 1.33

    add_cylinder("basin", (0, 0, 0.11), 0.44, 0.22, stone, vertices=32)
    add_cylinder("water", (0, 0, 0.19), 0.37, 0.08, water, vertices=32)
    add_cylinder("pillar", (0, 0, 0.3), 0.07, 0.34, marble, vertices=16)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.11, location=(0, 0, 0.5), segments=20, ring_count=10)
    finial = bpy.context.active_object
    finial.data.materials.append(marble)
    bpy.ops.object.shade_smooth()
    void_phase(phase)
    return {"kind": "fountain", "variant": 0, "footprint": 1, "height": 0.62}


def build_statue(phase):
    stone = material("stone", (0.78, 0.75, 0.66), roughness=0.7)
    marble = material("marble", (0.94, 0.92, 0.86), roughness=0.3)

    add_box("step", (0, 0, 0.05), (0.76, 0.76, 0.1), stone)
    add_box("pedestal", (0, 0, 0.26), (0.52, 0.52, 0.32), marble)
    add_box("cap", (0, 0, 0.45), (0.6, 0.6, 0.06), stone)

    add_cylinder("legs", (0, 0, 0.66), 0.11, 0.36, marble, vertices=20)
    add_cylinder("torso", (0, 0, 0.94), 0.14, 0.28, marble, vertices=20)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.1, location=(0, 0, 1.15), segments=20, ring_count=12)
    head = bpy.context.active_object
    head.data.materials.append(marble)
    bpy.ops.object.shade_smooth()

    bpy.ops.mesh.primitive_cylinder_add(radius=0.05, depth=0.34, location=(0.16, -0.04, 1.02), vertices=14)
    arm = bpy.context.active_object
    arm.rotation_euler[1] = math.radians(48)
    arm.data.materials.append(marble)
    bpy.ops.object.shade_smooth()

    void_phase(phase)
    return {"kind": "statue", "variant": 0, "footprint": 1, "height": 1.3}


def void_phase(phase):
    """These models have no lit windows; the phase only drives the sun."""
    del phase


MODELS = {
    "granary": build_granary,
    "wheat-farm": build_wheat_farm,
    "fountain": build_fountain,
    "statue": build_statue,
    "house-0": lambda phase: build_house(0, phase),
    "house-1": lambda phase: build_house(1, phase),
    "house-2": lambda phase: build_house(2, phase),
    "house-3": lambda phase: build_house(3, phase),
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
