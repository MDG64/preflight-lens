// ============================================================
//  Non-régression du rapprochement NOTAM ↔ ref de taxiway.
//
//  Deux façons dont OSM nomme une voie que le NOTAM cite autrement — et dans
//  les deux cas la voie était DESSINÉE ET NOMMÉE sur le plan, mais introuvable
//  à l'index : elle partait en MISS et le bandeau déclarait le fond de carte
//  incomplet alors qu'il ne l'était pas. Pire mensonge que le silence, puisque
//  l'équipage lit alors « la donnée manque » là où elle est sous ses yeux.
//
//   1. pas de tag `ref`, seulement `name=Taxiway B` : le générateur retombe sur
//      le name et stocke la phrase entière. Le NOTAM dit « TWY B ».
//      371 refs sur 63 terrains (LGAV 43, UKBB 30, KROC 23, DTNH 21, EGLL 18).
//   2. un nom en DEUX mots qui n'est pas un préfixe de type : les 20 bretelles
//      d'EGLL s'appellent « Link 35 ». « TWY LINK 35 CLSD » ne produisait
//      AUCUNE ref — l'extracteur cassait sur LINK, quatre lettres.
//   3. l'indicatif encadré de guillemets par le rédacteur — « TWY 'W1', BTN TWY
//      'LM' EXCLUDED AND 'L44' INCLUDED » : le jeton sortait avec ses
//      apostrophes collées et TWY_REF le refusait, NOTAM muet.
//
//  Le test est HERMÉTIQUE : aucun layout du dépôt. Les layouts sont regénérés
//  depuis OSM, où n'importe qui peut ajouter un `ref=B` du jour au lendemain —
//  un test câblé sur EGLL.json passerait au vert sans que le code soit réparé.
//
//  Comme plan-rwy-index.test.mjs : on DÉCOUPE le code réellement déployé dans
//  notam-filter.html, repéré par marqueur textuel et jamais par numéro de
//  ligne. Un test qui recopierait la logique ne prouverait rien.
//
//  Lancer :  node --test "test/*.test.mjs"
// ============================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(HERE, "..", "notam-filter.html"), "utf8").replace(/\r\n/g, "\n");

function decoupe(re, quoi) {
  const m = re.exec(html);
  assert.ok(m, quoi + " introuvable — le marqueur a changé de forme");
  return m[0];
}

/** buildSurfaces() + l'indexation + HEADS + refsFromNotam(), tels qu'ils tournent. */
async function chargerPlan() {
  const src = [
    decoupe(/\/\* refsFromNotam v2[\s\S]*?partial,hit:!!hit\};\n {6}\}/, "refsFromNotam()"),
    decoupe(/function buildSurfaces\(layout\) \{[\s\S]*?\n {4}\}/, "buildSurfaces()"),
    "function plan(features) {",
    "  const SURF = buildSurfaces({ f: features });",
    decoupe(/const INDEX = new Map\(\);[\s\S]*?\n {6}\}\n/, "l'indexation de planBuild()"),
    decoupe(/const HEADS = new Set\(\);[\s\S]*?\n {6}\}/, "les têtes composées de planBuild()"),
    "  return { INDEX, HEADS };",
    "}",
    "export { plan, refsFromNotam };",
  ].join("\n");
  return import("data:text/javascript;base64," + Buffer.from(src).toString("base64"));
}

const twy = r => ({ t: "twy", r, g: [[51.47, -0.45], [51.47, -0.44]] });

/** Le trajet complet : le NOTAM nomme, l'index doit rendre la surface. */
function trouve({ INDEX, HEADS }, texte, refsFromNotam) {
  const refs = refsFromNotam(texte, HEADS);
  const out = new Set();
  for (const r of refs.twy) for (const s of INDEX.get("twy:" + r) || []) out.add(s.r);
  return [...out].sort();
}

test("une voie nommée au long est trouvée par le NOTAM qui l'abrège", async () => {
  const { plan, refsFromNotam } = await chargerPlan();
  // ref OSM observée         → NOTAM qui doit la trouver
  const CAS = [
    ["Taxiway B", "TWY B CLSD"],          // casse mixte : layouts d'avant l'uppercase (EGLL)
    ["TAXIWAY E", "TWY E CLSD"],          // générateur actuel (uppercase)
    ["TAXIWAY A1", "TWY A1 CLSD"],        // indicatif alphanumérique (KROC)
    ["TWY N", "TWY N CLSD"],              // préfixe abrégé dans le name OSM (GMMN)
    ["Taxilane C", "TWY C CLSD"],         // taxilane
  ];
  for (const [ref, notam] of CAS) {
    const p = plan([twy(ref)]);
    assert.deepEqual(trouve(p, notam, refsFromNotam), [ref],
      `« ${notam} » ne trouve pas la voie taguée « ${ref} »`);
  }
});

