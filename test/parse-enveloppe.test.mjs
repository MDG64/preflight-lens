// ============================================================
//  Un NOTAM emballé garde son identifiant.
//
//  Certaines sources republient un NOTAM À L'INTÉRIEUR d'un message qui le
//  cite : un en-tête, les mots « ORIGINAL NOTAM », une parenthèse ouvrante,
//  puis le NOTAM entier. L'identifiant n'étant plus en tête, parseNotam() le
//  cherchait en vain et la carte s'affichait « (sans id) » — introuvable pour
//  qui parcourt la liste en cherchant un numéro, alors que le NOTAM est bien
//  là. La parenthèse fermante de l'emballage restait collée à l'item E).
//
//  Cas déclencheur LFPO A4935/26, mais le relevé du 2026-08-22 sur 7767 NOTAM
//  de 1248 terrains européens en comptait 126 : 145 cartes sans identifiant,
//  dont 126 dues à cet emballage. Après correction il en reste 19, tous des
//  SNOWTAM — un format qui n'a pas d'identifiant NOTAM, c'est normal.
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
  const fns = ["cleanHtml", "field", "unwrapOriginalNotam", "parseNotam"].map(nom => {
    const re = new RegExp(`function ${nom}\\([^)]*\\) \\{[\\s\\S]*?\\n {4}\\}`);
    const m = re.exec(html);
    assert.ok(m, `function ${nom}() introuvable dans notam-filter.html`);
    return m[0];
  });
  const src = [...fns, "export { parseNotam };"].join("\n");
  return import("data:text/javascript;base64," + Buffer.from(src).toString("base64"));
}

// Le cas réel, tel que le proxy le sert — en-tête EUROCONTROL compris.
const LFPO_A4935 =
  "250646 EUECYIYN\n NOTAM REPLACED BY A5141/26\n ORIGINAL NOTAM\n (A4935/26 NOTAMN\n" +
  " Q) LFFF/QMRLT/IV/NBO/A /000/999/4843N00223E005\n" +
  " A) LFPO B) 2608010330 C) 2610312359\n" +
  " E) RWY 02/20 RESTRICTION DUE TO OBSTACLE :\nLDG RWY 20 PROHIBITED FOR ACFT WHICH WINGSPAN EXCEEDS 36M.)";

// La forme majoritaire : « ORIGINAL NOTAM » seul, sans avis de remplacement.
const EDAH_B0486 =
  "ORIGINAL NOTAM\n (B0486/26 NOTAMN\n" +
  " Q) EDWW/QWPLW/IV/M  /AW/000/135/5353N01409E002\n" +
  " A) EDAH B) 2606250233 C) 2608301759\n D) DAILY SR-SS\n" +
  " E) PJE 2NM RADIUS CENTERED ON 535243N 0140908E, HERINGSDORF.)";

test("l'identifiant du NOTAM emballé est retrouvé, sous ses deux rédactions", async () => {
  const { parseNotam } = await chargerParseNotam();
  assert.equal(parseNotam(LFPO_A4935).id, "A4935/26");
  assert.equal(parseNotam(EDAH_B0486).id, "B0486/26");
});

test("les items du NOTAM emballé se lisent comme ceux d'un NOTAM nu", async () => {
  const { parseNotam } = await chargerParseNotam();
  const n = parseNotam(LFPO_A4935);
  assert.equal(n.qcode, "QMRLT");
  assert.equal(n.a, "LFPO");
  assert.equal(n.b, "2608010330");
  assert.equal(n.c, "2610312359");
  // La fermante de l'emballage ne colle plus au texte.
  assert.equal(n.e, "RWY 02/20 RESTRICTION DUE TO OBSTACLE : LDG RWY 20 PROHIBITED FOR ACFT WHICH WINGSPAN EXCEEDS 36M.");
  assert.equal(parseNotam(EDAH_B0486).d, "DAILY SR-SS");
});

test("une parenthèse qui appartient au texte reste au texte", async () => {
  const { parseNotam } = await chargerParseNotam();
  // On ne retire la fermante que si elle est EN TROP. Ici elle ferme une
  // ouvrante du texte lui-même : la retirer mutilerait le message.
  const equilibre =
    "ORIGINAL NOTAM\n (C2521/26 NOTAMN\n Q) EDWW/QOBCE/IV/M  /AE/000/001/5323N00714E001\n" +
    " A) EDWE B) 2606070000 C) 2609302359\n E) CRANE ERECTED 300M SE ARP (DAY AND NIGHT MARKED)";
  const n = parseNotam(equilibre);
  assert.equal(n.id, "C2521/26");
  assert.equal(n.e, "CRANE ERECTED 300M SE ARP (DAY AND NIGHT MARKED)");
});

test("un NOTAM nu n'est pas touché, parenthèse initiale comprise", async () => {
  const { parseNotam } = await chargerParseNotam();
  // Garde-fou : on coupe sur les mots « ORIGINAL NOTAM », jamais sur la seule
  // parenthèse ouvrante — le format US en encadre le message entier, et ces
  // NOTAM-là étaient déjà lus correctement.
  const us = "(A0052/26 NOTAMN\n Q) HSSS/QFAXX/IV/NBO/A /000/999/1535N03233E005\n" +
             " A) HSSS B) 2601010000 C) PERM\n E) NO AIR TFC CONTROL SVC AVBL.)";
  assert.equal(parseNotam(us).id, "A0052/26");
  const nu = "A1234/26 NOTAMN\n Q) LFFF/QMRLC/IV/NBO/A /000/999/4843N00223E005\n" +
             " A) LFPO B) 2608010330 C) 2610312359\n E) RWY 06/24 CLSD.";
  const n = parseNotam(nu);
  assert.equal(n.id, "A1234/26");
  assert.equal(n.e, "RWY 06/24 CLSD.");
});

test("une fermante doublée par la source ne laisse pas de reste", async () => {
  const { parseNotam } = await chargerParseNotam();
  // Cas réel LFBI B1634/26 : le message se termine par « )) ». Une seule passe
  // en laissait une derrière elle, collée au texte — d'où la boucle.
  const double =
    "ORIGINAL NOTAM\n (B1634/26 NOTAMN\n Q) LFBB/QCAXX/V /BO /AE/000/115/4627N00051E068\n" +
    " A) LFBI B) 2604171007 C) PERM\n E) FREQ INFO ON THE 1:500,000 MAP :\n" +
    "IGNORE THE FREQ 127.675MHZ OUTSIDE POITIERS ATS HOURS.))";
  const n = parseNotam(double);
  assert.equal(n.id, "B1634/26");
  assert.equal(n.e, "FREQ INFO ON THE 1:500,000 MAP : IGNORE THE FREQ 127.675MHZ OUTSIDE POITIERS ATS HOURS.");
});
