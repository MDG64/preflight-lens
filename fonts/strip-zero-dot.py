"""Retire le point central des zéros d'IBM Plex Mono, et renomme la famille.

Le zéro par défaut de Plex Mono est pointé, et les sous-ensembles Google
Fonts n'embarquent aucune variante nue : on supprime donc le contour du
point directement dans les glyphes zero, zero.numr et zero.dnom.

Les DEUX opérations vont ensemble, et c'est la licence qui l'impose. IBM Plex
est sous SIL OFL 1.1 (texte complet dans OFL.txt à côté) avec le Reserved Font
Name « Plex » : sa condition 3 interdit de diffuser une version MODIFIÉE sous
le nom réservé. Retoucher les glyphes sans renommer mettrait le dépôt en
infraction — d'où le renommage en « Preflight Mono », qui ne contient pas
« Plex ». Le copyright IBM (nameID 0) et l'URL de licence (14) restent en
place : la condition 1 exige qu'ils accompagnent la police.

Les fichiers latin-ext ne sont PAS retouchés (leur zéro n'apparaît pas dans
l'app) : ils gardent leur nom interne d'origine, ce que l'OFL autorise
puisqu'ils sont inchangés. Seule leur famille CSS suit, côté HTML.

Usage : python strip-zero-dot.py fichier.woff2 [...]
"""
import sys
from fontTools.ttLib import TTFont
from fontTools.pens.recordingPen import RecordingPen
from fontTools.pens.ttGlyphPen import TTGlyphPen

TARGETS = {"zero", "zero.numr", "zero.dnom"}

# Substitutions de nommage. Appliquées à tous les enregistrements SAUF ceux qui
# portent la paternité et la licence (0 copyright, 7 marque, 13 licence,
# 14 URL) : ceux-là doivent rester intacts.
RENAMES = [("IBM Plex Mono", "Preflight Mono"), ("IBMPlexMono", "PreflightMono")]
KEEP_NAME_IDS = {0, 7, 13, 14}


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


def strip_dot(font):
    """Ôte le contour du point au centre des zéros. Idempotent : un glyphe déjà
    traité n'a plus assez de contours et passe son tour."""
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
    return changed


def rename_family(font):
    """Sort la police du Reserved Font Name. Idempotent lui aussi."""
    changed = []
    for rec in font["name"].names:
        if rec.nameID in KEEP_NAME_IDS:
            continue
        avant = str(rec)
        apres = avant
        for vieux, neuf in RENAMES:
            apres = apres.replace(vieux, neuf)
        if apres != avant:
            rec.string = apres
            changed.append(rec.nameID)
    return changed


def patch(path):
    font = TTFont(path)
    glyphes = strip_dot(font)
    noms = rename_family(font)
    if glyphes or noms:
        font.save(path)
    quoi = []
    if glyphes:
        quoi.append("glyphes " + ", ".join(glyphes))
    if noms:
        quoi.append("noms " + ", ".join(str(n) for n in sorted(set(noms))))
    print(f"{path}: {' / '.join(quoi) if quoi else 'rien a faire'}")


if __name__ == "__main__":
    for p in sys.argv[1:]:
        patch(p)
