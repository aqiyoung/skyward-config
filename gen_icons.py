#!/usr/bin/env python3
"""把官方品牌 SVG 渲染成与 icons/X.png 同风格的圆角图标（品牌色底 + 白色 logo）。"""
import re
import urllib.request
from pathlib import Path

import cairosvg

OUT = Path(__file__).parent / "icons"
OUT.mkdir(exist_ok=True)

SI = "https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/{}.svg"

# Gemini 官方星芒是蓝→紫→粉渐变，Simple Icons 的单色 #8E75B2 偏灰紫，改用官方渐变
GEMINI_GRADIENT = {
    "stops": [("0%", "#4285F4"), ("50%", "#9B72CB"), ("100%", "#D96570")],
}

# (输出文件名, SVG 来源, 品牌色或渐变, viewBox, 是否把路径改成白色)
ICONS = [
    ("Claude.png",        SI.format("claude"),         "#D97757", "0 0 24 24",  True),
    ("OpenAI.png",        SI.format("openai"),         "#412991", "0 0 24 24",  True),
    ("GeminiGradient.png", SI.format("googlegemini"),  GEMINI_GRADIENT, "0 0 24 24",  True),
    ("GitHubCopilot.png", SI.format("githubcopilot"),  "#24292F", "0 0 24 24",  True),
    ("Perplexity.png",    SI.format("perplexity"),     "#1FB8CD", "0 0 24 24",  True),
    ("Cursor.png",        "https://cursor.com/favicon.svg", "#14120B", "0 0 512 512", False),
    ("WeChatMP2.png",     SI.format("wechat"),         "#07C160", "0 0 24 24",  True),
]

SIZE = 256
PAD = 52  # logo 区域的留白
LOGO = SIZE - 2 * PAD


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8")


def paths_of(svg: str, force_white: bool) -> str:
    """抽出 <path>，simple-icons 的强制白色；Cursor 保留官方灰阶但提到浅色以便深色底上看清。"""
    out = []
    for m in re.finditer(r"<path\b[^>]*/>", svg):
        tag = m.group(0)
        if force_white:
            tag = re.sub(r'fill="[^"]*"', 'fill="#FFFFFF"', tag)
            if "fill=" not in tag:
                tag = tag.replace("<path ", '<path fill="#FFFFFF" ', 1)
        else:
            # Cursor 官方两色：深色主体->白，浅色高光->浅灰，保留 3D 结构
            tag = tag.replace('fill="#14120b"', 'fill="#FFFFFF"')
            tag = tag.replace('fill="#edecec"', 'fill="#BFBDB6"')
        out.append(tag)
    if not out:
        raise RuntimeError("no <path> found in SVG")
    return "".join(out)


def background(brand) -> str:
    rect = f'<rect x="2" y="2" width="{SIZE - 4}" height="{SIZE - 4}" rx="56" fill="{{fill}}"/>'
    if isinstance(brand, str):
        return rect.format(fill=brand)
    stops = "".join(f'<stop offset="{o}" stop-color="{c}"/>' for o, c in brand["stops"])
    return (
        f'<defs><linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">{stops}</linearGradient></defs>'
        + rect.format(fill="url(#bg)")
    )


def render(name: str, url: str, brand, view_box: str, force_white: bool) -> None:
    svg = fetch(url)
    d = paths_of(svg, force_white)
    vb = [float(x) for x in view_box.split()]
    scale = LOGO / max(vb[2], vb[3])
    tx = (SIZE - vb[2] * scale) / 2 - vb[0] * scale
    ty = (SIZE - vb[3] * scale) / 2 - vb[1] * scale

    doc = f"""<svg xmlns="http://www.w3.org/2000/svg" width="{SIZE}" height="{SIZE}" viewBox="0 0 {SIZE} {SIZE}">
  {background(brand)}
  <g transform="translate({tx:.3f},{ty:.3f}) scale({scale:.6f})">{d}</g>
</svg>"""
    target = OUT / name
    cairosvg.svg2png(bytestring=doc.encode("utf-8"), write_to=str(target), output_width=SIZE, output_height=SIZE)
    print(f"wrote {target}  ({target.stat().st_size} bytes)")


for spec in ICONS:
    render(*spec)
