// ============================================================
//  Repères sous la barre de la page Turbulence : les minutes rondes où en
//  poser un, et le tri sur largeurs MESURÉES qui empêche deux libellés de
//  se chevaucher — le cas vu à l'écran : « H+1:00 » sous « H+1:10 » sur un
//  vol de 70 min, écran de téléphone. Même procédé que turb-grid.test.mjs :
//  la section vit dans le <script> de notam-filter.html entre deux
//  marqueurs textuels, on la découpe et on l'évalue seule — aucun DOM.
//
//  Lancer :  node --test test/*.test.mjs
// ============================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(HERE, "..", "notam-filter.html"), "utf8");

async function chargerTicks() {
  const a = html.indexOf("// [turb-ticks]"), b = html.indexOf("// [/turb-ticks]");
  assert.ok(a >= 0 && b > a, "marqueurs [turb-ticks] introuvables");
  const src = html.slice(a, b) + "\nexport { turbTickMinutes, turbTickKeep };";
  return import("data:text/javascript;base64," + Buffer.from(src).toString("base64"));
}

// Les boîtes telles que le navigateur les mesure : une barre de `w` pixels,
// des libellés de `lbl` pixels, le premier calé à gauche, le dernier à
// droite, ceux du milieu centrés sur leur minute.
function boites(minutes, total, w, lbl) {
  return [[0, lbl], ...minutes.map(m => { const x = m / total * w; return [x - lbl / 2, x + lbl / 2]; }), [w - lbl, w]];
}

test("turbTickMinutes : le pas le plus fin qui laisse `max` repères au plus, sans l'arrivée", async () => {
  const { turbTickMinutes } = await chargerTicks();
  assert.deepEqual(turbTickMinutes(70, 4), [20, 40, 60]);           // 70 / 20 = 3,5 ≤ 4
  assert.deepEqual(turbTickMinutes(70, 6), [15, 30, 45, 60]);       // 70 / 15 = 4,7 ≤ 6
  assert.deepEqual(turbTickMinutes(60, 6), [10, 20, 30, 40, 50]);   // la minute de l'arrivée n'y est pas
  assert.deepEqual(turbTickMinutes(132, 6), [30, 60, 90, 120]);
  assert.deepEqual(turbTickMinutes(3, 6), []);                      // plus court que le pas le plus fin
  assert.deepEqual(turbTickMinutes(2200, 6), [480, 960, 1440, 1920]); // au-delà de la liste : 480
});

test("turbTickKeep : sur un écran étroit, H+1:00 s'efface sous H+1:10 ; sur un large, tout tient", async () => {
  const { turbTickMinutes, turbTickKeep } = await chargerTicks();
  // La capture : vol de 70 min, barre de 362 px, libellés de 40 px, quatre repères.
  const etroit = boites(turbTickMinutes(70, 4), 70, 362, 40);
  assert.deepEqual(turbTickKeep(etroit, 8), [0, 1, 2, 4]);          // H+0, H+20, H+40, H+1:10
  // Un écran large, six repères : rien ne mord.
  const large = boites(turbTickMinutes(70, 6), 70, 732, 40);
  assert.deepEqual(turbTickKeep(large, 8), [0, 1, 2, 3, 4, 5]);
});

test("turbTickKeep : jamais deux libellés qui se touchent, le premier et le dernier toujours", async () => {
  const { turbTickKeep } = await chargerTicks();
  // Six libellés de 40 px serrés sur 200 px.
  const serre = [[0, 40], [30, 70], [70, 110], [110, 150], [150, 190], [160, 200]];
  const keep = turbTickKeep(serre, 8);
  assert.deepEqual(keep, [0, 2, 5]);
  for (let i = 1; i < keep.length; i++) {
    assert.ok(serre[keep[i]][0] >= serre[keep[i - 1]][1] + 8, `les libellés ${keep[i - 1]} et ${keep[i]} se touchent`);
  }
  // Un repère du milieu qui mord sur le PREMIER s'efface aussi.
  assert.deepEqual(turbTickKeep([[0, 40], [20, 60], [100, 140], [160, 200]], 8), [0, 2, 3]);
  // Moins de trois : rien à trier.
  assert.deepEqual(turbTickKeep([[0, 40], [100, 140]], 8), [0, 1]);
  assert.deepEqual(turbTickKeep([[0, 40]], 8), [0]);
  assert.deepEqual(turbTickKeep([], 8), []);
});
