// ============================================================
//  Grille de turbulence : décodage (RLE d'hier, PNG d'aujourd'hui), classes
//  et valeurs, choix de l'échéance, rééchantillonnage lissé de la nappe,
//  palette. Même procédé que classify.test.mjs : la section vit dans le
//  <script> de notam-filter.html entre deux marqueurs textuels, on la
//  découpe et on l'évalue seule — aucun DOM n'y est touché.
//
//  Lancer :  node --test test/*.test.mjs
//  Le PNG de référence test/turb-fixture.png vient du pipeline Python :
//    python3 tools/turb/build_turb.py --fixture test/turb-fixture.png
//  (37 × 23, pixel = (7x + 13y) mod 256, un chunk tEXt « turb ») — c'est
//  l'encodeur du serveur lu par le décodeur du client.
// ============================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { deflateSync } from "node:zlib";

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(HERE, "..", "notam-filter.html"), "utf8");

async function chargerTurb() {
  const a = html.indexOf("// [turb-decode]"), b = html.indexOf("// [/turb-decode]");
  assert.ok(a >= 0 && b > a, "marqueurs [turb-decode] introuvables");
  const c = html.indexOf("// [turb-profile]"), d = html.indexOf("// [/turb-profile]");
  assert.ok(c >= 0 && d > c, "marqueurs [turb-profile] introuvables");
  const src = html.slice(a, b) + "\n" + html.slice(c, d)
    + "\nexport { turbDecode, turbValFromCls, turbClassOf, turbPngParse, turbPngUnfilter, turbPngDecode, turbPickHour,"
    + " turbCatmull, turbResample, turbMercLat, turbLut, turbColorize,"
    + " gcDistNM, gcPoint, turbProfile, turbBracketHours, turbNearestFl, turbValueAt, turbValueNear, turbSampleProfile, turbEpisodes };";
  return import("data:text/javascript;base64," + Buffer.from(src).toString("base64"));
}

