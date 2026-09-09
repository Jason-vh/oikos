"""
Decode Impressions .sg3/.555 sprite archives (Caesar 3, Pharaoh, Zeus) to PNG.

    python3 pipeline/sg_extract.py reference/og/DATA/Zeus_General.sg3 reference/sprites

Writes one PNG per image into <out>/<archive>/<group>/<index>.png, plus a
contact sheet per group with indices, so a sprite can be found by eye and then
referred to by number. Reference only: nothing here is shipped.
"""

import os
import struct
import sys

from PIL import Image, ImageDraw

HEADER_SIZE = 680
BITMAP_RECORD_SIZE = 200
BITMAP_RECORD_COUNT = 272
ISOMETRIC = 30
PLAIN = {0, 1, 10, 12, 13}
SPRITE = {256, 257, 276}
TILE_SHAPES = {30: (58, 30, 1800), 40: (78, 40, 3200)}
SHEET_COLUMNS = 12
SHEET_CELL = 160
SHEET_CAPACITY = 480
SHADOW_KEY = 0x7C00
SHADOW = (0, 0, 0, 128)


class Archive:
    def __init__(self, path):
        self.path = path
        self.name = os.path.splitext(os.path.basename(path))[0]
        with open(path, "rb") as f:
            data = f.read()
        version, self.max_images, self.image_count, self.bitmap_count = struct.unpack("<xxxxIxxxxiii", data[:24])
        self.version = version
        self.has_alpha = version >= 0xD6
        self.bitmaps = [self.read_bitmap(data, i) for i in range(self.bitmap_count)]
        record_size = 72 if self.has_alpha else 64
        base = HEADER_SIZE + BITMAP_RECORD_COUNT * BITMAP_RECORD_SIZE
        self.images = [self.read_image(data, base + i * record_size, i) for i in range(self.image_count)]
        self.pixels = self.read_pixels()

    @staticmethod
    def read_bitmap(data, index):
        offset = HEADER_SIZE + index * BITMAP_RECORD_SIZE
        name = data[offset : offset + 65].split(b"\0")[0].decode("latin-1")
        return os.path.splitext(name)[0]

    def read_image(self, data, offset, index):
        data_offset, length, uncompressed, _, invert, width, height = struct.unpack("<IIIIihh", data[offset : offset + 24])
        kind = struct.unpack("<H", data[offset + 50 : offset + 52])[0]
        flags = data[offset + 52 : offset + 56]
        bitmap = data[offset + 56]
        alpha_offset = alpha_length = 0
        if self.has_alpha:
            alpha_offset, alpha_length = struct.unpack("<II", data[offset + 64 : offset + 72])
        return {
            "index": index,
            "offset": data_offset,
            "length": length,
            "uncompressed": uncompressed,
            "invert": invert,
            "width": width,
            "height": height,
            "kind": kind,
            "external": flags[0] != 0,
            "size": flags[3],
            "bitmap": bitmap,
            "alpha_offset": alpha_offset,
            "alpha_length": alpha_length,
        }

    def read_pixels(self):
        main = self.path[:-4] + ".555"
        if not os.path.exists(main):
            main = self.path[:-4] + ".555".upper()
        with open(main, "rb") as f:
            return f.read()

    def decode(self, image):
        if image["width"] <= 0 or image["height"] <= 0:
            return None
        if image["invert"]:
            source = self.decode(self.images[image["index"] + image["invert"]])
            return source.transpose(Image.FLIP_LEFT_RIGHT) if source else None
        start = image["offset"] - (1 if image["external"] else 0)
        buffer = self.pixels[start : start + image["length"]]
        canvas = Image.new("RGBA", (image["width"], image["height"]), (0, 0, 0, 0))
        pixels = canvas.load()
        if image["kind"] == ISOMETRIC:
            write_isometric(pixels, image, buffer)
        elif image["kind"] in PLAIN:
            write_plain(pixels, image, buffer)
        elif image["kind"] in SPRITE:
            write_transparent(pixels, image["width"], buffer)
        else:
            return None
        if image["alpha_length"]:
            alpha = self.pixels[image["alpha_offset"] : image["alpha_offset"] + image["alpha_length"]]
            write_alpha(pixels, image["width"], alpha)
        return canvas


def rgb555(word):
    if word == SHADOW_KEY:
        return SHADOW
    red = ((word >> 10) & 0x1F) << 3
    green = ((word >> 5) & 0x1F) << 3
    blue = (word & 0x1F) << 3
    return (red | red >> 5, green | green >> 5, blue | blue >> 5, 255)


