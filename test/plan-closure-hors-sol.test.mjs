// ============================================================
//  Non-régression de la porte « fermeture de piste hors sujet sol » du plan
//  d'aérodrome — closesRwyByText() / planClosureRwys().
//
//  Bug réel corrigé le 2026-08-28 (LFPO A2740/26) : le trigger de l'AIP SUP
//  085/26, « Q) LFFF/QPDTT/… E) … DUE TO THE CLOSURE OF RUNWAY 06/24 FROM
//  AUGUST 10 TO DECEMBER 17 … », énonce noir sur blanc une fermeture de
//  quatre mois. La liste le classait bien Critical, mais paintsGround() ne
//  laissait entrer au plan que les Q-codes de famille « sol » : « procédures
//  de départ » n'en est pas, et la 06/24 restait grise sur le plan pendant
//  toute la fermeture. Le Q-code dit de QUOI parle le message ; il ne dit pas
//  quelle surface le message ferme.
//
//  Deux pièges gouvernent le correctif, et ce fichier les fixe tous les deux :
//
//  1. LA TOURNURE. Seule la forme TÊTE-PREMIÈRE est lue — « CLSD RWY nn »,
//     « CLOSURE OF RUNWAY nn », la piste en objet direct du mot de fermeture.
//     La forme inverse (« RWY nn … CLSD ») se laisse voler son sujet par ce
//     qui la précède : mesurée sur 251 terrains, elle aurait peint des pistes
//     OUVERTES à JFK, Zurich et Heathrow (cas ci-dessous). Ces trois-là sont
//     déjà des NOTAM sol : ils entrent au plan par la porte normale, avec les
//     refs de refsFromNotam(), et n'ont aucun besoin de celle-ci.
//     Même règle, mêmes exemples que le détecteur de drapeaux de minima.html
//     (voir minima-notam-flags.test.mjs) : les deux apps doivent fermer la
//     même piste sur le même message.
//
//  2. LES REFS. Le NOTAM entré par cette porte n'apporte QUE les pistes de sa
//     clause de fermeture. planKind() vaut pour le MESSAGE ENTIER : lire tout
//     l'item E) d'Orly peindrait en rouge la 25 et la 20 — les pistes qu'on
//     utilise À LA PLACE — en même temps que la 06/24.
//
//  Mesure du 2026-08-28 sur 251 terrains / 7582 NOTAM : deux messages passent
//  cette porte, LFPO A2740/26 et LHBP A5758/26, tous deux à bon droit.
//
//  Comme classify.test.mjs et plan-kind.test.mjs : on DÉCOUPE le code
//  réellement déployé dans notam-filter.html, repéré par marqueur textuel et
//  jamais par numéro de ligne — un test qui recopierait la logique ne
//  prouverait rien.
//
//  Lancer :  node --test test/*.test.mjs
// ============================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(HERE, "..", "notam-filter.html"), "utf8").replace(/\r\n/g, "\n");

/** La porte du plan et tout ce dont elle dépend, extraits tels qu'ils tournent. */
async function chargerPorte() {
  const motifs = {
    SUBJECT_CATEGORIES: /const SUBJECT_CATEGORIES = (\{[\s\S]*?\n {4}\});/,
    FAMILY_DEFAULT: /const FAMILY_DEFAULT = (\{[\s\S]*?\n {4}\});/,
    PLAN_RWY_CLSD_RE: /const PLAN_RWY_CLSD_RE = (\/.*\/g);/,
  };
  const src = Object.entries(motifs).map(([nom, re]) => {
    const m = re.exec(html);
    assert.ok(m, `${nom} introuvable dans notam-filter.html`);
    return `const ${nom} = ${m[1]};`;
  });
  for (const nom of ["qcodeParts", "categoriesFromQcode", "planClosureRwys",
                     "closesRwyByText", "paintsGround"]) {
    const re = new RegExp(`function ${nom}\\([^)]*\\) \\{[\\s\\S]*?\\n {4}\\}`);
    const m = re.exec(html);
    assert.ok(m, `function ${nom}() introuvable dans notam-filter.html`);
    src.push(m[0]);
  }
  src.push("export { planClosureRwys, closesRwyByText, paintsGround };");
  return import("data:text/javascript;base64," + Buffer.from(src.join("\n")).toString("base64"));
}

/** Un NOTAM réduit à ce que la porte lit : son Q-code et son item E). */
const n = (qcode, e) => ({ qcode, e, categories: [] });

