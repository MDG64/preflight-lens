#!/usr/bin/env python3
"""
Zones de turbulence par niveau de vol, calculées depuis les vents du GFS 0,25°.

Pourquoi recalculer : les grilles WAFS de turbulence (EDR) ne sont plus en
accès libre (NCEP SCN 22-104 : retirées de NOMADS, servies par WIFS/SADIS sur
inscription). Les vents du GFS, eux, sont publics sur AWS Open Data, avec un
index .idx qui permet de ne télécharger que les champs utiles par Range HTTP.

Indice : Ellrod TI1 = cisaillement vertical × déformation horizontale
(Ellrod & Knapp 1992), converti en EDR (eddy dissipation rate, m^2/3 s^-1,
l'unité OACI de la turbulence) par la calibration log-normale du GTG
(Sharman & Pearson 2017, reprise par le GTG mondial du WAFS) :
    ln(EDR) = C1 + C2 · (ln TI1 − <ln TI1>) / SD(ln TI1)
C1 = −2,953 et C2 = 0,602 sont la moyenne et l'écart-type climatologiques
de ln(EDR) mesurés in situ par les compagnies américaines au-dessus de
20 000 ft ; <ln TI1> et SD(ln TI1) sont la climatologie de NOTRE
diagnostic, sur cette grille, mesurée sur des cycles GFS réels (voir
TI_LN_UPPER). Pourquoi : les seuils Ellrod de 1992 (4/8/12 × 10^-7 s^-2)
ont été établis sur un modèle à ~80 km ; à 0,25° les dérivées sont bien
plus fortes, et ces seuils mettaient 25 % du couloir 20–70°N en light ou
plus, 9,6 % en moderate, 4,5 % en severe (mesuré le 2026-09-05), là où la
climatologie EDR donne 4 %, 0,8 % et 0,1 %. L'ancien « severe » (12 × 10^-7)
vaut un EDR de 0,16 : à peine light. La calibration remet la distribution
à sa place ; la physique (OÙ ça bouge) reste celle de l'indice.
C'est un indice d'AIR CLAIR. Ce qui secoue en dehors de l'air clair est
ajouté par-dessus, depuis le 2026-09-05, à partir de la COLONNE CONVECTIVE
du modèle : le GFS donne la pression de la base et du sommet de son nuage
convectif, et sa couverture. On demande donc « le niveau est-il DEDANS »,
à toute altitude, au lieu de deviner depuis le sol — c'est la question que
pose un pilote qui traverse une couche de cumulus en montée. Trois degrés
(cumulus, fort, violent) et un poste d'EDR fixe par degré : la calibration
log-normale vaut pour l'air clair en croisière, pas pour l'intérieur d'un
cumulonimbus, et on annonce donc une classe, pas une mesure. Les
thermiques s'y ajoutent sous une couche limite franchement convective
(HPBL ≥ 3 000 ft).

Deux niveaux BAS sont publiés en plus, FL030 et FL050, qui ne portent
aucun indice d'air clair : à ces altitudes le cisaillement de croisière
n'est pas le sujet, et un modèle à 25 km ne résout ni le relief ni la
couche de frottement. Leur valeur vient de la convection et de la couche
limite, et de rien d'autre.

Ce qui est publié est la VALEUR, en un octet : EDR × 100 tronqué (15 vaut
exactement EDR ≥ 0,15), plafonné à 255, mis à zéro sous 0,10 (le calme ne
pèse alors rien dans le PNG). Seuils d'un avion moyen (Sharman & Pearson
2017) : light 15, moderate 22, severe 34 — publiés dans l'index, le client
ne les code pas en dur ; le relèvement convectif pose la nuance FORTE de sa
classe (18, 28, 45). Le client lit la classe avec ces seuils et peint la
nappe en interpolant la valeur entre les points ; la page Turbulence trace
la courbe EDR du vol.

Maille : celle du GFS, 0,25° — le monde entier tient dans un PNG 8 bits
gris (les filtres PNG et zlib font mieux que du RLE : le calme est à zéro
sur la plus grande part du globe). --pool n regroupe encore n×n points en
gardant la pire valeur si un jour il faut alléger.

Sortie (arborescence statique, à servir telle quelle sous /api/turb/) :
  OUT/index.json               run, échéances, niveaux, grille, encodage
  OUT/FL340/h006.png           un octet par point, du nord au sud, de l'ouest
                               à l'est ; sa grille dans un chunk tEXt « turb »
  OUT/CONV/h006.png            la colonne convective, une fois par échéance et
                               valable à TOUS les niveaux : base, sommet et
                               vigueur EMPILÉS dans la même image (trois plans
                               de la hauteur de la grille). C'est elle qui dit
                               la NATURE de ce qui secoue, là où la grille ne
                               donne qu'une valeur.

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
# Calibration log-normale TI1 -> EDR (Sharman & Pearson 2017) : C1, C2 = moyenne
# et écart-type climatologiques de ln(EDR) in situ au-dessus de 20 000 ft.
EDR_C1, EDR_C2 = -2.953, 0.602
# Climatologie de ln(TI1) sur CETTE grille (0,25°, différences centrées),
# pondérée par cos(lat), |lat| ≤ 85°, mesurée le 2026-09-05 sur quatre cycles
# (03/09 06Z f024, 04/09 12Z f012, 05/09 00Z f012 et f030) — d'un cycle à
# l'autre la moyenne bouge de ±0,02 et l'écart-type de ±0,012 :
#   FL240–FL450 : −15,82 / 1,169      FL100–FL180 : −16,52 / 1,261
# Des constantes, pas la statistique du cycle courant : normaliser chaque
# run effacerait la différence entre un jour calme et un jour agité.
TI_LN_UPPER, TI_LN_MID, MID_MAX_FL = (-15.82, 1.169), (-16.52, 1.261), 180
# Seuils EDR (m^2/3 s^-1) d'un avion moyen (A320/B737) : light, moderate, severe.
EDR_LEVELS = (0.15, 0.22, 0.34)
# --- Convection : la colonne du modèle, et ce qu'on en tire ------------------
# Trois degrés :
#   1 cumulus  — le nuage convectif existe et COUVRE franchement (TCDC ≥ 50 %).
#                C'est le chahut ordinaire de la traversée d'une couche de cumulus.
#   2 fort     — réflectivité ≥ 30 dBZ (le modèle y fait de la précipitation)
#                ou CAPE mixte ≥ 2 000 J/kg (cellule vigoureuse pas encore
#                pluvieuse) : le towering cumulus.
#   3 violent  — réflectivité ≥ 40 dBZ : le cumulonimbus, qu'on contourne.
# Les seuils ont été CHOISIS PAR MESURE (cycle 00Z du 2026-09-05, échéance
# 12 h, part du globe pondérée par cos(lat)), pour éclairer la montée sans
# noyer la croisière, où la calibration EDR est validée :
#   FL050 : cumulus 4,2 %  fort 0,89 %  violent 0,037 %
#   FL340 : cumulus 2,9 %  fort 0,45 %  violent 0,013 %
# Un premier jeu plus large (TCDC ≥ 20, CAPE ≥ 1 000) allumait 2,8 % de fort au
# FL340 à lui seul et faisait DOUBLER le moderate de croisière : le CAPE est
# une propriété de la COLONNE (l'instabilité vue du sol), pas du point où l'on
# vole, alors que la réflectivité dit qu'il y a des gouttes ici et maintenant.
# L'EDR posé par chaque degré est un POSTE FIXE, pas une valeur calibrée : la
# correspondance log-normale vaut pour l'air clair en croisière, pas pour
# l'intérieur d'un cumulonimbus. On annonce une classe, pas une mesure.
CONV_TCDC, CONV_CAPE, CONV_REFC_FORT, CONV_REFC_VIOLENT = 50.0, 2000.0, 30.0, 40.0
# Thermiques : sous le sommet de la couche limite, quand elle est franchement
# convective (≥ 3 000 ft, 28 % du globe), la montée est hachée. Light, pas plus.
PBL_MIN_FT = 3000.0
# L'octet publié : EDR × BYTE_PER_EDR tronqué, plafonné à 255, zéro sous
# BYTE_FLOOR. Les seuils de classe en octets (BYTE_LEVELS — pas LEVELS, qui
# sont les hPa lus dans le GRIB) et la nuance forte que pose le relèvement
# convectif (EDR 0,18 / 0,28 / 0,45).
BYTE_PER_EDR, BYTE_FLOOR = 100, 10
BYTE_LEVELS = tuple(int(round(l * BYTE_PER_EDR)) for l in EDR_LEVELS)     # 15, 22, 34
CONV_BYTES = (18, 28, 45)                          # cumulus, fort, violent (EDR 0,18 / 0,28 / 0,45)
PBL_BYTE = 16                                      # thermiques : light franc, EDR 0,16
# Niveaux publiés SOUS le FL100. Il n'y a pas d'indice d'air clair pour eux :
# à ces altitudes le cisaillement de croisière n'est pas le sujet, et un modèle
# à 25 km ne résout ni le relief ni la couche de frottement. Leur valeur vient
# de la convection et de la couche limite, et de rien d'autre — c'est dit dans
# l'index (`source` du niveau).
FL_LOW = (30, 50)
# La colonne publiée : base et sommet par pas de 500 ft (la précision d'un
# modèle à 25 km, et 255 × 500 ft = FL1275, largement au-dessus de tout).
CONV_FT_STEP = 500.0
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
# Champs 2D. La COLONNE CONVECTIVE d'abord : le modèle donne la pression de la
# base et du sommet de son nuage convectif, et sa couverture — de quoi demander
# « mon niveau est-il DANS le nuage », à toute altitude, au lieu de deviner
# depuis le sol. CAPE mixte (180-0 mb) et réflectivité simulée donnent la
# vigueur ; HPBL la hauteur de la couche limite, d'où viennent les thermiques
# qui secouent la montée. CPRAT et le CAPE de surface ont été retirés le
# 2026-09-05 : la colonne dit mieux, et pour le même prix.
SURFACE_FIELDS = {("PRES", "convective cloud bottom level"), ("PRES", "convective cloud top level"),
                  ("TCDC", "convective cloud layer"), ("CAPE", "180-0 mb above ground"),
                  ("REFC", "entire atmosphere"), ("HPBL", "surface")}
# La clé courte de chaque champ 2D dans le dictionnaire des champs.
SURFACE_KEY = {("PRES", "convective cloud bottom level"): ("PRES", "ccb"),
               ("PRES", "convective cloud top level"): ("PRES", "cct"),
               ("TCDC", "convective cloud layer"): ("TCDC", "ccc"),
               ("CAPE", "180-0 mb above ground"): ("CAPE", "cape"),
               ("REFC", "entire atmosphere"): ("REFC", "sfc"),
               ("HPBL", "surface"): ("HPBL", "sfc")}


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
            # Un niveau de pression garde sa clé (var, hPa) ; un champ 2D prend
            # sa clé courte — deux champs PRES cohabitent (base et sommet du
            # nuage), « sfc » ne les distinguerait pas.
            key = (var, int(level.split()[0])) if level.endswith(" mb") else SURFACE_KEY.get((var, level), (var, "sfc"))
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


def edr_of(ti, fl):
    """TI1 (s^-2) -> EDR (m^2/3 s^-1) par la calibration log-normale : la
    distribution de ln(TI1) sur la grille est ramenée sur celle de ln(EDR)
    in situ. Un TI1 nul (pas de déformation) vaut un calme profond."""
    mean, sd = TI_LN_MID if fl <= MID_MAX_FL else TI_LN_UPPER
    ln = np.log(np.maximum(np.nan_to_num(ti, nan=0.0, posinf=0.0, neginf=0.0), 1e-12))
    return np.exp(EDR_C1 + EDR_C2 * (ln - mean) / sd)


def quantize_edr(edr):
    """EDR -> un octet par point : × 100 tronqué (15 vaut exactement EDR ≥ 0,15),
    plafonné à 255, zéro sous BYTE_FLOOR."""
    q = np.floor(np.nan_to_num(edr, nan=0.0, posinf=0.0, neginf=0.0) * BYTE_PER_EDR)
    b = np.clip(q, 0, 255).astype(np.uint8)
    b[b < BYTE_FLOOR] = 0
    return b


def classify_bytes(val):
    """L'octet -> la classe 0..3, avec les seuils publiés dans l'index."""
    cls = np.zeros(val.shape, dtype=np.uint8)
    for k, lv in enumerate(BYTE_LEVELS):
        cls[val >= lv] = k + 1
    return cls


def pres_to_ft(pa):
    """Pression (Pa) -> altitude de l'atmosphère standard (ft). La base et le
    sommet du nuage convectif sont donnés en pression ; le vol, lui, se
    raisonne en pieds. Un point sans nuage vaut NaN dans le GRIB : il ressort
    à zéro, et le masque `actif` l'écarte de toute façon."""
    p = np.maximum(np.nan_to_num(pa, nan=101325.0, posinf=101325.0, neginf=101325.0), 100.0)
    return 145366.45 * (1 - (p / 101325.0) ** 0.190284)


