"""Lecteur GRIB2 minimal, sans eccodes : grille lat/lon (template 3.0),
packing simple (5.0), complexe (5.2) et complexe à différenciation spatiale
(5.3 — celui du GFS 0,25°), JPEG2000 (5.40, décodé par Pillow), bitmap (6).
Suffit pour les champs lus par build_turb.py ; sert à calib_ti1.py, qui
rejoue le pipeline sur un poste sans eccodes. Dépendances : numpy, Pillow."""
import io, struct
import numpy as np
from PIL import Image


def _u(b, o, n):
    return int.from_bytes(b[o:o + n], "big")


def _s(b, o, n):
    """Entier signé GRIB : bit de signe + magnitude (pas de complément à deux)."""
    v = _u(b, o, n)
    sign = 1 << (8 * n - 1)
    return -(v & (sign - 1)) if v & sign else v


def messages(blob):
    pos = 0
    while pos + 16 <= len(blob):
        if blob[pos:pos + 4] != b"GRIB":
            k = blob.find(b"GRIB", pos)
            if k < 0:
                return
            pos = k
            continue
        total = _u(blob, pos + 8, 8)
        yield blob[pos:pos + total]
        pos += total


def _read_uints(bits, pos, n, width):
    """n entiers non signés de `width` bits à partir du bit `pos`."""
    if width == 0 or n == 0:
        return np.zeros(n, dtype=np.int64), pos
    out = np.empty(n, dtype=np.int64)
    weights = (1 << np.arange(width - 1, -1, -1)).astype(np.int64)
    step = max(1, 4_000_000 // width)
    for a in range(0, n, step):
        b = min(n, a + step)
        idx = pos + (np.arange(a, b)[:, None] * width) + np.arange(width)[None, :]
        out[a:b] = (bits[idx].astype(np.int64) * weights).sum(axis=1)
    return out, pos + n * width


def _unpack_simple(data, nbits, npts):
    bits = np.unpackbits(np.frombuffer(data, dtype=np.uint8))
    return _read_uints(bits, 0, npts, nbits)[0].astype(np.float64)


def _unpack_complex(s5, data, npts, tmpl):
    """Templates 5.2 / 5.3 (g2clib comunpack) : groupes de référence + largeur
    + longueur, puis les valeurs ; 5.3 ajoute les premières valeurs et le biais
    de la différenciation spatiale (ordre 1 ou 2)."""
    nbits, miss = s5[19], s5[22]
    if miss != 0:
        raise NotImplementedError("gestion des valeurs manquantes %d" % miss)
    NG = _u(s5, 31, 4)
    ref_gw, bits_gw = s5[35], s5[36]
    ref_gl, inc_gl, last_len, bits_gl = _u(s5, 37, 4), s5[41], _u(s5, 42, 4), s5[46]
    order = nb = 0
    if tmpl == 3:
        order, nb = s5[47], s5[48]
    bits = np.unpackbits(np.frombuffer(data, dtype=np.uint8))
    pos, extra = 0, []
    if tmpl == 3:
        for _ in range(order + 1):
            v, pos = _read_uints(bits, pos, 1, nb * 8)
            v = int(v[0]); sign = 1 << (nb * 8 - 1)
            extra.append(-(v & (sign - 1)) if v & sign else v)
    refs, pos = _read_uints(bits, pos, NG, nbits); pos = (pos + 7) // 8 * 8
    widths, pos = _read_uints(bits, pos, NG, bits_gw); pos = (pos + 7) // 8 * 8
    widths = widths + ref_gw
    lens, pos = _read_uints(bits, pos, NG, bits_gl); pos = (pos + 7) // 8 * 8
    lens = lens * inc_gl + ref_gl
    lens[-1] = last_len
    if lens.sum() != npts:
        raise ValueError("groupes : %d points pour %d attendus" % (lens.sum(), npts))
    pw = np.repeat(widths, lens)
    X = np.repeat(refs, lens).astype(np.int64)
    group_start = pos + np.concatenate(([0], np.cumsum(lens * widths)[:-1]))
    first_idx = np.concatenate(([0], np.cumsum(lens)[:-1]))
    pstart = np.repeat(group_start, lens) + (np.arange(npts) - np.repeat(first_idx, lens)) * pw
    for w in np.unique(pw):
        if w == 0:
            continue
        sel = np.where(pw == w)[0]
        weights = (1 << np.arange(w - 1, -1, -1)).astype(np.int64)
        step = max(1, 4_000_000 // int(w))
        for a in range(0, sel.size, step):
            s = sel[a:a + step]
            idx = pstart[s][:, None] + np.arange(w)[None, :]
            X[s] += (bits[idx].astype(np.int64) * weights).sum(axis=1)
    if tmpl == 3:
        minsd = extra[-1]
        if order == 1:
            X[0] = extra[0]
            X[1:] += minsd
            X = np.cumsum(X)
        elif order == 2:
            X[0], X[1] = extra[0], extra[1]
            X[2:] += minsd
            # Y[n] = D[n] + 2 Y[n-1] - Y[n-2]  <=>  Z[n] = D[n] + Z[n-1] (Z : première différence)
            Z = np.cumsum(X[2:]) + (X[1] - X[0])
            Y = np.empty_like(X); Y[0], Y[1] = X[0], X[1]
            Y[2:] = X[1] + np.cumsum(Z)
            X = Y
        else:
            raise NotImplementedError("ordre de différenciation %d" % order)
    return X.astype(np.float64)


def decode(msg):
    """Un message -> (valeurs 2D du nord au sud et d'ouest en est,
    grille (lat1, lon1, dlat, dlon, nj, ni) comme fetch_file la rend)."""
    assert msg[:4] == b"GRIB" and msg[7] == 2, "pas un GRIB2"
    pos, sec = 16, {}
    while pos + 5 <= len(msg):
        if msg[pos:pos + 4] == b"7777":
            break
        ln, n = _u(msg, pos, 4), msg[pos + 4]
        sec[n] = msg[pos:pos + ln]
        pos += ln
    s3, s5, s6, s7 = sec[3], sec[5], sec.get(6), sec[7]
    tmpl3 = _u(s3, 12, 2)
    if tmpl3 != 0:
        raise NotImplementedError("grid template 3.%d" % tmpl3)
    ni, nj = _u(s3, 30, 4), _u(s3, 34, 4)
    la1, lo1 = _s(s3, 46, 4) / 1e6, _s(s3, 50, 4) / 1e6
    la2 = _s(s3, 55, 4) / 1e6
    di, dj = _u(s3, 63, 4) / 1e6, _u(s3, 67, 4) / 1e6
    scan = s3[71]
    npts, tmpl5 = _u(s5, 5, 4), _u(s5, 9, 2)
    R = struct.unpack(">f", s5[11:15])[0]
    E, D, nbits = _s(s5, 15, 2), _s(s5, 17, 2), s5[19]
    data = s7[5:]
    if tmpl5 in (2, 3):
        X = _unpack_complex(s5, data, npts, tmpl5)
    elif nbits == 0:
        X = np.zeros(npts)
    elif tmpl5 == 40:
        im = Image.open(io.BytesIO(data))
        X = np.asarray(im).astype(np.float64).ravel()
        if X.size != npts:
            raise ValueError("JPEG2000 : %d valeurs pour %d points" % (X.size, npts))
    elif tmpl5 == 0:
        X = _unpack_simple(data, nbits, npts)
    else:
        raise NotImplementedError("data template 5.%d" % tmpl5)
    Y = (R + X * (2.0 ** E)) / (10.0 ** D)
    if s6 is not None and s6[5] == 0:
        bits = np.unpackbits(np.frombuffer(s6[6:], dtype=np.uint8))[:ni * nj].astype(bool)
        full = np.full(ni * nj, np.nan)
        full[bits] = Y
        Y = full
    if scan & 0x20:
        raise NotImplementedError("scan j-consecutive")
    vals = Y.reshape(nj, ni)
    if scan & 0x80:
        vals = vals[:, ::-1]
    if scan & 0x40:                       # j croissant = du sud au nord : on retourne
        vals = vals[::-1]
    return vals, (max(la1, la2), lo1, dj, di, nj, ni)


def decode_first(blob):
    for m in messages(blob):
        return decode(m)
    raise ValueError("aucun message GRIB dans le blob")
