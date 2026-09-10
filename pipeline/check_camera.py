import math
import sys
from pathlib import Path

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
import iso_render


def project(scene, camera, point, resolution):
    point = world_to_camera_view(scene, camera, Vector(point))
    return point.x * resolution[0], (1 - point.y) * resolution[1]


def check_projection():
    iso_render.clear_scene(samples=1, device="CPU")
    scene = bpy.context.scene
    camera = iso_render.add_camera(2, 2, (720, 840))
    bpy.context.view_layer.update()
    pixels_per_unit = iso_render.PIXELS_PER_UNIT * iso_render.SUPERSAMPLE
    for resolution in ((720, 600), (720, 720), (720, 840), (1968, 2088)):
        iso_render.frame_camera(camera, resolution)
        origin = project(scene, camera, (0, 0, 0), resolution)
        step = project(scene, camera, (1, 0, 0), resolution)
        assert math.isclose(step[0] - origin[0], 120, abs_tol=0.001), (resolution, origin, step)
        assert math.isclose(step[1] - origin[1], 60, abs_tol=0.001), (resolution, origin, step)
        for width, depth in ((1, 1), (2, 2), (6, 3), (3, 6)):
            south = project(scene, camera, (width / 2, -depth / 2, 0), resolution)
            across = (width - depth) / 2 * math.cos(math.pi / 4) * pixels_per_unit
            down = ((width + depth) / 2 * math.sin(math.pi / 6) * math.sin(math.pi / 4) + math.cos(math.pi / 6)) * pixels_per_unit
            assert math.isclose(south[0], resolution[0] / 2 + across, abs_tol=0.001)
            assert math.isclose(south[1], resolution[1] / 2 + down, abs_tol=0.001)
    print("Camera calibration passed: tile steps and footprint pivots across four aspect ratios")


if __name__ == "__main__":
    check_projection()