def conv_column(sub):
    """La colonne convective du modèle : (base_ft, sommet_ft, vigueur 0..3).
    Vigueur : 1 le nuage existe et couvre, 2 il est fort (énergie ou pluie
    vue au radar simulé), 3 c'est une cellule violente. En dehors du nuage,
    tout est à zéro — base et sommet compris, c'est le drapeau d'absence."""
    ccb, cct = sub.get(("PRES", "ccb")), sub.get(("PRES", "cct"))
    if ccb is None or cct is None:
        z = np.zeros(sub[("REFC", "sfc")].shape if ("REFC", "sfc") in sub else (1, 1), dtype=np.float64)
        return z, z.copy(), np.zeros(z.shape, dtype=np.uint8)
    base_ft, top_ft = pres_to_ft(ccb), pres_to_ft(cct)
    # Une colonne existe si les deux pressions sont là et si la base est bien
    # SOUS le sommet (pression plus forte). Le GFS met des valeurs manquantes
    # partout ailleurs.
    actif = np.isfinite(ccb) & np.isfinite(cct) & (ccb > cct) & (ccb > 0) & (top_ft > base_ft)
    ccc = sub.get(("TCDC", "ccc"))
    cape = sub.get(("CAPE", "cape"))
    refc = sub.get(("REFC", "sfc"))
    vig = np.zeros(base_ft.shape, dtype=np.uint8)
    couvre = actif if ccc is None else (actif & (ccc >= CONV_TCDC))
    vig[couvre] = 1
    fort = np.zeros(base_ft.shape, dtype=bool)
    if cape is not None:
        fort |= cape >= CONV_CAPE
    if refc is not None:
        fort |= refc >= CONV_REFC_FORT
    vig[actif & fort] = 2
    if refc is not None:
        vig[actif & (refc >= CONV_REFC_VIOLENT)] = 3
    base_ft = np.where(actif, base_ft, 0.0)
    top_ft = np.where(actif, top_ft, 0.0)
    vig[~actif] = 0
    return base_ft, top_ft, vig