test("le trigger d'Orly ferme la 06/24 — et elle seule", async () => {
  const { planClosureRwys, closesRwyByText, paintsGround } = await chargerPorte();
  const a2740 = n("QPDTT",
    "TRIGGER NOTAM - AIRAC AIP SUP 085/26.\n" +
    "AD PARIS ORLY (LFPO) : DUE TO THE CLOSURE OF RUNWAY 06/24 FROM \n" +
    "AUGUST 10 TO DECEMBER 17, TEMPORARY APPROACH PROCEDURES ON RUNWAY 25 \n" +
    "AND DEPARTURE PROCEDURES ON RUNWAY 20 ARE IMPLEMENTED.\n" +
    "PROCEDURES WILL BE SUSPENDED BY NOTAM.");
  assert.deepEqual(planClosureRwys(a2740), ["06", "24"],
    "la 25 et la 20 sont les pistes de REPLI : les peindre serait pire que le silence");
  assert.equal(closesRwyByText(a2740), true, "QPDTT n'est pas « sol » : c'est bien cette porte-ci");
  assert.equal(paintsGround(a2740), true, "le plan doit le recevoir");
});

test("une fermeture citée comme CAUSE ferme quand même la piste (LHBP A5758/26)", async () => {
  const { planClosureRwys, closesRwyByText } = await chargerPorte();
  const a5758 = n("QFALT",
    "OPERATION OF ACFT WITH WINGSPAN AT OR ABOVE 70M NOT ALLOWED DUE \nTO CLOSURE OF RWY 13L/31R.");
  // Aucun autre NOTAM de LHBP ne portait cette fermeture le 2026-08-28 : sans
  // cette porte, le plan n'en savait rien du tout.
  assert.deepEqual(planClosureRwys(a5758), ["13L", "31R"]);
  assert.equal(closesRwyByText(a5758), true, "QFALT est classé « vol », pas « sol »");
});

test("la tournure inverse n'ouvre jamais cette porte", async () => {
  const { planClosureRwys } = await chargerPorte();
  const MUETS = [
    // Heathrow A3024/26 : la grue ne travaille QUE piste fermée — elle ne la ferme pas.
    ["LIT CRANE OPR AT PSN 512800N 0002601W (HEATHROW AD). MAX HGT 33FT AGL. WILL ONLY OPR WHEN RWY 09R/27L CLSD"],
    // JFK 08/291 et Zurich A0611/26 : c'est la voie, la sortie, qui est fermée.
    ["TWY FB BTN RWY 04L/22R AND RWY 04R/22L CLSD"],
    ["EXIT TWY E5 AND TWY B EAST FM RWY 16/34 CLSD DUE TO WIP. AREA MARKED AND LGTD."],
    // Équipement : c'est l'installation qui tombe, pas la surface.
    ["ILS RWY 02 U/S"],
    ["ILS RWY 06 CLSD"],
    // Procédures suspendues : aucune piste fermée.
    ["AIRAC AIP SUP 085/26 - ARRIVAL PROCEDURES SUSPENDED : QFU 25 : - IAC FNA ILS CAT123 RWY25"],
    // Une fermeture seulement POSSIBLE n'en est pas une.
    ["RWY 09R/27L SURFACE INSPECTION, SHORT NOTICE CLOSURES POSSIBLE"],
  ];
  const ecarts = [];
  for (const [e] of MUETS) {
    const obtenu = planClosureRwys(n("QMXLC", e));
    if (obtenu.length) ecarts.push(`${e.slice(0, 60)}… → ${JSON.stringify(obtenu)}`);
  }
  assert.deepEqual(ecarts, [], "ces textes ne ferment aucune piste par eux-mêmes");
});

test("un NOTAM « sol » garde la porte normale, refs de refsFromNotam comprises", async () => {
  const { closesRwyByText, paintsGround } = await chargerPorte();
  const sol = n("QMRLC", "RWY 14L/32R CLSD DUE TO RESURFACING WIP");
  assert.equal(paintsGround(sol), true, "il entrait déjà, il entre toujours");
  assert.equal(closesRwyByText(sol), false,
    "sinon planBuild lui retirerait les refs que refsFromNotam sait lire pour lui");
  // Et la porte reste fermée à ce qui n'énonce aucune fermeture de piste.
  assert.equal(paintsGround(n("QPDTT", "TRIGGER NOTAM - AIRAC AIP SUP 192/26.")), false);
});
