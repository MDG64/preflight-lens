#!/usr/bin/env python3
"""
Zones de turbulence par niveau de vol, calculées depuis les vents du GFS 0,25°.

Pourquoi recalculer : les grilles WAFS de turbulence (EDR) ne sont plus en
accès libre (NCEP SCN 22-104 : retirées de NOMADS, servies par WIFS/SADIS sur
inscription). Les vents du GFS, eux, sont publics sur AWS Open Data, avec un
index .idx qui permet de ne télécharger que les champs utiles par Range HTTP.

Indice : Ellrod TI1 = cisaillement vertical × déformation horizontale
(Ellrod & Knapp 1992). Seuils, en 10^-7 s^-2 : light 4–8, moderate 8–12,
severe ≥ 12. C'est un indice d'air clair ; un masque convectif relève la
valeur là où le modèle FAIT de la convection (pluie convective instantanée
CPRAT > 0) selon l'énergie disponible (CAPE), et sous les cellules que sa
réflectivité simulée (REFC) donne pour violentes.

Ce qui est publié n'est plus une classe par point mais la VALEUR de
l'indice, en un octet : TI1 en 10^-7 s^-2 × 16, tronqué au pas de 16
(1 × 10^-7 : seize niveaux, quatre par classe — deux nuances à l'écran n'en
demandent pas plus, et chaque niveau de plus doublait presque le fichier),
plafonné à 240, mis à zéro sous light (le calme et le presque-calme n'ont
pas de nuance à montrer, et ils ne pèsent alors rien : 90 à 130 Ko par
fichier au lieu de 235 à 363 avec un pas de 4 et les valeurs sous light).
Tronqué, pas arrondi : light = 64 vaut exactement TI1 ≥ 4, moderate = 128
TI1 ≥ 8, severe = 192 TI1 ≥ 12 ; le relèvement convectif pose la nuance
FORTE de sa classe (96, 160, 224). Le client lit la classe avec ces seuils
(dans l'index) et peint la nappe en interpolant la valeur entre les
points : des contours lisses, là où des classes seules ne donnaient que
des rectangles.

Maille : celle du GFS, 0,25° — le monde entier tient dans un PNG 8 bits
gris (les filtres PNG et zlib font mieux que du RLE : le calme est à zéro
sur la plus grande part du globe). --pool n regroupe encore n×n points en
gardant la pire valeur si un jour il faut alléger.

Sortie (arborescence statique, à servir telle quelle sous /api/turb/) :
  OUT/index.json               run, échéances, niveaux, grille, encodage
  OUT/FL340/h006.png           un octet par point, du nord au sud, de l'ouest
                               à l'est ; sa grille dans un chunk tEXt « turb »

Lancer :  python3 tools/turb/build_turb.py --out /var/turb --hours 3-36 --bbox=-180,-90,180,90
          python3 tools/turb/build_turb.py --selftest      (aucun réseau)
Dépendances : numpy, eccodes (pip install numpy eccodes).
"""
import argparse, datetime as dt, json, os, re, struct, sys, urllib.request, zlib

import numpy as np

BUCKET = "https://noaa-gfs-bdp-pds.s3.amazonaws.com"
# Niveau de vol -> niveau de pression GFS le plus proche (atmosphère standard).
# Le fichier principal (pgrb2) s'arrête à un pas de 50 hPa entre 300 et 100 :
# FL300, FL340, FL390 — un trou pile sur la croisière. Les niveaux
# intermédiaires (275, 225, 175 hPa : FL320, FL360, FL410) sont des sorties
# du même cycle, publiées à côté dans le fichier pgrb2b (vérifié le
# 2026-09-04 sur l'index du run 00Z). Deux index à lire, même mécanisme.
FL_TO_HPA = {100: 700, 140: 600, 180: 500, 240: 400, 270: 350, 300: 300, 320: 275,
             340: 250, 360: 225, 390: 200, 410: 175, 450: 150}
