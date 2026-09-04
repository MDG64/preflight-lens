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
    + "\nexport { turbDecode, turbValFromCls, turbClsFromVal, turbPngParse, turbPngUnfilter, turbPngDecode, turbPickHour,"
    + " turbCatmull, turbResample, turbMercLat, turbLut, turbColorize,"
    + " gcDistNM, gcPoint, turbProfile, turbBracketHours, turbNearestFl, turbFlOf, turbCellClass, turbSampleProfile, turbEpisodes };";
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
  const { turbValFromCls, turbClsFromVal } = await chargerTurb();
  assert.deepEqual(Array.from(turbValFromCls(Uint8Array.from([0, 1, 2, 3]))), [0, 96, 160, 224]);
  const val = Uint8Array.from([0, 63, 64, 96, 127, 128, 191, 192, 252]);
  assert.deepEqual(Array.from(turbClsFromVal(val)), [0, 0, 1, 1, 1, 2, 2, 3, 3], "seuils par défaut 64/128/192");
  assert.deepEqual(Array.from(turbClsFromVal(val, [50, 100, 200])), [0, 1, 1, 1, 2, 2, 2, 2, 3], "seuils de l'index");
  // L'aller-retour d'une classe retombe sur elle.
  assert.deepEqual(Array.from(turbClsFromVal(turbValFromCls(Uint8Array.from([3, 2, 1, 0])))), [3, 2, 1, 0]);
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

test("turbCellClass : la case du point sur une grille large, la pire des neuf sur une grille fine", async () => {
  const { turbCellClass } = await chargerTurb();
  const coarse = { lat0: 50, lon0: 0, dlat: -1, dlon: 1, nlat: 3, nlon: 3 };
  const cls = Uint8Array.from([0, 3, 0, 0, 1, 0, 0, 0, 0]);
  assert.equal(turbCellClass(coarse, cls, 49, 1), 1, "à 1°, la case seule — la voisine severe n'est pas lue");
  assert.equal(turbCellClass(coarse, cls, 49, 7), -2, "hors grille");
  const fine = { lat0: 50, lon0: 0, dlat: -0.25, dlon: 0.25, nlat: 3, nlon: 3 };
  assert.equal(turbCellClass(fine, cls, 49.75, 0.25), 3, "à 0,25°, la pire des neuf voisines");
  assert.equal(turbCellClass(fine, cls, 50, 0), 3, "au coin : les voisines existantes seulement");
  assert.equal(turbCellClass(fine, cls, 49.5, 0.5), 1, "deux cases plus loin, le severe est hors de portée : seul le light voisin");
  assert.equal(turbCellClass(fine, new Uint8Array(9), 49.75, 0.25), 0, "rien autour : smooth");
});

test("turbSampleProfile : la pire des deux échéances, sous FL100 rien, transitions seules", async () => {
  const { turbSampleProfile, turbProfile, turbNearestFl } = await chargerTurb();
  assert.equal(turbNearestFl([100, 140, 180, 240, 270, 300, 340, 390, 450], 31000), 300);
  // Grille 1° sur le sud-est de la France ; toute la case de LFMN à FL340 est "moderate"
  // à f006 et "severe" à f009 : le rejeu doit retenir severe.
  const grid = { lat0: 50, lon0: 0, dlat: -1, dlon: 1, nlat: 8, nlon: 9 };
  const index = { run: "2026-09-03T00:00Z", hours: [3, 6, 9, 12], grid, fls: [100, 140, 180, 240, 270, 300, 340, 390, 450] };
  const zero = new Uint8Array(72);
  const g6 = new Uint8Array(72), g9 = new Uint8Array(72);
  const cell = (lat, lon) => Math.round((lat - grid.lat0) / grid.dlat) * grid.nlon + Math.round((lon - grid.lon0) / grid.dlon);
  g6[cell(44, 7)] = 2; g9[cell(44, 7)] = 3;
  // La case est marquée à TOUS les niveaux : la descente sur Nice la traverse
  // en changeant de FL, et c'est bien là que le rejeu doit la voir.
  const clsOf = (fl, fh) => fh === 6 ? g6 : fh === 9 ? g9 : zero;
  const prof = turbProfile(372, 34000);
  const tko = Date.parse("2026-09-03T06:00Z");
  const P = turbSampleProfile(prof, LFPG, LFMN, index, tko, index.fls, clsOf);
  assert.equal(P.pts[0].cls, -1, "au décollage, sous FL100");
  assert.equal(P.max, 3, "la case de Nice est lue severe (pire des deux échéances)");
  const sev = P.events.find(e => e.cls === 3);
  assert.ok(sev && sev.fl <= 340 && sev.d > 280, "l'événement severe est à l'approche de Nice : " + JSON.stringify(sev));
  // Chaque événement change de classe par rapport au précédent.
  for (let i = 1; i < P.events.length; i++) assert.notEqual(P.events[i].cls, P.events[i - 1].cls);
  // Hors grille : LFBO → LFPG passe à l'ouest de lon 0 pour partie ? Non — on force une grille minuscule.
  const tiny = { ...index, grid: { lat0: 45, lon0: 6, dlat: -1, dlon: 1, nlat: 2, nlon: 2 } };
  const Q = turbSampleProfile(prof, LFPG, LFMN, tiny, tko, index.fls, () => zero);
  assert.ok(Q.pts.some(p => p.cls === -2), "hors grille signalé");
  // Un fichier qui porte sa propre grille est lu dessus, même si l'index en
  // annonce une autre (cache de bord déphasé) : ici la grille du fichier est
  // décalée d'un degré, la case de Nice est donc (43,6) dans SES indices.
  const own = { lat0: 49, lon0: -1, dlat: -1, dlon: 1, nlat: 8, nlon: 9 };
  const g3 = new Uint8Array(72); g3[Math.round((44 - own.lat0) / own.dlat) * own.nlon + Math.round((7 - own.lon0) / own.dlon)] = 3;
  const R = turbSampleProfile(prof, LFPG, LFMN, index, tko, index.fls, () => ({ cls: g3, grid: own }));
  assert.equal(R.max, 3, "lu sur la grille du fichier, pas sur celle de l'index");
  void LFBO;
});