def write_plain(pixels, image, buffer):
    width, height = image["width"], image["height"]
    for i in range(min(width * height, len(buffer) // 2)):
        word = buffer[2 * i] | buffer[2 * i + 1] << 8
        pixels[i % width, i // width] = rgb555(word)


def write_transparent(pixels, width, buffer):
    i = x = y = 0
    height = len(buffer)
    while i < len(buffer):
        count = buffer[i]
        i += 1
        if count == 255:
            x += buffer[i]
            i += 1
            while x >= width:
                x -= width
                y += 1
            continue
        for _ in range(count):
            if i + 1 >= len(buffer):
                return
            word = buffer[i] | buffer[i + 1] << 8
            i += 2
            try:
                pixels[x, y] = rgb555(word)
            except IndexError:
                return
            x += 1
            if x >= width:
                x = 0
                y += 1


def write_alpha(pixels, width, buffer):
    i = x = y = 0
    while i < len(buffer):
        count = buffer[i]
        i += 1
        if count == 255:
            x += buffer[i]
            i += 1
            while x >= width:
                x -= width
                y += 1
            continue
        for _ in range(count):
            if i >= len(buffer):
                return
            value = buffer[i]
            i += 1
            try:
                r, g, b, _ = pixels[x, y]
                pixels[x, y] = (r, g, b, value << 3 | value >> 2)
            except IndexError:
                return
            x += 1
            if x >= width:
                x = 0
                y += 1


def write_isometric(pixels, image, buffer):
    width = image["width"]
    base_height = (width + 2) // 2
    size = image["size"]
    if size == 0:
        for tile_height in TILE_SHAPES:
            if base_height % tile_height == 0:
                size = base_height // tile_height
                break
    shape = next((s for h, s in TILE_SHAPES.items() if h * size == base_height), None)
    if shape is None:
        write_transparent(pixels, width, buffer[image["uncompressed"] :])
        return
    tile_width, tile_height, tile_bytes = shape
    y_offset = image["height"] - base_height
    i = 0
    for row in range(2 * size - 1):
        steps_in = size - row - 1 if row < size else row - size + 1
        x_offset = steps_in * (tile_width + 2) // 2
        tiles_in_row = row + 1 if row < size else 2 * size - row - 1
        for _ in range(tiles_in_row):
            write_tile(pixels, buffer[i * tile_bytes : (i + 1) * tile_bytes], x_offset, y_offset, tile_width, tile_height)
            x_offset += tile_width + 2
            i += 1
        y_offset += tile_height // 2
    write_transparent(pixels, width, buffer[image["uncompressed"] :])


def write_tile(pixels, buffer, offset_x, offset_y, tile_width, tile_height):
    half = tile_height // 2
    i = 0
    for y in range(tile_height):
        start = tile_height - 2 * (y + 1) if y < half else 2 * y - tile_height
        for x in range(start, tile_width - start):
            if i + 1 >= len(buffer):
                return
            word = buffer[i] | buffer[i + 1] << 8
            i += 2
            pixels[offset_x + x, offset_y + y] = rgb555(word)


def contact_sheet(entries, path):
    rows = (len(entries) + SHEET_COLUMNS - 1) // SHEET_COLUMNS
    sheet = Image.new("RGBA", (SHEET_COLUMNS * SHEET_CELL, max(rows, 1) * SHEET_CELL), (60, 60, 60, 255))
    draw = ImageDraw.Draw(sheet)
    for slot, (index, sprite) in enumerate(entries):
        cell_x = (slot % SHEET_COLUMNS) * SHEET_CELL
        cell_y = (slot // SHEET_COLUMNS) * SHEET_CELL
        thumb = sprite.copy()
        thumb.thumbnail((SHEET_CELL - 8, SHEET_CELL - 20))
        sheet.alpha_composite(thumb, (cell_x + 4, cell_y + 4))
        draw.text((cell_x + 4, cell_y + SHEET_CELL - 14), f"{index} {sprite.width}x{sprite.height}", fill=(255, 255, 255, 255))
    sheet.save(path)


def extract(archive_path, out_root):
    archive = Archive(archive_path)
    out = os.path.join(out_root, archive.name)
    by_group = {}
    for image in archive.images:
        sprite = archive.decode(image)
        if sprite is None:
            continue
        group = archive.bitmaps[image["bitmap"]] if image["bitmap"] < len(archive.bitmaps) else f"bitmap{image['bitmap']}"
        group_dir = os.path.join(out, group)
        os.makedirs(group_dir, exist_ok=True)
        sprite.save(os.path.join(group_dir, f"{image['index']}.png"))
        by_group.setdefault(group, []).append((image["index"], sprite))
    for group, entries in by_group.items():
        for page in range(0, len(entries), SHEET_CAPACITY):
            suffix = f".{page // SHEET_CAPACITY}" if len(entries) > SHEET_CAPACITY else ""
            contact_sheet(entries[page : page + SHEET_CAPACITY], os.path.join(out, f"{group}{suffix}.sheet.png"))
        print(f"{archive.name}/{group}: {len(entries)} sprites")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    for path in sys.argv[1:-1]:
        extract(path, sys.argv[-1])