# Tous les niveaux à lire : ceux des FL plus un voisin dessus et dessous pour
# le cisaillement vertical centré aux deux extrémités.
LEVELS = [800, 700, 600, 500, 400, 350, 300, 275, 250, 225, 200, 175, 150, 100]
# Ce que chaque fichier GFS porte : les niveaux « ronds » dans pgrb2, les
# quarts (275, 225, 175…) dans pgrb2b. Les champs de surface sont dans pgrb2.
GFS_FILES = ("pgrb2", "pgrb2b")
# Grille de sortie par défaut : le monde, du nord au sud, de l'ouest à l'est.
DEFAULT_BBOX = (-180.0, -90.0, 180.0, 90.0)       # W, S, E, N
R_EARTH = 6371000.0
# Seuils Ellrod (×1e-7 s^-2) et masque convectif : CAPE (J/kg) là où il pleut
# de la convection (CPRAT, kg/m²/s > 0), réflectivité simulée (REFC, dBZ).
TI_LIGHT, TI_MOD, TI_SEV = 4.0, 8.0, 12.0
CAPE_LIGHT, CAPE_MOD = 1000.0, 2000.0
# L'octet publié : TI1 (×1e-7) × BYTE_PER_E7, tronqué au pas BYTE_STEP,
# plafonné au dernier multiple du pas sous 256, mis à zéro sous BYTE_FLOOR.
# Les seuils de classe en octets (BYTE_LEVELS — pas LEVELS, qui sont les
# hPa lus dans le GRIB) et la nuance forte que pose le relèvement convectif.
BYTE_PER_E7, BYTE_STEP, BYTE_FLOOR = 16, 16, 64
BYTE_LEVELS = (int(TI_LIGHT * BYTE_PER_E7), int(TI_MOD * BYTE_PER_E7), int(TI_SEV * BYTE_PER_E7))   # 64, 128, 192
CONV_BYTES = tuple(l + 32 for l in BYTE_LEVELS)                                                      # 96, 160, 224
CPRAT_MIN = 1e-5                                   # ≈ 0,04 mm/h : la cellule existe dans le modèle
REFC_SEV = 40.0                                    # dBZ : cellule violente, quel que soit le CAPE
CAPE_MAX_FL = 390                                  # au-dessus, le proxy convectif ne s'applique plus
POLE_LAT = 85.0                                    # au-delà, la grille est mise à zéro (dx -> 0)


# ----------------------------------------------------------------- réseau ---
def http_get(url, rng=None, timeout=120):
    req = urllib.request.Request(url, headers={"User-Agent": "preflight-lens-turb/1"})
    if rng:
        req.add_header("Range", "bytes=%d-%d" % rng)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def gfs_path(run, fh, kind="pgrb2"):
    return "gfs.%s/%02d/atmos/gfs.t%02dz.%s.0p25.f%03d" % (run.strftime("%Y%m%d"), run.hour, run.hour, kind, fh)


def parse_idx(text):
    """Lignes 'n:offset:d=...:VAR:LEVEL:fcst:' -> liste de [var, level, start, end|None, fcst]."""
    rows = []
    for line in text.decode("ascii", "replace").splitlines():
        p = line.split(":")
        if len(p) < 6:
            continue
        rows.append([p[3], p[4], int(p[1]), None, p[5]])
    for i in range(len(rows) - 1):
        rows[i][3] = rows[i + 1][2] - 1
    return rows


# Champs de surface / colonne : instantanés seulement — le GFS publie aussi
# des moyennes « 0-6 hour ave » du même nom, qu'on écarte sur le champ fcst.
SURFACE_FIELDS = {("CAPE", "surface"), ("CPRAT", "surface"), ("REFC", "entire atmosphere")}


def wanted(var, level, fcst=""):
    if (var, level) in SURFACE_FIELDS:
        return "ave" not in fcst
    m = re.fullmatch(r"(\d+) mb", level)
    return bool(m) and var in ("UGRD", "VGRD", "HGT") and int(m.group(1)) in LEVELS


def fetch_fields(run, fh):
    """Télécharge par Range les seuls messages utiles (des deux fichiers du
    cycle, pgrb2 puis pgrb2b) et les décode avec eccodes."""
    fields = {}
    for kind in GFS_FILES:
        fields.update(fetch_file(run, fh, kind))
    missing = [(v, p) for p in LEVELS for v in ("UGRD", "VGRD", "HGT") if (v, p) not in fields]
    if missing:
        raise RuntimeError("niveaux absents du cycle %s f%03d : %s" % (run.strftime("%Y%m%d%H"), fh, missing))
    return fields


