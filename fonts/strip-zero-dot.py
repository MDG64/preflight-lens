"""Retire le point central des zéros d'IBM Plex Mono (woff2).

Le zéro par défaut de Plex Mono est pointé, et les sous-ensembles Google
Fonts n'embarquent aucune variante nue : on supprime donc le contour du
point directement dans les glyphes zero, zero.numr et zero.dnom.
"""
import sys
from fontTools.ttLib import TTFont
from fontTools.pens.recordingPen import RecordingPen
from fontTools.pens.ttGlyphPen import TTGlyphPen

TARGETS = {"zero", "zero.numr", "zero.dnom"}


def split_contours(recording):
    contours, cur = [], []
    for op, args in recording:
        cur.append((op, args))
        if op in ("closePath", "endPath"):
            contours.append(cur)
            cur = []
    if cur:
        contours.append(cur)
    return contours


def bbox_area(contour):
    xs, ys = [], []
    for _, args in contour:
        for pt in args:
            if pt is None:
                continue
            xs.append(pt[0])
            ys.append(pt[1])
    if not xs:
        return 0
    return (max(xs) - min(xs)) * (max(ys) - min(ys))


def patch(path):
    font = TTFont(path)
    glyf = font["glyf"]
    changed = []
    for name in TARGETS & set(font.getGlyphOrder()):
        glyph = glyf[name]
        if glyph.numberOfContours < 3:
            continue
        rec = RecordingPen()
        glyph.draw(rec, glyf)
        contours = split_contours(rec.value)
        dot = min(contours, key=bbox_area)
        pen = TTGlyphPen(None)
        for contour in contours:
            if contour is dot:
                continue
            for op, args in contour:
                getattr(pen, op)(*args)
        glyf[name] = pen.glyph()
        changed.append(name)
    if changed:
        font.save(path)
    print(f"{path}: {'patched ' + ', '.join(changed) if changed else 'rien a faire'}")


if __name__ == "__main__":
    for p in sys.argv[1:]:
        patch(p)
