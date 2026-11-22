"""Build approved B identity. Usage: python build_masters.py /path/to/Manrope[wght].ttf (fonttools required)."""
from pathlib import Path
import sys
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

out = Path(__file__).parent / 'kit' / 'masters'
out.mkdir(parents=True, exist_ok=True)
brand = '#6355D9'
shape = 'M208 40V80H96A16 16 0 0 0 96 112H132V152H96A56 56 0 0 1 96 40Z M48 216V176H160A16 16 0 0 0 160 144H156V104H160A56 56 0 0 1 160 216Z'
small = shape.replace('H132V152', 'H128V152').replace('H156V104', 'H160V104')
reverse = shape.replace('V80H96A16 16 0 0 0 96 112', 'V78H96A18 18 0 0 0 96 114').replace('V176H160A16 16 0 0 0 160 144', 'V178H160A18 18 0 0 0 160 142')
def svg(name, body, box='0 0 256 256'):
    (out / f'{name}.svg').write_text(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{box}" role="img"><title>Switch Tab — {name}</title>{body}</svg>\n')
def path(d, color): return f'<path fill="{color}" d="{d}"/>'
for name, color in [('symbol',brand), ('symbol-black','#000000')]: svg(name,path(shape,color))
svg('symbol-reversed',path(reverse,'#FFFFFF'))
svg('symbol-small',path(small,brand))
svg('app-icon',f'<rect x="8" y="8" width="240" height="240" rx="56" fill="{brand}"/>'+path(shape,'#FFFFFF'))
# Small icon keeps the selected silhouette, but opens the central seam to two pixels at 16px.
svg('toolbar-icon',f'<rect width="256" height="256" rx="56" fill="{brand}"/>'+f'<g transform="translate(-8 -8) scale(1.0625)">{path(small,"#FFFFFF")}</g>')
font=instantiateVariableFont(TTFont(sys.argv[1]), {'wght':650})
glyphs=font.getGlyphSet(); cmap=font.getBestCmap(); scale=112/font['head'].unitsPerEm
pen=SVGPathPen(glyphs, ntos=lambda n: f'{n:.2f}'.rstrip('0').rstrip('.') if n else '0')
x=0; previous=''
for ch in 'Switch Tab':
    x += {('S','w'):-1, ('T','a'):-5}.get((previous,ch),0)
    name=cmap[ord(ch)]; glyphs[name].draw(TransformPen(pen,(scale,0,0,-scale,x,170)))
    x += glyphs[name].width*scale; previous=ch
word=pen.getCommands(); width=round(x+16)
svg('wordmark',path(word,'#17191D'),f'-8 64 {width} 128')
for name, color, symbol in [('horizontal', '#17191D',path(shape,brand)), ('horizontal-reversed','#FFFFFF',path(reverse,'#FFFFFF'))]:
    svg(name,symbol+f'<g transform="translate(280 0)">{path(word,color)}</g>',f'0 0 {280+width} 256')
svg('stacked',f'<g transform="translate({(width-256)/2:.2f} 0)">{path(shape,brand)}</g><g transform="translate(0 168)">{path(word,"#17191D")}</g>',f'-8 0 {width+16} 370')
