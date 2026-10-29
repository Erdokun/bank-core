"""Optional GPU shader QA, without launching or controlling a browser.

Install moderngl and Pillow in the development environment, then run this file.
It renders the same fragment shader to temporary PNGs for visual inspection.
"""
from pathlib import Path
import re
import struct
import tempfile

import moderngl
from PIL import Image

root = Path(__file__).resolve().parents[1]
source = (root / "app/static/hero-scene.js").read_text(encoding="utf-8")
shader = re.search(r"var fragmentSource=`(.*?)`;", source, re.S).group(1)
# The shader logic stays identical; only the desktop GL interface syntax changes.
shader = "#version 330\nout vec4 outputColor;\n" + shader.replace("precision highp float;", "")
shader = shader.replace("texture2D(", "texture(").replace("gl_FragColor", "outputColor")
ctx = moderngl.create_standalone_context()
program = ctx.program(vertex_shader="#version 330\nin vec2 aPosition;void main(){gl_Position=vec4(aPosition,0.0,1.0);}", fragment_shader=shader)
vertices = [-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]
buffer = ctx.buffer(struct.pack("12f", *vertices))
vao = ctx.vertex_array(program, [(buffer, "2f", "aPosition")])
image = Image.open(root / "app/static/assets/earth-map.jpg").convert("RGB").transpose(Image.Transpose.FLIP_TOP_BOTTOM)
texture = ctx.texture(image.size, 3, image.tobytes())
texture.repeat_x = True
texture.repeat_y = False
texture.build_mipmaps()
texture.use(0)
program["uEarth"] = 0
clouds = Image.open(root / "app/static/assets/earth-clouds.png").convert("RGBA").transpose(Image.Transpose.FLIP_TOP_BOTTOM)
cloud_texture = ctx.texture(clouds.size, 4, clouds.tobytes())
cloud_texture.repeat_x = True
cloud_texture.repeat_y = False
cloud_texture.filter = (moderngl.LINEAR, moderngl.LINEAR)
cloud_texture.use(1)
program["uClouds"] = 1
program["uPointer"] = (0.0, 0.0)
program["uScroll"] = 0.0
output = Path(tempfile.gettempdir()) / "veyra-hero-qa"
output.mkdir(exist_ok=True)
for width, height, seconds, name in [(1600, 900, 0, "desktop"), (1600, 900, 15, "rotated"), (390, 760, 0, "mobile")]:
    frame = ctx.simple_framebuffer((width, height))
    frame.use()
    ctx.viewport = (0, 0, width, height)
    program["uSize"] = (width, height)
    program["uTime"] = seconds
    vao.render()
    result = Image.frombytes("RGB", (width, height), frame.read(components=3)).transpose(Image.Transpose.FLIP_TOP_BOTTOM)
    result.save(output / f"{name}.png")
    print(output / f"{name}.png")
    frame.release()
print("Shader compiled and rendered on", ctx.info["GL_RENDERER"])