def fetch_file(run, fh, kind):
    import eccodes
    base = "%s/%s" % (BUCKET, gfs_path(run, fh, kind))
    rows = [r for r in parse_idx(http_get(base + ".idx")) if wanted(r[0], r[1], r[4])]
    if not rows:
        raise RuntimeError("index sans champ utile : " + base)
    # Regroupe les plages contiguës pour limiter le nombre de requêtes.
    rows.sort(key=lambda r: r[2])
    groups, cur = [], None
    for r in rows:
        if cur and r[2] == cur[1] + 1 and r[3] is not None:
            cur[1] = r[3]
            cur[2].append(r)
        else:
            cur = [r[2], r[3] if r[3] is not None else r[2] + 4_000_000, [r]]
            groups.append(cur)
    fields = {}
    for start, end, members in groups:
        blob = http_get(base, (start, end))
        off = 0
        for var, level, s, e, _f in members:
            ln = (e - s + 1) if e is not None else len(blob) - off
            msg = blob[off:off + ln]
            off += ln
            h = eccodes.codes_new_from_message(msg)
            try:
                ni, nj = eccodes.codes_get(h, "Ni"), eccodes.codes_get(h, "Nj")
                lat1 = eccodes.codes_get(h, "latitudeOfFirstGridPointInDegrees")
                lon1 = eccodes.codes_get(h, "longitudeOfFirstGridPointInDegrees")
                dlat = eccodes.codes_get(h, "jDirectionIncrementInDegrees")
                dlon = eccodes.codes_get(h, "iDirectionIncrementInDegrees")
                jpos = eccodes.codes_get(h, "jScansPositively")
                vals = eccodes.codes_get_values(h).reshape(nj, ni)
            finally:
                eccodes.codes_release(h)
            if jpos:                                    # on veut du nord vers le sud
                vals = vals[::-1]
                lat1 = lat1 + (nj - 1) * dlat
            key = (var, int(level.split()[0]) if level.endswith(" mb") else "sfc")
            fields[key] = vals
            fields["_grid"] = (lat1, lon1, dlat, dlon, nj, ni)
    return fields


# ------------------------------------------------------------------ calcul ---
def subset(field, grid, bbox):
    """Découpe la grille mondiale (lat 90→-90, lon 0→359.75) sur la boîte W,S,E,N."""
    lat1, lon1, dlat, dlon, nj, ni = grid
    W, S, E, N = bbox
    j0 = int(round((lat1 - N) / dlat)); j1 = int(round((lat1 - S) / dlat))
    lons = (lon1 + np.arange(ni) * dlon + 180.0) % 360.0 - 180.0
    cols = np.where((lons >= W - 1e-9) & (lons <= E + 1e-9))[0]
    order = np.argsort(lons[cols])
    cols = cols[order]
    return field[j0:j1 + 1][:, cols], (N, lons[cols][0], -dlat, dlon, j1 - j0 + 1, len(cols))


def ellrod_ti1(u_lo, v_lo, u_hi, v_hi, z_lo, z_hi, u, v, lat_deg, dlat, dlon):
    """TI1 (s^-2) à un niveau : VWS entre les niveaux encadrants × DEF au niveau."""
    dz = np.maximum(z_hi - z_lo, 1.0)
    vws = np.hypot(u_hi - u_lo, v_hi - v_lo) / dz
    dy = R_EARTH * np.radians(abs(dlat))
    dx = R_EARTH * np.radians(dlon) * np.cos(np.radians(lat_deg))[:, None]
    dx = np.maximum(dx, 1.0)
    # Différences centrées ; axe 0 = latitude du nord au sud, donc d/dy = -d/dj.
    du_dx = np.gradient(u, axis=1) / dx
    dv_dx = np.gradient(v, axis=1) / dx
    du_dy = -np.gradient(u, axis=0) / dy
    dv_dy = -np.gradient(v, axis=0) / dy
    dsh = dv_dx + du_dy
    dst = du_dx - dv_dy
    return vws * np.hypot(dsh, dst)


