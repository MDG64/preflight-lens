// ============================================================
//  Les items d'un NOTAM se lisent dans l'ordre, et « X) » au fil du texte
//  n'est pas un item.
//
//  La seule forme « X) » ne suffit pas à reconnaître un item : elle apparaît
//  aussi dans les textes, et deux dégâts en découlaient.
//
//  1. UN ITEM INVENTÉ — LFPO A3704/26 n'a pas de champ D), mais son item E)
//     contient « ... SEQUENCING SYSTEM (GLD) : THE DEPARTURE ... ». Le « D) »
//     de « (GLD) » était lu comme l'item D) et la carte affichait un horaire
//     « Schedule : THE DEPARTURE SEQUENCING ALGORITHM ... ».
//  2. UN ITEM TRONQUÉ — LTAL G1813/14 énumère « ... 1676FT (CAT D) VIS:3800M
//     ... » : ce « D) »-là est précédé d'une espace, donc il coupait AUSSI
//     l'item E). Les valeurs de visibilité disparaissaient du texte pour
//     réapparaître en faux horaire.
//  3. UN CORPS DUPLIQUÉ — la source recopie parfois le message entier dans son
//     propre item E) (KBNA A4288/26). La carte n'affichait que l'écho
//     d'en-tête et PERDAIT « TWY G4 CLSD CANCELED ».
//
//  Relevé du 2026-08-22 sur 20 026 NOTAM réels (7767 européens, 12 259
//  ailleurs) : 318 items D) inventés, 186 items E) tronqués, 1805 corps
//  dupliqués. Aucun champ raccourci à tort.
//
//  Comme les autres tests du dossier : on DÉCOUPE le code réellement déployé
//  dans notam-filter.html, repéré par marqueur textuel et jamais par numéro
//  de ligne.
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

async function chargerParseNotam() {
  const ordre = /const ITEM_ORDRE = ("[A-Z]+");/.exec(html);
  assert.ok(ordre, "ITEM_ORDRE introuvable dans notam-filter.html");
  const cancel = /const CANCEL_HEAD_RE = (\/.*\/);/.exec(html);
  assert.ok(cancel, "CANCEL_HEAD_RE introuvable dans notam-filter.html");
  const fns = ["cleanHtml", "itemMarkers", "field", "innerBody", "unwrapOriginalNotam", "parseNotam"].map(nom => {
    const re = new RegExp(`function ${nom}\\([^)]*\\) \\{[\\s\\S]*?\\n {4}\\}`);
    const m = re.exec(html);
    assert.ok(m, `function ${nom}() introuvable dans notam-filter.html`);
    return m[0];
  });
  const src = ["const ITEM_ORDRE = " + ordre[1] + ";",
               "const CANCEL_HEAD_RE = " + cancel[1] + ";",
               ...fns, "export { parseNotam };"].join("\n");
  return import("data:text/javascript;base64," + Buffer.from(src).toString("base64"));
}

test("un « X) » collé à un mot n'ouvre pas un item", async () => {
  const { parseNotam } = await chargerParseNotam();
  // LFPO A3704/26 : le « D) » de « (GLD) ».
  const n = parseNotam(
    "A3704/26 NOTAMN\nQ) LFFF/QCDXX/I /NBO/A /000/999/4843N00223E005\n" +
    "A) LFPO B) 2606080700 C) PERM\n" +
    "E) IMPLEMENTATION OF A NEW DEPARTURE SEQUENCING SYSTEM (GLD) : THE\n" +
    "DEPARTURE SEQUENCING ALGORITHM AND TSAT CALCULATION ARE MODIFIED.");
  assert.equal(n.d, "", "aucun horaire ne doit être inventé");
  assert.match(n.e, /^IMPLEMENTATION OF A NEW DEPARTURE/);
  assert.match(n.e, /TSAT CALCULATION ARE MODIFIED\.$/, "l'item E) va jusqu'au bout");
});

test("un « X) » hors séquence ne coupe pas l'item en cours", async () => {
  const { parseNotam } = await chargerParseNotam();
  // LTAL G1813/14 : « (CAT D) » APRÈS le E), donc du texte, pas un item.
  const n = parseNotam(
    "G1813/14 NOTAMN\nQ) LTAA/QINXX/I /NBO/A /000/999/4119N03348E005\n" +
    "A) LTAL B) 1405010001 C) PERM\n" +
    "E) KASTAMONU MINIMA :\nCIRCLE TO LAND: MDH:976 FT (CAT A/B/C), 1676FT (CAT D)\n" +
    "VIS:3800M (CAT A/B),4500M (CAT C), 5000M (CAT D)");
  assert.equal(n.d, "");
  assert.match(n.e, /VIS:3800M/, "les valeurs de visibilité restent dans le texte");
});

test("un vrai item D) est toujours lu", async () => {
  const { parseNotam } = await chargerParseNotam();
  // Garde-fou : la règle d'ordre ne doit pas faire disparaître les horaires réels.
  const n = parseNotam(
    "L3107/26 NOTAMN\nQ) EGTT/QOBCE/IV/M  /AE/000/004/5312N00303W001\n" +
    "A) EGNR B) 2605260700 C) 2608261900\nD) 0700-1900\n" +
    "E) LIT CRANE OPR PSN 531138N 0030258W.");
  assert.equal(n.d, "0700-1900");
  assert.equal(n.e, "LIT CRANE OPR PSN 531138N 0030258W.");
});

test("un corps recopié dans son propre item E) livre le texte utile", async () => {
  const { parseNotam } = await chargerParseNotam();
  // KBNA A4288/26 : le message entier est repris dans son item E).
  const n = parseNotam(
    "A4288/26 NOTAMC A3937/26\nQ) KZME/QMXXX////000/999/3607N08640W005\n" +
    "A) KBNA\nB) 2608181739\n" +
    "E) A4288/26 NOTAMC A3937/26\nQ) KZME/QMXXX////000/999/3607N08640W005\n" +
    "A) KBNA\nB) 2608181739\nE) TWY G4 CLSD CANCELED");
  assert.equal(n.id, "A4288/26");
  assert.equal(n.e, "TWY G4 CLSD CANCELED");
});

test("un NOTAM qui CITE un autre message garde son propre texte", async () => {
  const { parseNotam } = await chargerParseNotam();
  // Garde-fou du précédent : la reprise ne s'applique QUE si l'item E)
  // commence par l'identifiant du NOTAM lui-même. Un déclencheur qui cite un
  // AUTRE numéro ne doit pas être dépiauté.
  const n = parseNotam(
    "A5412/26 NOTAMR A4247/26\nQ) LFFF/QFATT/IV/BO /A /000/999/4843N00223E005\n" +
    "A) LFPO B) 2608211434 C) 2609302359\n" +
    "E) TRIGGER NOTAM - AIRAC AIP SUP 147/26 MODIFIED.");
  assert.equal(n.e, "TRIGGER NOTAM - AIRAC AIP SUP 147/26 MODIFIED.");
});