// ------------------------------------------------------------ PNG côté test ---
// Un encodeur minimal : chaque ligne prend le filtre demandé (0..4), calculé
// sur les octets d'origine comme le veut la spécification.
function crc32(bytes) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < bytes.length; n++) {
    c = (crc ^ bytes[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(tag, data) {
  const t = Buffer.from(tag, "latin1"), len = Buffer.alloc(4), crc = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
function pngGray8(w, h, px, filterOf, text) {
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) {
    const f = filterOf(y);
    raw[y * (w + 1)] = f;
    for (let x = 0; x < w; x++) {
      const cur = px[y * w + x], a = x ? px[y * w + x - 1] : 0, b = y ? px[(y - 1) * w + x] : 0, c = x && y ? px[(y - 1) * w + x - 1] : 0;
      let p = 0;
      if (f === 1) p = a; else if (f === 2) p = b; else if (f === 3) p = (a + b) >> 1;
      else if (f === 4) { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      raw[y * (w + 1) + 1 + x] = (cur - p) & 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0;
  const parts = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr)];
  for (const [k, v] of Object.entries(text || {})) parts.push(chunk("tEXt", Buffer.concat([Buffer.from(k, "latin1"), Buffer.from([0]), Buffer.from(v, "latin1")])));
  // L'IDAT coupé en deux : le lecteur doit recoller les morceaux.
  const z = deflateSync(raw), half = z.length >> 1;
  parts.push(chunk("IDAT", z.subarray(0, half)), chunk("IDAT", z.subarray(half)), chunk("IEND", Buffer.alloc(0)));
  return Buffer.concat(parts);
}

test("turbDecode rend une classe par point, dans l'ordre du serveur", async () => {
  const { turbDecode } = await chargerTurb();
  const cls = turbDecode({ nlat: 2, nlon: 5, rle: [0, 2, 1, 3, 2, 1, 0, 4] });
  assert.deepEqual(Array.from(cls), [0, 0, 1, 1, 1, 2, 0, 0, 0, 0]);
});

test("turbDecode refuse une grille tronquée", async () => {
  const { turbDecode } = await chargerTurb();
  assert.throws(() => turbDecode({ nlat: 2, nlon: 5, rle: [0, 2, 1, 3] }), /grille/);
});

test("classes et valeurs : la nuance forte pour une classe seule, les seuils de l'index pour l'octet", async () => {
  const { turbValFromCls, turbClassOf } = await chargerTurb();
  assert.deepEqual(Array.from(turbValFromCls(Uint8Array.from([0, 1, 2, 3]))), [0, 96, 160, 224]);
  const val = [0, 63, 64, 96, 127, 128, 191, 192, 252];
  assert.deepEqual(val.map(v => turbClassOf(v)), [0, 0, 1, 1, 1, 2, 2, 3, 3], "seuils par défaut 64/128/192");
  assert.deepEqual(val.map(v => turbClassOf(v, [50, 100, 200])), [0, 1, 1, 1, 2, 2, 2, 2, 3], "seuils de l'index");
  // Les seuils EDR × 100 publiés depuis le 2026-09-05 : 15, 22, 34 ; une
  // valeur absente (NaN) vaut la classe 0.
  assert.deepEqual([0, 10, 14, 15, 21.9, 22, 33.9, 34, 45, NaN].map(v => turbClassOf(v, [15, 22, 34])), [0, 0, 0, 1, 1, 2, 2, 3, 3, 0]);
  // L'aller-retour d'une classe retombe sur elle.
  assert.deepEqual(Array.from(turbValFromCls(Uint8Array.from([3, 2, 1, 0]))).map(v => turbClassOf(v)), [3, 2, 1, 0]);
});

test("PNG : les cinq filtres, l'IDAT en morceaux, le tEXt — pixels exacts", async () => {
  const { turbPngParse, turbPngUnfilter, turbPngDecode } = await chargerTurb();
  const w = 13, h = 11, px = new Uint8Array(w * h);
  for (let i = 0; i < px.length; i++) px[i] = (i * 37 + (i >> 3) * 101) & 255;
  const buf = pngGray8(w, h, px, y => y % 5, { turb: '{"grid":{"nlat":11,"nlon":13}}', Comment: "x" });
  const p = turbPngParse(buf);
  assert.equal(p.w, 13); assert.equal(p.h, 11);
  assert.deepEqual(p.text, { turb: '{"grid":{"nlat":11,"nlon":13}}', Comment: "x" });
  const d = await turbPngDecode(buf);
  assert.deepEqual(Array.from(d.val), Array.from(px), "les pixels ressortent tels quels");
  assert.deepEqual(d.meta, { grid: { nlat: 11, nlon: 13 } });
  // Le défiltrage seul, sur des lignes fabriquées à la main : Sub puis Up.
  const flat = Uint8Array.from([1, 10, 5, 5, 2, 0, 1, 2]);   // ligne 0 Sub : 10, 15, 20 ; ligne 1 Up : 10, 16, 22
  assert.deepEqual(Array.from(turbPngUnfilter(flat, 3, 2)), [10, 15, 20, 10, 16, 22]);
  assert.throws(() => turbPngUnfilter(flat, 3, 3), /incomplet/);
  assert.throws(() => turbPngParse(new Uint8Array([1, 2, 3])), /pas un PNG/);
});

test("PNG de référence écrit par le pipeline Python : lu à l'identique par le client", async () => {
  const { turbPngDecode } = await chargerTurb();
  const f = join(HERE, "turb-fixture.png");
  assert.ok(existsSync(f), "test/turb-fixture.png manque — python3 tools/turb/build_turb.py --fixture test/turb-fixture.png");
  const d = await turbPngDecode(new Uint8Array(readFileSync(f)));
  assert.equal(d.w, 37); assert.equal(d.h, 23);
  for (let y = 0; y < 23; y++) for (let x = 0; x < 37; x++) assert.equal(d.val[y * 37 + x], (7 * x + 13 * y) % 256, `pixel (${x},${y})`);
  assert.equal(d.meta.fixture, 1);
  assert.deepEqual(d.meta.grid, { lat0: 50.0, lon0: -10.0, dlat: -0.25, dlon: 0.25, nlat: 23, nlon: 37 });
});

test("turbPickHour choisit l'échéance publiée la plus proche de maintenant + horizon", async () => {
  const { turbPickHour } = await chargerTurb();
  const index = { run: "2026-09-03T00:00Z", hours: [3, 4, 5, 6, 9, 12, 24, 36] };
  const t = Date.parse("2026-09-03T07:20Z");
  assert.equal(turbPickHour(index, t, 0), 6);      // 07:20 → f006 plutôt que f009
  assert.equal(turbPickHour(index, t, 3), 9);      // 10:20 → f009
  assert.equal(turbPickHour(index, t, 12), 24);    // 19:20 → f024 plutôt que f012
  assert.equal(turbPickHour(index, Date.parse("2026-09-05T12:00Z"), 12), 36, "borné à la dernière échéance");
  assert.equal(turbPickHour(index, Date.parse("2026-09-03T00:10Z"), 0), 3, "borné à la première");
});

// ------------------------------------------------------------ la nappe lissée ---
test("turbCatmull : partition de l'unité, passe par les points", async () => {
  const { turbCatmull } = await chargerTurb();
  for (const t of [0, 0.25, 0.5, 0.9]) assert.ok(Math.abs(turbCatmull(t).reduce((a, b) => a + b, 0) - 1) < 1e-12, "somme des poids = 1 en " + t);
  assert.deepEqual(turbCatmull(0), [0, 1, 0, 0], "en t = 0, le point lui-même");
});

test("turbResample : exact aux centres des cases, rond entre elles, rien hors grille", async () => {
  const { turbResample } = await chargerTurb();
  // 5 × 5 cases de 1°, une seule case marquée (224 = severe fort) au centre.
  const grid = { lat0: 50, lon0: 0, dlat: -1, dlon: 1, nlat: 5, nlon: 5 };
  const val = new Uint8Array(25); val[2 * 5 + 2] = 224;
  // Le raster couvre exactement la grille (bord ouest de la case 0 au bord
  // est de la case 4), 9 pixels par case : le pixel 22 est le centre de la
  // case 2, le pixel 31 celui de la case 3.
  const spec = { W: 45, H: 45, u0: -0.5, u1: 4.5, v0: 50.5, v1: 45.5, lonOfU: u => u, latOfV: v => v };
  const out = turbResample(grid, val, spec);
  const at = (x, y) => out[y * 45 + x];
  assert.ok(Math.abs(at(22, 22) - 224) < 1e-3, "centre de la case : sa valeur, " + at(22, 22));
  assert.ok(Math.abs(at(31, 22)) < 1e-3, "centre de la voisine : zéro, " + at(31, 22));
  assert.ok(Math.abs(at(22, 31)) < 1e-3, "voisine du sud : zéro");
  // Décroissance monotone du centre vers la voisine, et plus de la moitié à mi-chemin.
  for (let x = 22; x < 31; x++) assert.ok(at(x + 1, 22) <= at(x, 22) + 1e-6, "monotone en x = " + x);
  assert.ok(at(26, 22) > 112 && at(27, 22) > 100, "à mi-chemin, encore au-dessus de light : " + at(26, 22));
  assert.ok(at(0, 0) === 0 && at(44, 44) === 0, "les coins, loin de la case : zéro");
  // Hors de la grille (au nord), rien.
  const north = turbResample(grid, val, { ...spec, v0: 70, v1: 60 });
  assert.ok(north.every(x => x === 0), "au nord de la grille : rien");
});

test("turbResample : sur une grille mondiale les colonnes bouclent à l'antiméridien", async () => {
  const { turbResample } = await chargerTurb();
  const world = { lat0: 89.5, lon0: -179.5, dlat: -1, dlon: 1, nlat: 180, nlon: 360 };
  const val = new Uint8Array(180 * 360);
  val[100 * 360 + 359] = 200;                       // lat -10,5°, lon +179,5°
  const spec = { W: 4, H: 1, u0: -180.5, u1: -179.5, v0: -10.5, v1: -10.5, lonOfU: u => u, latOfV: v => v };
  const out = turbResample(world, val, spec);      // juste à l'ouest de -180 : c'est la case 359 qui est là
  assert.ok(out[0] > 100, "la valeur de l'autre côté de l'antiméridien est vue : " + out[0]);
  const region = { ...world, nlon: 359 };          // plus mondiale : rien ne boucle
  assert.ok(turbResample(region, val, spec).every(x => x === 0));
});

test("turbMercLat inverse le Mercator normalisé", async () => {
  const { turbMercLat } = await chargerTurb();
  const mercY = lat => 0.5 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / (2 * Math.PI);
  assert.ok(Math.abs(turbMercLat(0.5)) < 1e-12);
  for (const lat of [-60, -12.5, 0, 33, 45, 70, 85]) assert.ok(Math.abs(turbMercLat(mercY(lat)) - lat) < 1e-9, "lat " + lat);
});

test("turbLut et turbColorize : transparent sous light, deux nuances par classe, débordements bornés", async () => {
  const { turbLut, turbColorize } = await chargerTurb();
  const lut = turbLut([64, 128, 192], false);
  const rgba = v => Array.from(lut.subarray(v * 4, v * 4 + 4));
  assert.deepEqual(rgba(63), [0, 0, 0, 0], "sous light : rien");
  assert.ok(rgba(64)[3] > 0, "light : coloré");
  assert.notDeepEqual(rgba(64), rgba(96), "deux nuances de light");
  assert.deepEqual(rgba(95), rgba(64)); assert.deepEqual(rgba(127), rgba(96));
  assert.notDeepEqual(rgba(128), rgba(127), "moderate change de couleur");
  assert.notDeepEqual(rgba(192), rgba(191), "severe aussi");
  assert.deepEqual(rgba(255), rgba(224), "la nuance forte de severe jusqu'au bout");
  const light = turbLut([64, 128, 192], true);
  assert.notDeepEqual(Array.from(light.subarray(64 * 4, 64 * 4 + 4)), rgba(64), "le thème jour a sa palette");
  const px = new Uint8ClampedArray(6 * 4);
  turbColorize(Float32Array.from([-3, 0.2, 63.4, 64, 300, 200]), lut, px);
  assert.deepEqual(Array.from(px.subarray(0, 12)), [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], "négatif, nul, sous le seuil : transparents");
  assert.deepEqual(Array.from(px.subarray(12, 16)), rgba(64));
  assert.deepEqual(Array.from(px.subarray(16, 20)), rgba(255), "au-delà de 255 : borné");
  assert.deepEqual(Array.from(px.subarray(20, 24)), rgba(200));
});

// ---------------------------------------------------------------- profil ---
const LFPG = { lat: 49.0097, lon: 2.5479 }, LFMN = { lat: 43.6584, lon: 7.2159 }, LFBO = { lat: 43.6291, lon: 1.3638 };

test("gcDistNM et gcPoint : distance connue, extrémités exactes, milieu sur l'arc", async () => {
  const { gcDistNM, gcPoint } = await chargerTurb();
  const d = gcDistNM(LFPG, LFMN);
  assert.ok(d > 360 && d < 385, "LFPG-LFMN ≈ 372 NM, obtenu " + d);
  const a = gcPoint(LFPG, LFMN, 0), b = gcPoint(LFPG, LFMN, 1), m = gcPoint(LFPG, LFMN, .5);
  assert.ok(Math.abs(a.lat - LFPG.lat) < 1e-9 && Math.abs(b.lon - LFMN.lon) < 1e-9);
  assert.ok(Math.abs(gcDistNM(LFPG, m) - gcDistNM(m, LFMN)) < 0.01, "le milieu est équidistant");
});

test("turbProfile : une longue étape atteint la croisière, une courte plafonne plus bas", async () => {
  const { turbProfile } = await chargerTurb();
  const long = turbProfile(372, 35000);
  assert.equal(long.top, 35000);
  const last = long.pts[long.pts.length - 1];
  assert.ok(Math.abs(last[1] - 372) < 1e-6 && last[2] === 0, "termine à destination au sol");
  assert.ok(long.total > 55 && long.total < 80, "≈ 1 h 05, obtenu " + long.total);
  for (let i = 1; i < long.pts.length; i++) assert.ok(long.pts[i][1] >= long.pts[i - 1][1], "distance monotone");
  assert.ok(long.pts.some(p => p[2] === 35000), "passe en croisière");
  const court = turbProfile(60, 35000);
  assert.ok(court.top < 35000 && court.top >= 1000, "plafond réduit : " + court.top);
  assert.ok(court.pts[court.pts.length - 1][2] === 0);
});

test("turbBracketHours encadre l'instant et se borne aux échéances publiées", async () => {
  const { turbBracketHours } = await chargerTurb();
  const index = { run: "2026-09-03T00:00Z", hours: [3, 6, 9, 12] };
  assert.deepEqual(turbBracketHours(index, Date.parse("2026-09-03T07:20Z")), [6, 9]);
  assert.deepEqual(turbBracketHours(index, Date.parse("2026-09-03T06:00Z")), [6]);
  assert.deepEqual(turbBracketHours(index, Date.parse("2026-09-03T01:00Z")), [3]);
  assert.deepEqual(turbBracketHours(index, Date.parse("2026-09-04T01:00Z")), [12]);
});

test("turbValueAt : exact aux points de grille, moyenne à mi-chemin, bouclage à l'antiméridien, NaN hors grille", async () => {
  const { turbValueAt } = await chargerTurb();
  const grid = { lat0: 50, lon0: 0, dlat: -0.25, dlon: 0.25, nlat: 3, nlon: 3 };
  const val = Uint8Array.from([0, 40, 0, 0, 20, 0, 0, 0, 0]);
  assert.equal(turbValueAt(grid, val, 50, 0.25), 40, "au point de grille : sa valeur");
  assert.equal(turbValueAt(grid, val, 49.75, 0.25), 20);
  assert.equal(turbValueAt(grid, val, 49.875, 0.25), 30, "à mi-chemin entre deux points : la moyenne");
  assert.equal(turbValueAt(grid, val, 50, 0.125), 20, "à mi-chemin en longitude");
  assert.ok(Number.isNaN(turbValueAt(grid, val, 49, 7)), "hors grille : NaN");
  assert.ok(Number.isNaN(turbValueAt(grid, val, 51, 0.25)), "au-dessus du premier rang : NaN");
  assert.ok(Number.isNaN(turbValueAt(grid, val, 49.75, -1)), "à l'ouest de la grille régionale : NaN");
  // Grille mondiale : la dernière colonne (179,75 E) et la première (180 W) se touchent.
  const world = { lat0: 90, lon0: -180, dlat: -0.25, dlon: 0.25, nlat: 721, nlon: 1440 };
  const wv = new Uint8Array(721 * 1440);
  wv[200 * 1440 + 1439] = 30; wv[200 * 1440] = 10;
  assert.equal(turbValueAt(world, wv, 40, 179.75), 30);
  assert.equal(turbValueAt(world, wv, 40, 179.875), 20, "entre 179,75 E et 180 W : la moyenne des deux bouts");
  assert.equal(turbValueAt(world, wv, 40, -180), 10);
  assert.equal(turbValueAt(world, wv, 40, 180), 10, "180 E est 180 W");
});

test("turbValueNear : le point seul sur une grille large, le pire des neuf sur une grille fine", async () => {
  const { turbValueNear } = await chargerTurb();
  const coarse = { lat0: 50, lon0: 0, dlat: -1, dlon: 1, nlat: 3, nlon: 3 };
  const val = Uint8Array.from([0, 45, 0, 0, 18, 0, 0, 0, 0]);
  assert.equal(turbValueNear(coarse, val, 49, 1), 18, "à 1°, le point seul — le voisin à 45 n'est pas lu");
  assert.ok(Number.isNaN(turbValueNear(coarse, val, 49, 7)), "hors grille");
  const fine = { lat0: 50, lon0: 0, dlat: -0.25, dlon: 0.25, nlat: 3, nlon: 3 };
  assert.equal(turbValueNear(fine, val, 49.75, 0.25), 45, "à 0,25°, le pire des neuf voisins");
  assert.equal(turbValueNear(fine, val, 50, 0), 45, "au coin : les voisins existants seulement");
  assert.equal(turbValueNear(fine, val, 49.5, 0.5), 18, "deux points plus loin, le 45 est hors de portée : seul le 18 voisin");
  assert.equal(turbValueNear(fine, new Uint8Array(9), 49.75, 0.25), 0, "rien autour : zéro");
  const world = { lat0: 90, lon0: -180, dlat: -0.25, dlon: 0.25, nlat: 721, nlon: 1440 };
  const wv = new Uint8Array(721 * 1440); wv[200 * 1440] = 33;
  assert.equal(turbValueNear(world, wv, 40, 179.75), 33, "le voisin de l'autre côté de l'antiméridien compte");
});

test("turbSampleProfile : la valeur au centre, linéaire entre les deux échéances ; l'enveloppe à côté ; sous FL100 rien", async () => {
  const { turbSampleProfile, turbNearestFl } = await chargerTurb();
  assert.equal(turbNearestFl([100, 140, 180, 240, 270, 300, 340, 390, 450], 31000), 300);
  // Un vol le long du 45e parallèle, de 0 à 1° E (42 NM), déjà en croisière.
  // La grille 0,25° porte 20 (EDR × 100 : 0,20) à f006 et 32 à f009 sur les
  // rangs 44,75–45,25 N, et un point à 40 en 45,25 N 0,5 E — voisin de la
  // route (0,25° au nord), jamais sous elle.
  const grid = { lat0: 46, lon0: -1, dlat: -0.25, dlon: 0.25, nlat: 9, nlon: 13 };
  const index = { run: "2026-09-03T00:00Z", hours: [3, 6, 9, 12], grid, fls: [100, 140, 180, 240, 270, 300, 340, 390, 450] };
  const cell = (lat, lon) => Math.round((lat - grid.lat0) / grid.dlat) * grid.nlon + Math.round((lon - grid.lon0) / grid.dlon);
  const zero = new Uint8Array(9 * 13), g6 = new Uint8Array(9 * 13), g9 = new Uint8Array(9 * 13);
  for (const lat of [44.75, 45, 45.25]) for (let i = 0; i < 13; i++) { g6[cell(lat, -1 + i * 0.25)] = 20; g9[cell(lat, -1 + i * 0.25)] = 32; }
  g9[cell(45.25, 0.5)] = 40;
  const A = { lat: 45, lon: 0 }, B = { lat: 45, lon: 1 }, LV = [15, 22, 34];
  const prof = { total: 10, top: 35000, pts: Array.from({ length: 11 }, (_, m) => [m, m * 4.2, m ? 35000 : 0]) };
  const entOf = (fl, fh) => ({ val: fh === 6 ? g6 : fh === 9 ? g9 : zero, grid });
  // Décollage 07:30Z : à H+1 on est 91 minutes après f006, sur 180 jusqu'à f009.
  const tko = Date.parse("2026-09-03T07:30Z");
  const P = turbSampleProfile(prof, A, B, index, tko, index.fls, entOf, LV);
  assert.equal(P.pts[0].cls, -1, "au sol : sous FL100, rien");
  assert.ok(Number.isNaN(P.pts[0].v));
  assert.ok(Math.abs(P.pts[1].v - (20 + 12 * (91 / 180))) < 1e-9, "H+1 : 20 + 12 × 91/180 — obtenu " + P.pts[1].v);
  assert.equal(P.pts[1].cls, 2, "moderate aux seuils 15/22/34");
  assert.equal(P.pts[1].lo, 20, "lo : la plus basse des deux échéances au centre");
  assert.equal(P.pts[1].hi, 32, "hi loin du point à 40 : le pire des neuf, ici la valeur de f009");
  assert.deepEqual(P.pts[1].hours, [6, 9]);
  const near = P.pts.find(p => Math.abs(p.lon - 0.5) < 0.13);
  assert.ok(near && near.hi === 40 && near.v < 34, "près de 0,5 E le 40 voisin entre dans l'enveloppe, pas dans la courbe : " + JSON.stringify(near));
  assert.equal(P.max, 2, "la classe du vol vient de la courbe : moderate, pas severe");
  assert.equal(P.peak, 10, "le pic est la dernière minute — l'heure avance vers f009");
  assert.deepEqual(P.events.map(e => e.cls), [-1, 2], "transitions seules : le sol, puis moderate jusqu'au bout");
  // Une seule des deux échéances disponible : sa valeur telle quelle.
  const Q = turbSampleProfile(prof, A, B, index, tko, index.fls, (fl, fh) => fh === 6 ? { val: g6, grid } : null, LV);
  assert.equal(Q.pts[1].v, 20); assert.equal(Q.pts[1].cls, 1); assert.equal(Q.pts[1].hi, 20);
  // Aucun fichier : -2 (le sol reste -1, donc max -1).
  const R = turbSampleProfile(prof, A, B, index, tko, index.fls, () => null, LV);
  assert.equal(R.pts[1].cls, -2); assert.equal(R.max, -1); assert.equal(R.peak, -1);
  // Après la dernière échéance publiée : elle seule, sans interpolation.
  const S = turbSampleProfile(prof, A, B, index, Date.parse("2026-09-03T13:00Z"), index.fls, entOf, LV);
  assert.deepEqual(S.pts[1].hours, [12]); assert.equal(S.pts[1].v, 0); assert.equal(S.pts[1].cls, 0);
  // Hors grille : -2 partout au-dessus de FL100.
  const tiny = { ...index, grid: { lat0: 45, lon0: 6, dlat: -0.25, dlon: 0.25, nlat: 2, nlon: 2 } };
  const T = turbSampleProfile(prof, A, B, tiny, tko, index.fls, () => ({ val: new Uint8Array(4), grid: tiny.grid }), LV);
  assert.ok(T.pts.slice(1).every(p => p.cls === -2), "hors grille signalé");
  void LFBO; void LFMN;
});

test("turbEpisodes regroupe les transitions en plages continues de turbulence", async () => {
  const { turbEpisodes } = await chargerTurb();
  const P = { total: 100, dist: 700, events: [
    { t: 0, d: 0, fl: null, cls: -1, lat: 0, lon: 0 },
    { t: 4, d: 17, fl: 100, cls: 0, lat: 0, lon: 0 },
    { t: 20, d: 120, fl: 340, cls: 1, lat: 1, lon: 1 },
    { t: 25, d: 160, fl: 340, cls: 3, lat: 2, lon: 2 },     // même épisode, pire classe
    { t: 30, d: 200, fl: 340, cls: 1, lat: 3, lon: 3 },
    { t: 40, d: 280, fl: 340, cls: 0, lat: 0, lon: 0 },     // fin du premier
    { t: 80, d: 600, fl: 240, cls: 2, lat: 4, lon: 4 },     // second, jusqu'à l'atterrissage
  ] };
  const eps = turbEpisodes(P);
  assert.equal(eps.length, 2);
  assert.deepEqual([eps[0].t0, eps[0].t1, eps[0].cls, eps[0].d0, eps[0].d1, eps[0].lat], [20, 40, 3, 120, 280, 2]);
  assert.deepEqual([eps[1].t0, eps[1].t1, eps[1].cls, eps[1].d1, eps[1].flMin], [80, 100, 2, 700, 240]);
  assert.ok(Number.isNaN(eps[0].vMax), "sans série par minute, pas de pic");
  // Avec la série : le pic de chaque épisode, les minutes hors épisode ignorées.
  const withPts = turbEpisodes({ ...P, pts: [{ t: 10, v: 90 }, { t: 22, v: 18 }, { t: 27, v: 40 }, { t: 35, v: 16 }, { t: 40, v: 50 }, { t: 85, v: 25 }, { t: 90, v: NaN }] });
  assert.equal(withPts[0].vMax, 40); assert.equal(withPts[1].vMax, 25);
});
