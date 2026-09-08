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
    parser.add_argument("--only", default="")
    return parser.parse_args(argv)


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 64
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


def material(name, colour, roughness=0.8, metallic=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*colour, 1)
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


def build_granary():
    """A 2x2 Greek granary: stone plinth, columned portico, tiled roof, dome."""
    stone = material("stone", (0.78, 0.74, 0.64), roughness=0.75)
    plaster = material("plaster", (0.86, 0.82, 0.70), roughness=0.85)
    roof = material("roof", (0.42, 0.17, 0.10), roughness=0.6)
    marble = material("marble", (0.92, 0.90, 0.83), roughness=0.35)

    add_box("plinth", (0, 0, 0.12), (1.9, 1.9, 0.24), stone)
    add_box("walls", (0, 0, 0.62), (1.5, 1.5, 0.76), plaster)

    for x in (-0.82, 0.82):
        for y in (-0.82, 0.82):
            add_cylinder("column", (x, y, 0.62), 0.1, 0.76, marble)

    bpy.ops.mesh.primitive_cone_add(
        radius1=1.45, radius2=0.0, depth=0.55, location=(0, 0, 1.28), vertices=4
    )
    roof_obj = bpy.context.active_object
    roof_obj.name = "roof"
    roof_obj.rotation_euler[2] = math.radians(45)
    roof_obj.data.materials.append(roof)

    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.42, location=(0, 0, 1.5), segments=24, ring_count=12)
    dome = bpy.context.active_object
    dome.name = "dome"
    dome.scale[2] = 0.7
    dome.data.materials.append(marble)
    bpy.ops.object.shade_smooth()

    return {"footprint": 2, "height": 2.1}


MODELS = {"granary": build_granary}


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
        sun.data.energy = 3.2
        sun.data.color = (1.0, 0.94 - 0.16 * warmth, 0.84 - 0.34 * warmth)
        sun.data.angle = math.radians(2 + 6 * warmth)

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

    manifest = {"tileWidth": TILE_WIDTH, "tileHeight": TILE_HEIGHT, "supersample": SUPERSAMPLE, "sprites": []}
    names = [args.only] if args.only else list(MODELS)

    for name in names:
        for phase in range(SUN_PHASES + 1):
            clear_scene()
            spec = MODELS[name]()
            add_ground()
            path, resolution = render_phase(name, spec, phase, out_dir)

            manifest["sprites"].append(
                {
                    "kind": name,
                    "phase": phase,
                    "file": os.path.basename(path),
                    "footprint": spec["footprint"],
                    "heightUnits": spec["height"],
                    "width": resolution[0] // SUPERSAMPLE,
                    "height": resolution[1] // SUPERSAMPLE,
                }
            )

    with open(os.path.join(out_dir, "manifest.json"), "w") as handle:
        json.dump(manifest, handle, indent=2)
    print(f"rendered {len(manifest['sprites'])} sprites to {out_dir}")


if __name__ == "__main__":
    main()
