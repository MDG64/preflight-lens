// ============================================================
//  Revalidation en arrière-plan : c'est la COMPARAISON qui décide.
//
//  Le cache local était un court-circuit — moins d'une heure, l'app affichait
//  et n'interrogeait pas le réseau. Constaté le 2026-08-22 : LFPO A5412/26
//  était arrivé dans le proxy, l'écran montrait encore une copie de 54 min.
//  Désormais on affiche la copie puis on va voir derrière ; et c'est
//  memeListe() qui décide s'il s'est passé quelque chose.
//
//  Deux erreurs coûteraient cher, dans deux sens opposés :
//  - dire « identique » à tort ferait rater un NOTAM neuf, ce que tout ce
//    travail cherche justement à empêcher ;
//  - dire « différent » à tort repeindrait l'écran ou lèverait un bandeau pour
//    rien — et repeindre remet les filtres à zéro sous les doigts du lecteur.
//
//  L'ordre ne compte PAS : la source peut renvoyer la même liste autrement
//  rangée, et l'affichage retrie de toute façon par sévérité.
//
//  Lancer :  node --test test/
// ============================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(HERE, "..", "notam-filter.html"), "utf8").replace(/\r\n/g, "\n");

async function chargerComparaison() {
    const re = new RegExp(`function memeListe\\([^)]*\\) \\{[\\s\\S]*?\\n {4}\\}`);
  const m = re.exec(html);
  assert.ok(m, "function memeListe() introuvable dans notam-filter.html");
  return import("data:text/javascript;base64," +
    Buffer.from(m[0] + "\nexport { memeListe };").toString("base64"));
}

const A = "A0001/26 NOTAMN Q) LFFF/QMRLC A) LFPO E) RWY 06/24 CLSD";
const B = "A0002/26 NOTAMN Q) LFFF/QMXLC A) LFPO E) TWY W4 CLSD";
const C = "A5412/26 NOTAMR Q) LFFF/QFATT A) LFPO E) TRIGGER NOTAM";

test("deux listes identiques ne déclenchent rien", async () => {
  const { memeListe } = await chargerComparaison();
  assert.equal(memeListe([A, B], [A, B]), true);
  assert.equal(memeListe([], []), true);
});

test("l'ordre ne compte pas : la liste retriée reste la même", async () => {
  const { memeListe } = await chargerComparaison();
  // Cas réel : l'amont ne garantit pas l'ordre, et la liste est de toute façon
  // retriée par sévérité à l'affichage. Repeindre pour un ordre changé
  // effacerait le filtre du lecteur sans qu'un seul NOTAM ait bougé.
  assert.equal(memeListe([A, B], [B, A]), true);
});

test("un NOTAM en plus est vu — c'est tout l'objet du mécanisme", async () => {
  const { memeListe } = await chargerComparaison();
  assert.equal(memeListe([A, B], [A, B, C]), false);   // A5412/26 arrive
  assert.equal(memeListe([A, B, C], [A, B]), false);   // et le cas inverse : un NOTAM levé
});

test("un NOTAM remplacé par un autre est vu, à nombre égal", async () => {
  const { memeListe } = await chargerComparaison();
  // Le piège du comptage seul : autant d'éléments, contenu différent. Cas réel
  // LFPO, A4247/26 remplacé par A5412/26 le 2026-08-21.
  assert.equal(memeListe([A, B], [A, C]), false);
});

test("ce qui n'est pas une liste ne passe jamais pour identique", async () => {
  const { memeListe } = await chargerComparaison();
  // Une réponse absente ou malformée ne doit pas se faire prendre pour « rien
  // n'a changé » : le doute se tranche du côté qui ne perd pas de NOTAM.
  assert.equal(memeListe(null, [A]), false);
  assert.equal(memeListe([A], null), false);
  assert.equal(memeListe(undefined, undefined), false);
});