def quantize_ti(ti):
    """TI1 (s^-2) -> un octet par point : ×1e7 ×16, tronqué au pas de 16,
    plafonné à 240, zéro sous BYTE_FLOOR. Tronqué : les seuils 64/128/192
    valent exactement TI1 ≥ 4, 8, 12 (×1e-7)."""
    q = np.floor(np.nan_to_num(ti, nan=0.0, posinf=0.0, neginf=0.0) * 1e7 * BYTE_PER_E7 / BYTE_STEP)
    q = np.clip(q, 0, 255 // BYTE_STEP) * BYTE_STEP
    b = q.astype(np.uint8)
    b[b < BYTE_FLOOR] = 0
    return b


def classify_bytes(val):
    """L'octet -> la classe 0..3, avec les seuils publiés dans l'index."""
    cls = np.zeros(val.shape, dtype=np.uint8)
    for k, lv in enumerate(BYTE_LEVELS):
        cls[val >= lv] = k + 1
    return cls


def apply_convective(val, cape, cprat, refc, fl):
    """Relève la valeur sous la convection du modèle, jusqu'à CAPE_MAX_FL :
    la nuance FORTE de light, de moderate, de severe (96, 160, 224).
    Le CAPE seul ne suffit pas : les tropiques en ont en permanence sans
    orage partout. On exige de la pluie convective instantanée (CPRAT), qui
    dit qu'une cellule existe bel et bien à cet endroit et cette heure."""
    if cape is None or fl > CAPE_MAX_FL:
        return val
    active = (cprat >= CPRAT_MIN) if cprat is not None else np.ones(cape.shape, dtype=bool)
    lift = np.zeros(val.shape, dtype=np.uint8)
    lift[active & (cape >= CAPE_LIGHT)] = CONV_BYTES[0]
    lift[active & (cape >= CAPE_MOD)] = CONV_BYTES[1]
    if refc is not None:
        lift[refc >= REFC_SEV] = CONV_BYTES[2]
    return np.maximum(val, lift)


def pool_max(val, n):
    """Regroupe n×n cases en gardant la pire valeur (bords incomplets ignorés)."""
    if n <= 1:
        return val
    h, w = (val.shape[0] // n) * n, (val.shape[1] // n) * n
    return val[:h, :w].reshape(h // n, n, w // n, n).max(axis=(1, 3))


def pool_grid(grid, n):
    """La grille de sortie après regroupement : centres des blocs, pas ×n."""
    if n <= 1:
        return grid
    N, lon0, dlat, dlon, nlat, nlon = grid
    return (N + dlat * (n - 1) / 2, lon0 + dlon * (n - 1) / 2, dlat * n, dlon * n, nlat // n, nlon // n)


# ------------------------------------------------------------------- PNG ---
# Un PNG 8 bits gris écrit à la main : pas de Pillow à installer, et le
# format est simple — une signature, IHDR, des tEXt, un IDAT zlib, IEND. Le
# filtre est choisi ligne par ligne parmi les cinq de la spécification
# (None, Sub, Up, Average, Paeth) par l'heuristique de libpng : la plus
# petite somme des octets filtrés vus comme signés. Ça compte : sur un
# champ lisse, Paeth ou Up divisent l'IDAT par deux.
def _paeth(a, b, c):
    a, b, c = a.astype(np.int16), b.astype(np.int16), c.astype(np.int16)
    p = a + b - c
    pa, pb, pc = np.abs(p - a), np.abs(p - b), np.abs(p - c)
    return np.where((pa <= pb) & (pa <= pc), a, np.where(pb <= pc, b, c))


def _chunk(tag, data):
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xffffffff)


def png_gray8(arr, text=None):
    """Tableau uint8 (h, w) -> octets d'un PNG gris 8 bits, avec des chunks
    tEXt {clé: valeur} (Latin-1) avant l'image."""
    a = np.ascontiguousarray(arr, dtype=np.uint8)
    h, w = a.shape
    prev = np.zeros(w, dtype=np.uint8)
    rows = []
    for y in range(h):
        cur = a[y]
        left = np.concatenate(([0], cur[:-1])).astype(np.uint8)
        upl = np.concatenate(([0], prev[:-1])).astype(np.uint8)
        c16 = cur.astype(np.int16)
        cands = (cur,
                 (c16 - left) & 255,
                 (c16 - prev) & 255,
                 (c16 - ((left.astype(np.int16) + prev) >> 1)) & 255,
                 (c16 - _paeth(left, prev, upl)) & 255)
        best = min(range(5), key=lambda k: int(np.abs(cands[k].astype(np.uint8).astype(np.int8)).sum()))
        rows.append(bytes((best,)) + cands[best].astype(np.uint8).tobytes())
        prev = cur
    out = [b"\x89PNG\r\n\x1a\n", _chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 0, 0, 0, 0))]
    for k, v in (text or {}).items():
        out.append(_chunk(b"tEXt", k.encode("latin-1") + b"\0" + v.encode("latin-1")))
    out.append(_chunk(b"IDAT", zlib.compress(b"".join(rows), 9)))
    out.append(_chunk(b"IEND", b""))
    return b"".join(out)


def png_read_gray8(data):
    """Le décodeur du même format, pour l'autotest (lent : boucle Python) :
    rend (tableau uint8, {clé: valeur} des tEXt)."""
    assert data[:8] == b"\x89PNG\r\n\x1a\n", "signature PNG"
    pos, idat, w, h, text = 8, [], 0, 0, {}
    while pos + 8 <= len(data):
        n, = struct.unpack(">I", data[pos:pos + 4]); tag = data[pos + 4:pos + 8]; body = data[pos + 8:pos + 8 + n]
        pos += 12 + n
        if tag == b"IHDR":
            w, h, depth, ctype = struct.unpack(">IIBB", body[:10])
            assert depth == 8 and ctype == 0, (depth, ctype)
        elif tag == b"IDAT":
            idat.append(body)
        elif tag == b"tEXt":
            k, v = body.split(b"\0", 1); text[k.decode("latin-1")] = v.decode("latin-1")
    raw = zlib.decompress(b"".join(idat))
    out = np.zeros((h, w), dtype=np.uint8)
    prev = [0] * w
    for y in range(h):
        f = raw[y * (w + 1)]; line = raw[y * (w + 1) + 1:(y + 1) * (w + 1)]
        cur = [0] * w
        for x in range(w):
            a = cur[x - 1] if x else 0; b = prev[x]; c = prev[x - 1] if x else 0
            if f == 0: pr = 0
            elif f == 1: pr = a
            elif f == 2: pr = b
            elif f == 3: pr = (a + b) >> 1
            else:
                p = a + b - c; pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if pa <= pb and pa <= pc else (b if pb <= pc else c)
            cur[x] = (line[x] + pr) & 255
        out[y] = cur; prev = cur
    return out, text


def build_hour(fields, bbox, pool=1):
    grid = fields["_grid"]
    sub = {}
    for k, v in fields.items():
        if k != "_grid":
            sub[k], out_grid = subset(v, grid, bbox)
    N, lon0, dlat, dlon, nlat, nlon = out_grid
    lats = N + np.arange(nlat) * dlat
    cape, cprat, refc = sub.get(("CAPE", "sfc")), sub.get(("CPRAT", "sfc")), sub.get(("REFC", "sfc"))
    levels = sorted(LEVELS, reverse=True)           # 800 … 100 : de bas en haut
    result = {}
    for fl, p in FL_TO_HPA.items():
        i = levels.index(p)
        lo, hi = levels[max(i - 1, 0)], levels[min(i + 1, len(levels) - 1)]
        ti = ellrod_ti1(sub[("UGRD", lo)], sub[("VGRD", lo)], sub[("UGRD", hi)], sub[("VGRD", hi)],
                        sub[("HGT", lo)], sub[("HGT", hi)], sub[("UGRD", p)], sub[("VGRD", p)], lats, dlat, dlon)
        val = apply_convective(quantize_ti(ti), cape, cprat, refc, fl)
        # Au-delà de 85° de latitude, dx tend vers zéro et la déformation
        # explose : des bandes rouges autour du pôle qui ne disent rien. Rien
        # n'y vole à ces niveaux de toute façon.
        val[np.abs(lats) > POLE_LAT] = 0
        result[fl] = pool_max(val, pool)
    return result, pool_grid(out_grid, pool)


def latest_run(now, max_fh):
    """Dernier cycle dont l'échéance la plus lointaine demandée est déjà publiée."""
    cand = now.replace(minute=0, second=0, microsecond=0)
    cand = cand.replace(hour=(cand.hour // 6) * 6)
    for _ in range(6):
        try:
            for kind in GFS_FILES:
                http_get("%s/%s.idx" % (BUCKET, gfs_path(cand, max_fh, kind)), rng=(0, 64))
            return cand
        except Exception:
            cand -= dt.timedelta(hours=6)
    raise RuntimeError("aucun cycle GFS complet trouvé")


def write_out(out_dir, run, hours, grids, grid):
    N, lon0, dlat, dlon, nlat, nlon = grid
    index = {
        "run": run.strftime("%Y-%m-%dT%H:00Z"),
        "generated": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "hours": hours,
        "fls": sorted(FL_TO_HPA),
        "grid": {"lat0": N, "lon0": float(lon0), "dlat": dlat, "dlon": dlon, "nlat": nlat, "nlon": nlon},
        "source": "gfs-0p25-ellrod-ti1", "classes": ["nil", "light", "moderate", "severe"],
        "thresholds": {"ti1_e7": [TI_LIGHT, TI_MOD, TI_SEV], "cape": [CAPE_LIGHT, CAPE_MOD],
                       "cprat_min": CPRAT_MIN, "refc_sev": REFC_SEV},
        # Le format des fichiers : un PNG gris 8 bits par (FL, échéance), et
        # ce que vaut l'octet — le client lit ses seuils ICI, pas en dur.
        "files": "png",
        "encoding": {"type": "png8", "byte_per_e7": BYTE_PER_E7, "step": BYTE_STEP, "floor": BYTE_FLOOR,
                     "levels": list(BYTE_LEVELS), "conv": list(CONV_BYTES)},
    }
    os.makedirs(out_dir, exist_ok=True)
    for fh, per_fl in grids.items():
        valid = run + dt.timedelta(hours=fh)
        for fl, val in per_fl.items():
            d = os.path.join(out_dir, "FL%03d" % fl)
            os.makedirs(d, exist_ok=True)
            # La grille est répétée dans CHAQUE fichier (chunk tEXt « turb ») :
            # index et fichiers traversent un cache de bord qui ne les
            # rafraîchit pas ensemble, et le client doit pouvoir lire un
            # fichier sur sa propre grille.
            meta = {"run": index["run"], "valid": valid.strftime("%Y-%m-%dT%H:00Z"), "fl": fl, "hour": fh,
                    "grid": index["grid"], "levels": list(BYTE_LEVELS)}
            with open(os.path.join(d, "h%03d.png" % fh), "wb") as f:
                f.write(png_gray8(val, {"turb": json.dumps(meta, separators=(",", ":"))}))
    # L'index s'écrit EN DERNIER : un client qui le lit trouve toutes les heures.
    with open(os.path.join(out_dir, "index.json"), "w") as f:
        json.dump(index, f, separators=(",", ":"))


def parse_hours(s):
    if "-" in s:
        a, b = s.split("-")
        return list(range(int(a), int(b) + 1))
    return [int(x) for x in s.split(",")]


# ---------------------------------------------------------------- autotest ---
def selftest():
    """Un jet synthétique : cisaillement + déformation là où le vent tourne."""
    nlat, nlon = 40, 60
    lats = 60 - np.arange(nlat) * 0.25
    x = np.arange(nlon) * 0.25
    u_p = np.zeros((nlat, nlon)) + 30.0
    u_p[:, 25:35] = np.linspace(30, 90, 10)              # accélération brutale → déformation
    v_p = np.zeros_like(u_p)
    u_lo = u_p * 0.5; u_hi = u_p * 1.5                   # cisaillement vertical fort
    z_lo = np.full_like(u_p, 9000.0); z_hi = np.full_like(u_p, 11000.0)
    ti = ellrod_ti1(u_lo, v_p, u_hi, v_p, z_lo, z_hi, u_p, v_p, lats, -0.25, 0.25)
    val = quantize_ti(ti); cls = classify_bytes(val)
    assert cls[:, :20].max() == 0, "zone calme classée turbulente"
    assert cls[:, 25:35].max() >= 1, "zone de gradient non détectée"
    # La quantification : seuils exacts (tronqué, pas arrondi), pas de 16,
    # zéro sous light, plafond 240, NaN -> zéro.
    q = quantize_ti(np.array([0.0, 3.99e-7, 4.0e-7, 4.9e-7, 5.0e-7, 8.0e-7, 12.0e-7, 15.9e-7, 40e-7, np.nan]))
    assert q.tolist() == [0, 0, 64, 64, 80, 128, 192, 240, 240, 0], q.tolist()
    assert classify_bytes(q).tolist() == [0, 0, 1, 1, 1, 2, 3, 3, 3, 0]
    cape = np.zeros_like(u_p); cape[5, 5] = 2500; cape[6, 6] = 2500
    cprat = np.zeros_like(u_p); cprat[5, 5] = 1e-4                # il pleut en (5,5), pas en (6,6)
    refc = np.zeros_like(u_p); refc[7, 7] = 45.0
    c2 = apply_convective(val, cape, cprat, refc, 300)
    assert c2[5, 5] == 160 and classify_bytes(c2)[5, 5] == 2, "CAPE + pluie convective -> moderate (nuance forte)"
    assert c2[6, 6] == 0, "CAPE sans pluie convective -> rien"
    assert c2[7, 7] == 224 and classify_bytes(c2)[7, 7] == 3, "réflectivité 45 dBZ -> severe"
    assert apply_convective(val, cape, cprat, refc, 450)[5, 5] == 0, "au-dessus de FL390, rien"
    assert apply_convective(np.full_like(val, 200), cape, cprat, refc, 300)[5, 5] == 200, "un severe déjà là n'est pas abaissé"
    pooled = pool_max(np.array([[0, 64, 0], [128, 0, 192], [64, 64, 64]], dtype=np.uint8), 2)
    assert pooled.shape == (1, 1) and pooled[0, 0] == 128, pooled
    g2 = pool_grid((90.0, -180.0, -0.25, 0.25, 721, 1440), 2)
    assert g2 == (89.875, -179.875, -0.5, 0.5, 360, 720), g2
    # PNG : aller-retour exact sur du bruit (tous les filtres y passent), sur
    # un champ lisse, avec le texte ; et un fichier écrit vaut un fichier lu.
    rng = np.random.default_rng(7)
    noise = rng.integers(0, 256, size=(23, 37), dtype=np.uint8)
    back, text = png_read_gray8(png_gray8(noise, {"turb": '{"a":1}', "k": "v"}))
    assert np.array_equal(back, noise) and text == {"turb": '{"a":1}', "k": "v"}, "PNG bruit"
    yy, xx = np.mgrid[0:40, 0:60]
    smooth = ((np.sin(xx / 5.0) + np.cos(yy / 7.0) + 2) * 60).astype(np.uint8)
    png = png_gray8(smooth)
    assert np.array_equal(png_read_gray8(png)[0], smooth), "PNG lisse"
    assert len(png) < smooth.size, "un champ lisse se compresse"
    # Les niveaux de pression lus dans le GRIB : LEVELS est la liste des hPa,
    # pas des octets — une collision de nom a déjà vidé le téléchargement
    # (2026-09-04, le run échouait en six secondes, sans un seul vent).
    assert 250 in LEVELS and 700 in LEVELS and 64 not in LEVELS, LEVELS
    # Les quarts de niveau viennent du pgrb2b : lus, et chaque FL a bien son hPa dans LEVELS.
    assert all(p in LEVELS for p in FL_TO_HPA.values()) and {275, 225, 175} <= set(LEVELS), LEVELS
    assert FL_TO_HPA[320] == 275 and FL_TO_HPA[360] == 225 and FL_TO_HPA[410] == 175
    assert gfs_path(dt.datetime(2026, 9, 4, 0), 6, "pgrb2b") == "gfs.20260904/00/atmos/gfs.t00z.pgrb2b.0p25.f006"
    assert wanted("UGRD", "250 mb") and wanted("HGT", "700 mb") and wanted("VGRD", "225 mb") and not wanted("TMP", "250 mb") and not wanted("UGRD", "925 mb")
    assert wanted("CAPE", "surface", "3 hour fcst") and not wanted("CAPE", "surface", "0-3 hour ave fcst")
    # build_hour sur des champs synthétiques, comme les rend fetch_fields :
    # chaque FL sort, à la taille de la boîte, en octets.
    nj, ni = 41, 80
    fields = {"_grid": (90.0, 0.0, 0.25, 0.25, nj, ni)}
    for p in LEVELS:
        fields[("UGRD", p)] = np.full((nj, ni), 20.0 + p / 50.0)
        fields[("VGRD", p)] = np.zeros((nj, ni))
        fields[("HGT", p)] = np.full((nj, ni), 16000.0 - 15.0 * p)
    for v in ("CAPE", "CPRAT", "REFC"):
        fields[(v, "sfc")] = np.zeros((nj, ni))
    res, g = build_hour(fields, (0.0, 80.0, 19.75, 90.0), 1)
    assert sorted(res) == sorted(FL_TO_HPA), sorted(res)
    assert all(v.shape == (g[4], g[5]) == (41, 80) and v.dtype == np.uint8 for v in res.values()), (g, {k: v.shape for k, v in res.items()})
    # Sous-grille : lon 0→359.75 découpée sur -10..10 doit ressortir triée d'ouest en est.
    world = np.tile(np.arange(1440, dtype=float), (721, 1))
    sub, g = subset(world, (90.0, 0.0, 0.25, 0.25, 721, 1440), (-10, 40, 10, 50))
    assert g[1] == -10.0 and sub.shape == (41, 81) and sub[0, 0] == 1400 and sub[0, -1] == 40, (g, sub.shape)
    print("selftest OK")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default="turb")
    ap.add_argument("--hours", default="3-36", help="échéances GFS, ex. 3-36 ou 6,12,24")
    ap.add_argument("--run", help="cycle YYYYMMDDHH ; sinon le dernier complet")
    ap.add_argument("--bbox", default=",".join(str(x) for x in DEFAULT_BBOX), help="W,S,E,N")
    ap.add_argument("--pool", type=int, default=1, help="regroupe n×n cases en gardant la pire valeur (2 -> 0,5°)")
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--fixture", help="écrit un PNG déterministe (37×23, pixel = (7x + 13y) mod 256) pour test/turb-grid.test.mjs")
    a = ap.parse_args()
    if a.selftest:
        return selftest()
    if a.fixture:
        yy, xx = np.mgrid[0:23, 0:37]
        meta = {"fixture": 1, "grid": {"lat0": 50.0, "lon0": -10.0, "dlat": -0.25, "dlon": 0.25, "nlat": 23, "nlon": 37}}
        with open(a.fixture, "wb") as f:
            f.write(png_gray8(((7 * xx + 13 * yy) % 256).astype(np.uint8), {"turb": json.dumps(meta, separators=(",", ":"))}))
        return print("fixture écrite dans", a.fixture, file=sys.stderr)
    hours = parse_hours(a.hours)
    bbox = tuple(float(x) for x in a.bbox.split(","))
    run = (dt.datetime.strptime(a.run, "%Y%m%d%H").replace(tzinfo=dt.timezone.utc) if a.run
           else latest_run(dt.datetime.now(dt.timezone.utc), max(hours)))
    print("cycle", run.strftime("%Y-%m-%d %HZ"), "échéances", hours, file=sys.stderr)
    grids, grid = {}, None
    for fh in hours:
        fields = fetch_fields(run, fh)
        grids[fh], grid = build_hour(fields, bbox, a.pool)
        print("  f%03d ok" % fh, file=sys.stderr)
    write_out(a.out, run, hours, grids, grid)
    print("écrit dans", a.out, file=sys.stderr)


if __name__ == "__main__":
    main()
