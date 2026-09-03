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
  const src = html.slice(a, b) + "\nexport { turbDecode, turbRuns, turbPickHour };";
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
