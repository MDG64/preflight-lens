"""Calibration de l'indice Ellrod en EDR : la climatologie de ln(TI1) sur la
grille de build_turb.py, mesurée sur des cycles GFS réels — ce sont les
constantes TI_LN_UPPER et TI_LN_MID de build_turb.py (Sharman & Pearson
2017 : ln EDR = C1 + C2 · (ln D − <ln D>) / SD(ln D)).

Rejoue le pipeline sans eccodes (grib2mini.py) :
  python tools/turb/calib_ti1.py fetch 2026090500 12     # un cycle, une échéance -> raw/<run>_f012.npz
  python tools/turb/calib_ti1.py stats                    # moyenne et écart-type de ln(TI1), quantiles
Les GRIB téléchargés et les TI1 bruts vont dans --work (défaut : le dossier
temporaire du système, preflight-turb-calib). Dépendances : numpy, Pillow.
Mesuré le 2026-09-05 sur quatre cycles : FL240–FL450 −15,82 / 1,169 ;
FL100–FL180 −16,52 / 1,261 ; ±0,02 et ±0,012 d'un cycle à l'autre."""
import argparse, datetime as dt, glob, os, sys, tempfile
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_turb as bt          # noqa: E402
import grib2mini                 # noqa: E402

WORK = os.path.join(tempfile.gettempdir(), "preflight-turb-calib")


def http_cached(url, rng):
    p = os.path.join(WORK, "grib", url.split("/")[-4] + "_" + url.split("/")[-1] + "_%d_%d.grb" % rng)
    if os.path.exists(p):
        return open(p, "rb").read()
    os.makedirs(os.path.dirname(p), exist_ok=True)
    b = bt.http_get(url, rng)
    open(p, "wb").write(b)
    return b


def fetch_file(run, fh, kind):
    """Comme build_turb.fetch_file, avec grib2mini à la place d'eccodes."""
    base = "%s/%s" % (bt.BUCKET, bt.gfs_path(run, fh, kind))
    rows = [r for r in bt.parse_idx(bt.http_get(base + ".idx")) if bt.wanted(r[0], r[1], r[4])]
    fields = {}
    for var, level, s, e, _f in rows:
        vals, grid = grib2mini.decode_first(http_cached(base, (s, e if e is not None else s + 4_000_000)))
        fields[(var, int(level.split()[0]) if level.endswith(" mb") else "sfc")] = vals
        fields["_grid"] = grid
    return fields


bt.fetch_file = fetch_file


def raw_ti(fields):
    """Comme build_hour, mais rend TI1 brut (s^-2) par FL, monde entier."""
    grid, sub = fields["_grid"], {}
    for k, v in fields.items():
        if k != "_grid":
            sub[k], out_grid = bt.subset(v, grid, bt.DEFAULT_BBOX)
    N, lon0, dlat, dlon, nlat, nlon = out_grid
    lats = N + np.arange(nlat) * dlat
    levels = sorted(bt.LEVELS, reverse=True)
    out = {}
    for fl, p in bt.FL_TO_HPA.items():
        i = levels.index(p)
        lo, hi = levels[max(i - 1, 0)], levels[min(i + 1, len(levels) - 1)]
        out[fl] = bt.ellrod_ti1(sub[("UGRD", lo)], sub[("VGRD", lo)], sub[("UGRD", hi)], sub[("VGRD", hi)],
                                sub[("HGT", lo)], sub[("HGT", hi)], sub[("UGRD", p)], sub[("VGRD", p)], lats, dlat, dlon).astype(np.float32)
    return out


def cmd_fetch(run_s, fh):
    run = dt.datetime.strptime(run_s, "%Y%m%d%H").replace(tzinfo=dt.timezone.utc)
    ti = raw_ti(bt.fetch_fields(run, fh))
    os.makedirs(os.path.join(WORK, "raw"), exist_ok=True)
    np.savez_compressed(os.path.join(WORK, "raw", "%s_f%03d.npz" % (run_s, fh)), **{"FL%03d" % fl: v for fl, v in ti.items()})
    print("ok", run_s, "f%03d" % fh, "; 99e centile de TI1 (1e-7) par FL :",
          {fl: round(float(np.nanpercentile(v, 99) * 1e7), 1) for fl, v in ti.items()})


def cmd_stats():
    files = sorted(glob.glob(os.path.join(WORK, "raw", "*.npz")))
    if not files:
        sys.exit("aucun cycle dans %s : lancer d'abord fetch" % WORK)
    lats = 90 - np.arange(721) * 0.25
    w = np.cos(np.radians(lats)); w[np.abs(lats) > bt.POLE_LAT] = 0
    W = np.repeat(w[:, None], 1440, axis=1)
    print("cycles :", [os.path.basename(f) for f in files])
    for name, fls in (("FL240-FL450 (TI_LN_UPPER)", [f for f in bt.FL_TO_HPA if f > bt.MID_MAX_FL]),
                      ("FL100-FL180 (TI_LN_MID)", [f for f in bt.FL_TO_HPA if f <= bt.MID_MAX_FL])):
        s1 = s2 = n = 0.0
        for f in files:
            z = np.load(f)
            for fl in fls:
                v = np.log(np.maximum(z["FL%03d" % fl].astype(np.float64), 1e-12))
                s1 += (W * v).sum(); s2 += (W * v * v).sum(); n += W.sum()
        mu, sd = s1 / n, np.sqrt(s2 / n - (s1 / n) ** 2)
        print("%s : mean ln(TI1) = %.3f  sd = %.3f   (dans build_turb.py : %s)" % (
            name, mu, sd, bt.TI_LN_UPPER if "UPPER" in name else bt.TI_LN_MID))


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", choices=["fetch", "stats"])
    ap.add_argument("run", nargs="?", help="cycle YYYYMMDDHH (fetch)")
    ap.add_argument("hour", nargs="?", type=int, help="échéance (fetch)")
    ap.add_argument("--work", default=WORK)
    a = ap.parse_args()
    WORK = a.work
    if a.cmd == "fetch":
        if not a.run or a.hour is None:
            ap.error("fetch demande le cycle et l'échéance")
        cmd_fetch(a.run, a.hour)
    else:
        cmd_stats()
