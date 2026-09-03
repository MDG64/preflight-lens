// ============================================================
//  Grille de turbulence : décodage RLE, fusion en rectangles, choix de
//  l'échéance. Même procédé que classify.test.mjs : la section vit dans le
//  <script> de notam-filter.html entre deux marqueurs textuels, on la
//  découpe et on l'évalue seule — aucun DOM n'y est touché.
//
//  Lancer :  node --test test/
// ============================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(HERE, "..", "notam-filter.html"), "utf8");

async function chargerTurb() {
  const a = html.indexOf("// [turb-decode]"), b = html.indexOf("// [/turb-decode]");
  assert.ok(a >= 0 && b > a, "marqueurs [turb-decode] introuvables");
  const c = html.indexOf("// [turb-profile]"), d = html.indexOf("// [/turb-profile]");
  assert.ok(c >= 0 && d > c, "marqueurs [turb-profile] introuvables");
  const src = html.slice(a, b) + "\n" + html.slice(c, d)
    + "\nexport { turbDecode, turbRuns, turbPickHour, gcDistNM, gcPoint, turbProfile, turbBracketHours, turbNearestFl, turbSampleProfile, turbEpisodes };";
  return import("data:text/javascript;base64," + Buffer.from(src).toString("base64"));
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

test("turbRuns fusionne les cases voisines d'une même ligne et centre les cases", async () => {
  const { turbRuns, turbDecode } = await chargerTurb();
  const g = { lat0: 50, lon0: 0, dlat: -0.25, dlon: 0.25, nlat: 2, nlon: 5 };
  const runs = turbRuns(g, turbDecode({ nlat: 2, nlon: 5, rle: [0, 2, 1, 3, 2, 1, 0, 4] }));
  // Deux rectangles : (ligne 0, colonnes 2..4, light) et (ligne 1, colonne 0, moderate).
  assert.equal(runs.length, 10);
  assert.deepEqual(Array.from(runs.slice(0, 5)), [50.125, 49.875, 0.375, 1.125, 1]);
  assert.deepEqual(Array.from(runs.slice(5, 10)), [49.875, 49.625, -0.125, 0.125, 2]);
});

test("turbRuns sépare deux classes contiguës", async () => {
  const { turbRuns } = await chargerTurb();
  const g = { lat0: 0, lon0: 0, dlat: -1, dlon: 1, nlat: 1, nlon: 4 };
  const runs = turbRuns(g, Uint8Array.from([1, 1, 3, 3]));
  assert.equal(runs.length, 10);
  assert.equal(runs[4], 1); assert.equal(runs[9], 3);
  assert.equal(runs[3], runs[7], "les deux rectangles se touchent sans trou");
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
});