test("turbEpisodes regroupe les transitions en plages continues de turbulence, aux niveaux du VOL", async () => {
  const { turbEpisodes } = await chargerTurb();
  // `fl` est le niveau LU (le plus proche dans la grille), `alt` l'altitude
  // volée : FL320 tapé, lu au FL300, affiché FL320. Un morceau qui change
  // d'altitude porte ses extrêmes (altMin, altMax).
  const P = { total: 100, dist: 700, events: [
    { t: 0, d: 0, fl: null, alt: 0, cls: -1, lat: 0, lon: 0 },
    { t: 4, d: 17, fl: 100, alt: 9600, cls: 0, lat: 0, lon: 0 },
    { t: 20, d: 120, fl: 300, alt: 32000, cls: 1, lat: 1, lon: 1 },
    { t: 25, d: 160, fl: 300, alt: 32000, cls: 3, lat: 2, lon: 2 },     // même épisode, pire classe
    { t: 30, d: 200, fl: 300, alt: 32000, cls: 1, lat: 3, lon: 3 },
    { t: 40, d: 280, fl: 300, alt: 32000, cls: 0, lat: 0, lon: 0 },     // fin du premier
    { t: 80, d: 600, fl: 240, alt: 24000, altMin: 15200, altMax: 24000, cls: 2, lat: 4, lon: 4 },   // second, en descente, jusqu'à l'atterrissage
  ] };
  const eps = turbEpisodes(P);
  assert.equal(eps.length, 2);
  assert.deepEqual([eps[0].t0, eps[0].t1, eps[0].cls, eps[0].d0, eps[0].d1, eps[0].lat], [20, 40, 3, 120, 280, 2]);
  assert.deepEqual([eps[0].flMin, eps[0].flMax], [320, 320], "le FL320 volé, pas le FL300 lu");
  assert.deepEqual([eps[1].t0, eps[1].t1, eps[1].cls, eps[1].d1, eps[1].flMin, eps[1].flMax], [80, 100, 2, 700, 150, 240], "les altitudes extrêmes du morceau");
});

test("FL320 tapé : la grille est lue au FL300, les cartes disent FL320", async () => {
  const { turbSampleProfile, turbProfile, turbEpisodes, turbFlOf, turbNearestFl } = await chargerTurb();
  const fls = [100, 140, 180, 240, 270, 300, 340, 390, 450];
  assert.equal(turbNearestFl(fls, 32000), 300); assert.equal(turbNearestFl(fls, 36000), 340);
  assert.deepEqual([turbFlOf(32000), turbFlOf(36000), turbFlOf(15250), turbFlOf(9600)], [320, 360, 150, 100], "niveau volé, à la dizaine");
  const grid = { lat0: 50, lon0: 0, dlat: -1, dlon: 1, nlat: 8, nlon: 9 };
  const index = { run: "2026-09-03T00:00Z", hours: [3, 6, 9, 12], grid, fls };
  const light = new Uint8Array(72).fill(1), zero = new Uint8Array(72);
  // Seul le fichier du FL300 est marqué : light dès que le rejeu le lit —
  // fin de montée (≈ 29 000 ft), croisière à 32 000 ft, début de descente.
  const prof = turbProfile(372, 32000);
  assert.equal(prof.top, 32000);
  const P = turbSampleProfile(prof, LFPG, LFMN, index, Date.parse("2026-09-03T06:00Z"), fls, fl => fl === 300 ? light : zero);
  const cruise = P.pts.find(p => p.alt === 32000);
  assert.equal(cruise.fl, 300, "lu au niveau le plus proche de la grille");
  assert.equal(cruise.cls, 1);
  const ev = P.events.find(e => e.cls === 1);
  assert.ok(ev.alt < 32000 && ev.alt > 28500, "l'épisode s'ouvre en fin de montée : " + ev.alt);
  assert.deepEqual([ev.fl, ev.altMax], [300, 32000], "le morceau garde le niveau lu et l'altitude de croisière");
  assert.ok(ev.altMin <= ev.alt, "altMin ≤ altitude d'ouverture");
  const eps = turbEpisodes(P);
  assert.equal(eps.length, 1, JSON.stringify(eps));
  assert.equal(eps[0].flMax, 320, "la carte dit le FL320 volé, pas le FL300 lu");
  assert.equal(eps[0].flMin, 290, "entamé en fin de montée : FL290–320");
});
