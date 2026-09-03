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
classe là où le modèle FAIT de la convection (pluie convective instantanée
CPRAT > 0) selon l'énergie disponible (CAPE), et sous les cellules que sa
réflectivité simulée (REFC) donne pour violentes.

Maille : calcul à 0,25° (celle du GFS), puis, avec --pool 2, regroupement
2×2 en gardant la PIRE classe — 0,5°, quatre fois moins lourd, et un monde
entier tient en ~20 Ko gzippés par fichier.

Sortie (arborescence statique, à servir telle quelle sous /api/turb/) :
  OUT/index.json               run, échéances, niveaux, description de la grille
  OUT/FL340/h006.json          une classe 0..3 par point, en RLE ligne par ligne

Lancer :  python3 tools/turb/build_turb.py --out /var/turb --hours 3-36 --bbox=-180,-90,180,90 --pool 2
          python3 tools/turb/build_turb.py --selftest      (aucun réseau)
Dépendances : numpy, eccodes (pip install numpy eccodes).
"""
import argparse, datetime as dt, json, os, re, sys, urllib.request

import numpy as np

BUCKET = "https://noaa-gfs-bdp-pds.s3.amazonaws.com"
# Niveau de vol -> niveau de pression GFS le plus proche (atmosphère standard).
FL_TO_HPA = {100: 700, 140: 600, 180: 500, 240: 400, 270: 350, 300: 300, 340: 250, 390: 200, 450: 150}
# Tous les niveaux à lire : ceux des FL plus un voisin dessus et dessous pour
# le cisaillement vertical centré aux deux extrémités.
LEVELS = [800, 700, 600, 500, 400, 350, 300, 250, 200, 150, 100]
# Grille de sortie par défaut : le monde, du nord au sud, de l'ouest à l'est.
DEFAULT_BBOX = (-180.0, -90.0, 180.0, 90.0)       # W, S, E, N
R_EARTH = 6371000.0
# Seuils Ellrod (×1e-7 s^-2) et masque convectif : CAPE (J/kg) là où il pleut
# de la convection (CPRAT, kg/m²/s > 0), réflectivité simulée (REFC, dBZ).
TI_LIGHT, TI_MOD, TI_SEV = 4.0, 8.0, 12.0
CAPE_LIGHT, CAPE_MOD = 1000.0, 2000.0
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


def gfs_path(run, fh):
    return "gfs.%s/%02d/atmos/gfs.t%02dz.pgrb2.0p25.f%03d" % (run.strftime("%Y%m%d"), run.hour, run.hour, fh)


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
    """Télécharge par Range les seuls messages utiles et les décode avec eccodes."""
    import eccodes
    base = "%s/%s" % (BUCKET, gfs_path(run, fh))
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


def classify_ti(ti):
    t = ti * 1e7
    cls = np.zeros(t.shape, dtype=np.uint8)
    cls[t >= TI_LIGHT] = 1
    cls[t >= TI_MOD] = 2
    cls[t >= TI_SEV] = 3
    return cls


def apply_convective(cls, cape, cprat, refc, fl):
    """Relève la classe sous la convection du modèle, jusqu'à CAPE_MAX_FL.
    Le CAPE seul ne suffit pas : les tropiques en ont en permanence sans
    orage partout. On exige de la pluie convective instantanée (CPRAT), qui
    dit qu'une cellule existe bel et bien à cet endroit et cette heure."""
    if cape is None or fl > CAPE_MAX_FL:
        return cls
    out = cls.copy()
    active = (cprat >= CPRAT_MIN) if cprat is not None else np.ones(cape.shape, dtype=bool)
    out[active & (cape >= CAPE_LIGHT) & (out < 1)] = 1
    out[active & (cape >= CAPE_MOD) & (out < 2)] = 2
    if refc is not None:
        out[(refc >= REFC_SEV) & (out < 3)] = 3
    return out