def apply_convective(val, conv, hpbl_ft, fl):
    """Relève la valeur d'un niveau par ce qui le secoue en dehors de l'air
    clair : le nuage convectif quand le niveau est DEDANS (entre base et
    sommet, degré par degré), et les thermiques quand il est sous une couche
    limite franchement convective. Chaque relèvement est un poste fixe, et
    c'est le plus fort qui l'emporte — jamais une somme."""
    base_ft, top_ft, vig = conv
    h = fl * 100.0
    dedans = (vig > 0) & (h >= base_ft) & (h <= top_ft)
    lift = np.zeros(val.shape, dtype=np.uint8)
    for k in (1, 2, 3):
        lift[dedans & (vig == k)] = CONV_BYTES[k - 1]
    if hpbl_ft is not None:
        lift = np.maximum(lift, np.where((hpbl_ft >= PBL_MIN_FT) & (h <= hpbl_ft), PBL_BYTE, 0).astype(np.uint8))
    return np.maximum(val, lift)


def pool_max(val, n):
    """Regroupe n×n cases en gardant la pire valeur (bords incomplets ignorés)."""
    if n <= 1:
        return val
    h, w = (val.shape[0] // n) * n, (val.shape[1] // n) * n
    return val[:h, :w].reshape(h // n, n, w // n, n).max(axis=(1, 3))


def pool_max_f(val, n):
    """Le même regroupement, sur des flottants (base et sommet en pieds)."""
    return pool_max(val, n)


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
    levels = sorted(LEVELS, reverse=True)           # 800 … 100 : de bas en haut
    conv = conv_column(sub)
    hpbl = sub.get(("HPBL", "sfc"))
    hpbl_ft = None if hpbl is None else np.nan_to_num(hpbl, nan=0.0) * 3.280839895
    result = {}
    for fl, p in FL_TO_HPA.items():
        i = levels.index(p)
        lo, hi = levels[max(i - 1, 0)], levels[min(i + 1, len(levels) - 1)]
        ti = ellrod_ti1(sub[("UGRD", lo)], sub[("VGRD", lo)], sub[("UGRD", hi)], sub[("VGRD", hi)],
                        sub[("HGT", lo)], sub[("HGT", hi)], sub[("UGRD", p)], sub[("VGRD", p)], lats, dlat, dlon)
        val = apply_convective(quantize_edr(edr_of(ti, fl)), conv, hpbl_ft, fl)
        # Au-delà de 85° de latitude, dx tend vers zéro et la déformation
        # explose : des bandes rouges autour du pôle qui ne disent rien. Rien
        # n'y vole à ces niveaux de toute façon.
        val[np.abs(lats) > POLE_LAT] = 0
        result[fl] = pool_max(val, pool)
    # Les niveaux bas : ni Ellrod ni pôle à écarter, seulement ce qui secoue
    # vraiment une montée — le nuage et les thermiques.
    for fl in FL_LOW:
        result[fl] = pool_max(apply_convective(np.zeros((nlat, nlon), dtype=np.uint8), conv, hpbl_ft, fl), pool)
    # La colonne convective est publiée telle quelle, une fois par échéance :
    # elle vaut pour TOUS les niveaux, et c'est elle qui dit la NATURE de ce
    # qui secoue — base, sommet, degré — là où la grille ne donne qu'une valeur.
    base_ft, top_ft, vig = conv
    col = (np.clip(np.round(pool_max_f(base_ft, pool) / CONV_FT_STEP), 0, 255).astype(np.uint8),
           np.clip(np.round(pool_max_f(top_ft, pool) / CONV_FT_STEP), 0, 255).astype(np.uint8),
           pool_max(vig, pool))
    return result, pool_grid(out_grid, pool), col


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


def write_out(out_dir, run, hours, grids, grid, cols=None):
    N, lon0, dlat, dlon, nlat, nlon = grid
    index = {
        "run": run.strftime("%Y-%m-%dT%H:00Z"),
        "generated": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "hours": hours,
        "fls": sorted(list(FL_TO_HPA) + list(FL_LOW)),
        # Les niveaux SOUS le FL100 ne portent pas d'indice d'air clair : le
        # client doit pouvoir le dire au pilote au lieu de laisser croire à une
        # mesure complète.
        "fls_low": sorted(FL_LOW),
        "grid": {"lat0": N, "lon0": float(lon0), "dlat": dlat, "dlon": dlon, "nlat": nlat, "nlon": nlon},
        "source": "gfs-0p25-ellrod-ti1-edr", "classes": ["nil", "light", "moderate", "severe"],
        "thresholds": {"edr": list(EDR_LEVELS), "aircraft": "medium",
                       "conv": {"tcdc": CONV_TCDC, "cape": CONV_CAPE,
                                "refc_strong": CONV_REFC_FORT, "refc_violent": CONV_REFC_VIOLENT},
                       "pbl_min_ft": PBL_MIN_FT},
        # La colonne convective : un fichier par échéance, valable à TOUS les
        # niveaux. Trois plans EMPILÉS dans la même image (base, sommet,
        # vigueur), chacun de la hauteur de la grille — une seule requête et un
        # seul décodage pour les trois.
        "conv": {"path": "CONV/h%03d.png", "planes": ["base", "top", "vigour"],
                 "ft_step": CONV_FT_STEP, "vigour": ["nil", "cumulus", "strong", "violent"],
                 "edr": [b / BYTE_PER_EDR for b in CONV_BYTES]} if cols else None,
        # Le format des fichiers : un PNG gris 8 bits par (FL, échéance), et
        # ce que vaut l'octet — EDR × 100 ; le client lit ses seuils ICI, pas
        # en dur, et la calibration est publiée pour être vérifiable.
        "files": "png",
        "encoding": {"type": "png8", "unit": "edr100", "per_edr": BYTE_PER_EDR, "step": 1, "floor": BYTE_FLOOR,
                     "levels": list(BYTE_LEVELS), "conv": list(CONV_BYTES),
                     "calib": {"method": "lognormal-remap", "ref": "Sharman & Pearson 2017, JAMC 56", "c1": EDR_C1, "c2": EDR_C2,
                               "ti1_ln_mean": {"upper": TI_LN_UPPER[0], "mid": TI_LN_MID[0]},
                               "ti1_ln_sd": {"upper": TI_LN_UPPER[1], "mid": TI_LN_MID[1]}, "mid_max_fl": MID_MAX_FL}},
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
    # La colonne convective, une image par échéance : base, sommet et vigueur
    # empilés verticalement, dans cet ordre.
    for fh, col in (cols or {}).items():
        valid = run + dt.timedelta(hours=fh)
        d = os.path.join(out_dir, "CONV")
        os.makedirs(d, exist_ok=True)
        meta = {"run": index["run"], "valid": valid.strftime("%Y-%m-%dT%H:00Z"), "hour": fh, "kind": "conv",
                "grid": index["grid"], "planes": ["base", "top", "vigour"], "ft_step": CONV_FT_STEP}
        with open(os.path.join(d, "h%03d.png" % fh), "wb") as f:
            f.write(png_gray8(np.vstack(col), {"turb": json.dumps(meta, separators=(",", ":"))}))
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
    val = quantize_edr(edr_of(ti, 340)); cls = classify_bytes(val)
    assert cls[:, :20].max() == 0, "zone calme classée turbulente"
    assert cls[:, 25:35].max() >= 1, "zone de gradient non détectée"
    # La calibration : monotone, et les seuils EDR tombent là où la
    # climatologie les met — light à TI1 ≈ 10,5 × 1e-7, moderate ≈ 22,
    # severe ≈ 51 (l'ancien « severe » de 1992, 12 × 1e-7, vaut EDR 0,16).
    e = edr_of(np.array([0.0, 1e-7, 4e-7, 1.05e-6, 1.2e-6, 2.2e-6, 5.1e-6, 4e-5, np.nan]), 340)
    assert all(np.diff(e[:-1]) > 0) and e[-1] < 0.01, e.tolist()
    assert abs(e[3] - 0.15) < 0.005 and abs(e[4] - 0.16) < 0.01 and abs(e[5] - 0.22) < 0.01 and abs(e[6] - 0.34) < 0.015, e.tolist()
    assert edr_of(np.array([4e-7]), 140) > edr_of(np.array([4e-7]), 240), "sous FL200 la climatologie du diagnostic est plus basse : même TI1, EDR plus fort"
    # La quantification : seuils exacts (tronqué, pas arrondi), zéro sous
    # 0,10, plafond 255, NaN -> zéro.
    q = quantize_edr(np.array([0.0, 0.099, 0.10, 0.149, 0.15, 0.2199, 0.22, 0.34, 2.9, np.nan]))
    assert q.tolist() == [0, 0, 10, 14, 15, 21, 22, 34, 255, 0], q.tolist()
    assert classify_bytes(q).tolist() == [0, 0, 0, 0, 1, 1, 2, 3, 3, 0]
    # --- la colonne convective ---
    # Quatre points : (5,5) un cumulus de 2 000 à 8 000 ft ; (6,6) le même mais
    # sans couverture (le modèle a un nuage, il ne couvre pas) ; (7,7) une
    # cellule violente de 1 500 ft à FL350 ; (8,8) pas de nuage du tout.
    # Pression standard : 2 000 ft ≈ 942 hPa, 8 000 ft ≈ 753 hPa, FL350 ≈ 238.
    P0 = 101325.0
    def pa(ft_):                                   # altitude standard -> Pa
        return P0 * (1 - ft_ / 145366.45) ** (1 / 0.190284)
    sh = u_p.shape
    ccb = np.full(sh, np.nan); cct = np.full(sh, np.nan)
    ccc = np.zeros(sh); cape = np.zeros(sh); refc = np.zeros(sh)
    ccb[5, 5], cct[5, 5], ccc[5, 5] = pa(2000), pa(8000), 60
    ccb[6, 6], cct[6, 6], ccc[6, 6] = pa(2000), pa(8000), 5      # nuage sans couverture
    ccb[7, 7], cct[7, 7], ccc[7, 7] = pa(1500), pa(35000), 90
    refc[7, 7] = 45.0
    sub = {("PRES", "ccb"): ccb, ("PRES", "cct"): cct, ("TCDC", "ccc"): ccc,
           ("CAPE", "cape"): cape, ("REFC", "sfc"): refc}
    conv = conv_column(sub)
    assert conv[2][5, 5] == 1 and conv[2][6, 6] == 0 and conv[2][7, 7] == 3 and conv[2][8, 8] == 0, conv[2][5:9, 5:9]
    assert abs(conv[0][5, 5] - 2000) < 40 and abs(conv[1][5, 5] - 8000) < 60, (conv[0][5, 5], conv[1][5, 5])
    assert conv[0][8, 8] == 0 and conv[1][8, 8] == 0, "hors nuage, base et sommet à zéro"
    # Le niveau est DEDANS ou il ne l'est pas : FL050 traverse le cumulus,
    # FL140 passe au-dessus, et la cellule violente monte jusqu'au FL350.
    c5 = apply_convective(val, conv, None, 50)
    assert c5[5, 5] == CONV_BYTES[0] and classify_bytes(c5)[5, 5] == 1, "dans le cumulus -> light"
    assert c5[6, 6] == 0, "un nuage qui ne couvre pas ne compte pas"
    assert c5[7, 7] == CONV_BYTES[2] and classify_bytes(c5)[7, 7] == 3, "dans la cellule violente -> severe"
    c14 = apply_convective(val, conv, None, 140)
    assert c14[5, 5] == 0, "au-dessus du sommet du cumulus, plus rien"
    assert c14[7, 7] == CONV_BYTES[2], "la cellule violente, elle, monte jusque-là"
    assert apply_convective(val, conv, None, 400)[7, 7] == 0, "au-dessus du sommet de la cellule, plus rien"
    assert apply_convective(val, conv, None, 10)[5, 5] == 0, "sous la base du nuage, plus rien"
    assert apply_convective(np.full_like(val, 200), conv, None, 50)[5, 5] == 200, "un severe déjà là n'est pas abaissé"
    # Les thermiques : sous une couche limite franche, light ; au-dessus, rien.
    hp = np.zeros(sh); hp[1, 1] = 6000; hp[2, 2] = 1500
    t30 = apply_convective(np.zeros(sh, dtype=np.uint8), conv, hp, 30)
    assert t30[1, 1] == PBL_BYTE and classify_bytes(t30)[1, 1] == 1, "sous une couche limite de 6 000 ft -> light"
    assert t30[2, 2] == 0, "une couche limite de 1 500 ft ne compte pas"
    assert apply_convective(np.zeros(sh, dtype=np.uint8), conv, hp, 80)[1, 1] == 0, "au-dessus de la couche limite, rien"
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
    # Les champs 2D : ceux de la colonne convective et la couche limite, à
    # l'instant et jamais en moyenne ; le CAPE de surface et CPRAT ne sont
    # plus demandés depuis le 2026-09-05.
    assert wanted("PRES", "convective cloud bottom level", "12 hour fcst")
    assert wanted("TCDC", "convective cloud layer", "12 hour fcst")
    assert wanted("CAPE", "180-0 mb above ground", "12 hour fcst") and not wanted("CAPE", "180-0 mb above ground", "0-3 hour ave fcst")
    assert wanted("HPBL", "surface", "12 hour fcst") and not wanted("CAPE", "surface", "12 hour fcst")
    assert not wanted("CPRAT", "surface", "12 hour fcst")
    # La clé d'un champ 2D est un COUPLE, comme celle d'un niveau de pression :
    # une chaîne nue s'y glisse sans bruit et conv_column ne trouve plus rien —
    # la colonne sortait toute à zéro (2026-09-05, fichiers de 3 Ko).
    assert SURFACE_KEY[("PRES", "convective cloud bottom level")] == ("PRES", "ccb")
    assert all(isinstance(v, tuple) and len(v) == 2 for v in SURFACE_KEY.values()), SURFACE_KEY
    assert set(SURFACE_KEY) == SURFACE_FIELDS, "chaque champ 2D demandé doit avoir sa clé"
    # build_hour sur des champs synthétiques, comme les rend fetch_fields :
    # chaque FL sort, à la taille de la boîte, en octets.
    nj, ni = 41, 80
    fields = {"_grid": (90.0, 0.0, 0.25, 0.25, nj, ni)}
    for p in LEVELS:
        fields[("UGRD", p)] = np.full((nj, ni), 20.0 + p / 50.0)
        fields[("VGRD", p)] = np.zeros((nj, ni))
        fields[("HGT", p)] = np.full((nj, ni), 16000.0 - 15.0 * p)
    fields[("REFC", "sfc")] = np.zeros((nj, ni))
    fields[("HPBL", "sfc")] = np.zeros((nj, ni))
    fields[("CAPE", "cape")] = np.zeros((nj, ni))
    fields[("TCDC", "ccc")] = np.zeros((nj, ni))
    for k in ("ccb", "cct"):
        fields[("PRES", k)] = np.full((nj, ni), np.nan)      # aucun nuage convectif
    # Base à 4 000 ft : le FL030 passe dessous, le FL050 entre dedans.
    fields[("PRES", "ccb")][3, 3] = pa(4000); fields[("PRES", "cct")][3, 3] = pa(9000)
    fields[("TCDC", "ccc")][3, 3] = 70
    res, g, col = build_hour(fields, (0.0, 80.0, 19.75, 90.0), 1)
    assert sorted(res) == sorted(list(FL_TO_HPA) + list(FL_LOW)), sorted(res)
    assert all(v.shape == (g[4], g[5]) == (41, 80) and v.dtype == np.uint8 for v in res.values()), (g, {k: v.shape for k, v in res.items()})
    # Les niveaux bas existent, et ne portent QUE la convection : le point du
    # cumulus est allumé au FL050, tout le reste est à zéro.
    assert res[50][3, 3] == CONV_BYTES[0] and res[50].sum() == CONV_BYTES[0], "FL050 : le cumulus, et rien d'autre"
    assert res[30][3, 3] == 0 and res[30].sum() == 0, "sous la base du nuage (4 000 ft), le FL030 ne voit rien"
    # La colonne publiée : trois plans de la taille de la grille, base et
    # sommet par pas de 500 ft.
    assert len(col) == 3 and all(c.shape == (41, 80) and c.dtype == np.uint8 for c in col), [c.shape for c in col]
    assert col[2][3, 3] == 1 and abs(col[0][3, 3] * CONV_FT_STEP - 4000) < 300, (col[2][3, 3], col[0][3, 3])
    assert abs(col[1][3, 3] * CONV_FT_STEP - 9000) < 300, col[1][3, 3]
    assert col[2].sum() == 1, "un seul point convectif dans la boîte"
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
    grids, cols, grid = {}, {}, None
    for fh in hours:
        fields = fetch_fields(run, fh)
        grids[fh], grid, cols[fh] = build_hour(fields, bbox, a.pool)
        print("  f%03d ok" % fh, file=sys.stderr)
    write_out(a.out, run, hours, grids, grid, cols)
    print("écrit dans", a.out, file=sys.stderr)


if __name__ == "__main__":
    main()