test("le nom au long reste une clé, et ce qui est dessiné ne change pas", async () => {
  const { plan, refsFromNotam } = await chargerPlan();
  const p = plan([twy("TAXIWAY B")]);
  // un NOTAM peut citer le nom mot pour mot
  assert.deepEqual(trouve(p, "TAXIWAY B CLSD", refsFromNotam), ["TAXIWAY B"]);
  // s.r n'est pas réécrit : c'est lui que planDraw() peint et étiquette
  assert.equal([...p.INDEX.get("twy:B")][0].r, "TAXIWAY B");
});

test("les deux graphies d'une même voie se rejoignent sous l'indicatif", async () => {
  const { plan, refsFromNotam } = await chargerPlan();
  // TBPB, LOWI, KDTW… taguent des tronçons de LA MÊME voie de deux façons.
  // Sans alias, « TWY A CLSD » n'en peignait qu'une moitié.
  const p = plan([twy("A"), twy("Taxiway A")]);
  assert.deepEqual(trouve(p, "TWY A CLSD", refsFromNotam), ["A", "Taxiway A"]);
});

test("une ref en deux mots est lue et retrouvée", async () => {
  const { plan, refsFromNotam } = await chargerPlan();
  const p = plan([twy("Link 35"), twy("Link 36"), twy("Taxiway B")]);
  assert.deepEqual(trouve(p, "TWY LINK 35 CLSD", refsFromNotam), ["Link 35"]);
  assert.deepEqual(trouve(p, "TWY LINK 35 AND LINK 36 CLSD", refsFromNotam), ["Link 35", "Link 36"]);
  // borne de portion : « BTN LINK 35 AND LINK 36 » borne aussi bien que « BTN A3 AND A4 »
  const refs = refsFromNotam("TWY B BTN LINK 35 AND LINK 36 CLSD", p.HEADS);
  assert.deepEqual(refs.partial, [["LINK 35", "LINK 36"]]);
});

test("aucune tête n'est inventée : le vocabulaire vient du terrain", async () => {
  const { plan, refsFromNotam } = await chargerPlan();
  // LINK n'est une tête qu'aux terrains qui ont des refs « Link … »
  const sansLink = plan([twy("A"), twy("B")]);
  assert.deepEqual([...sansLink.HEADS], []);
  assert.deepEqual(trouve(sansLink, "TWY LINK 35 CLSD", refsFromNotam), []);
  // et même là où LINK EST une tête, un mot quelconque suivi d'un nombre n'en
  // devient pas une : « TWY A CLSD DUE WORK 3 » ne doit pas produire « WORK 3 »
  const avecLink = plan([twy("Link 35"), twy("A")]);
  assert.deepEqual([...avecLink.HEADS], ["LINK"]);
  assert.deepEqual(refsFromNotam("TWY A CLSD DUE WORK 3", avecLink.HEADS).twy, ["A"]);
  // une tête SEULE ne désigne rien : il faut le numéro
  assert.deepEqual(refsFromNotam("TWY LINK CLSD", avecLink.HEADS).twy, []);
});

test("les préfixes de type ne deviennent jamais des têtes composées", async () => {
  const { plan, refsFromNotam } = await chargerPlan();
  // « TWY T2 » (GMMN) est traité par l'alias, qui rend l'indicatif seul —
  // pas par le mécanisme des refs en deux mots.
  const p = plan([twy("TWY T2")]);
  assert.deepEqual([...p.HEADS], []);
  assert.deepEqual(trouve(p, "TWY T2 CLSD", refsFromNotam), ["TWY T2"]);
});

test("un mot-clé d'une autre famille ne devient pas une tête", async () => {
  const { plan, refsFromNotam } = await chargerPlan();
  // Sinon « BAY 3 CLSD » se lirait deux fois — comme voie ET comme poste —
  // et peindrait deux surfaces là où le NOTAM n'en nomme qu'une.
  const p = plan([twy("Bay 3"), twy("Apron 2")]);
  assert.deepEqual([...p.HEADS], []);
  assert.deepEqual(refsFromNotam("BAY 3 CLSD", p.HEADS).twy, []);
  assert.deepEqual(refsFromNotam("BAY 3 CLSD", p.HEADS).stand, ["3"]);
});

test("les guillemets du rédacteur n'effacent pas l'indicatif", async () => {
  const { plan, refsFromNotam } = await chargerPlan();
  const p = plan([twy("W1"), twy("LM"), twy("L44")]);
  // Cas réel : chaque ref est citée entre apostrophes, la portion comprise.
  const reel = "TWY 'W1', BTN TWY 'LM' EXCLUDED AND 'L44' INCLUDED, "
             + "LTD TO ACFT WITH A WINGSPAN OF 36M OR LESS";
  assert.deepEqual(trouve(p, reel, refsFromNotam), ["W1"]);
  // et les bornes de la portion se lisent elles aussi malgré les guillemets
  assert.deepEqual(refsFromNotam(reel, p.HEADS).partial, [["LM", "L44"]]);
  // le guillemet double et le chevron valent l'apostrophe
  assert.deepEqual(refsFromNotam('TWY "W1" CLSD', p.HEADS).twy, ["W1"]);
  // la piste passe par la regex, pas par le tokenizer : même filet
  assert.deepEqual(refsFromNotam("RWY '32L' CLSD", p.HEADS).rwy, ["32L"]);
});