def pool_max(cls, n):
    """Regroupe n×n cases en gardant la pire classe (bords incomplets ignorés)."""
    if n <= 1:
        return cls
    h, w = (cls.shape[0] // n) * n, (cls.shape[1] // n) * n
    return cls[:h, :w].reshape(h // n, n, w // n, n).max(axis=(1, 3))


def pool_grid(grid, n):
    """La grille de sortie après regroupement : centres des blocs, pas ×n."""
    if n <= 1:
        return grid
    N, lon0, dlat, dlon, nlat, nlon = grid
    return (N + dlat * (n - 1) / 2, lon0 + dlon * (n - 1) / 2, dlat * n, dlon * n, nlat // n, nlon // n)


def rle(cls):
    """Classes ligne par ligne, du nord au sud : [cls, longueur, cls, longueur, …]."""
    flat = cls.ravel()
    out = []
    if flat.size == 0:
        return out
    edges = np.flatnonzero(np.diff(flat)) + 1
    starts = np.concatenate(([0], edges))
    ends = np.concatenate((edges, [flat.size]))
    for s, e in zip(starts, ends):
        out.append(int(flat[s])); out.append(int(e - s))
    return out


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
        cls = apply_convective(classify_ti(ti), cape, cprat, refc, fl)
        # Au-delà de 85° de latitude, dx tend vers zéro et la déformation
        # explose : des bandes rouges autour du pôle qui ne disent rien. Rien
        # n'y vole à ces niveaux de toute façon.
        cls[np.abs(lats) > POLE_LAT] = 0
        result[fl] = pool_max(cls, pool)
    return result, pool_grid(out_grid, pool)


def latest_run(now, max_fh):
    """Dernier cycle dont l'échéance la plus lointaine demandée est déjà publiée."""
    cand = now.replace(minute=0, second=0, microsecond=0)
    cand = cand.replace(hour=(cand.hour // 6) * 6)
    for _ in range(6):
        try:
            http_get("%s/%s.idx" % (BUCKET, gfs_path(cand, max_fh)), rng=(0, 64))
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
    }
    os.makedirs(out_dir, exist_ok=True)
    for fh, per_fl in grids.items():
        valid = run + dt.timedelta(hours=fh)
        for fl, cls in per_fl.items():
            d = os.path.join(out_dir, "FL%03d" % fl)
            os.makedirs(d, exist_ok=True)
            with open(os.path.join(d, "h%03d.json" % fh), "w") as f:
                # La grille est répétée dans CHAQUE fichier : index et fichiers
                # traversent un cache de bord qui ne les rafraîchit pas ensemble,
                # et le client doit pouvoir lire un fichier sur sa propre grille.
                json.dump({"run": index["run"], "valid": valid.strftime("%Y-%m-%dT%H:00Z"), "fl": fl,
                           "hour": fh, "nlat": nlat, "nlon": nlon, "grid": index["grid"],
                           "rle": rle(cls)}, f, separators=(",", ":"))
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
    cls = classify_ti(ti)
    assert cls[:, :20].max() == 0, "zone calme classée turbulente"
    assert cls[:, 25:35].max() >= 1, "zone de gradient non détectée"
    cape = np.zeros_like(u_p); cape[5, 5] = 2500; cape[6, 6] = 2500
    cprat = np.zeros_like(u_p); cprat[5, 5] = 1e-4                # il pleut en (5,5), pas en (6,6)
    refc = np.zeros_like(u_p); refc[7, 7] = 45.0
    c2 = apply_convective(cls, cape, cprat, refc, 300)
    assert c2[5, 5] == 2, "CAPE + pluie convective -> moderate"
    assert c2[6, 6] == 0, "CAPE sans pluie convective -> rien"
    assert c2[7, 7] == 3, "réflectivité 45 dBZ -> severe"
    assert apply_convective(cls, cape, cprat, refc, 450)[5, 5] == 0, "au-dessus de FL390, rien"
    pooled = pool_max(np.array([[0, 1, 0], [2, 0, 3], [1, 1, 1]], dtype=np.uint8), 2)
    assert pooled.shape == (1, 1) and pooled[0, 0] == 2, pooled
    g2 = pool_grid((90.0, -180.0, -0.25, 0.25, 721, 1440), 2)
    assert g2 == (89.875, -179.875, -0.5, 0.5, 360, 720), g2
    r = rle(np.array([[0, 0, 1, 1, 1], [2, 0, 0, 0, 0]], dtype=np.uint8))
    assert r == [0, 2, 1, 3, 2, 1, 0, 4], r
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
    ap.add_argument("--pool", type=int, default=1, help="regroupe n×n cases en gardant la pire classe (2 -> 0,5°)")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        return selftest()
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
