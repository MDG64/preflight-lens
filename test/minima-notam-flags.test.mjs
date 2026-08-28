// ============================================================
//  Non-régression du détecteur NOTAM → drapeaux de minima.html
//  (chantier « notam/minima » du 2026-08-28, granularité par
//  extrémité le soir même).
//
//  Une piste fermée ou une approche U/S détectée dans les NOTAM du terrain
//  coche automatiquement les interrupteurs du contrat nfGet — la piste passe
//  NO GO, les lignes ILS/LOC sont écartées du choix d'approche DU QFU VISÉ
//  seulement : un ILS 26L HS laisse le 08R garder son CAT III. Le pilote
//  garde le dernier mot : décocher un drapeau auto est retenu par NOTAM
//  (dis), cocher à la main survit aux refetch (man).
//
//  Cas réels fondateurs : LFPO A2740/26 — « DUE TO THE CLOSURE OF RUNWAY
//  06/24 » (RUNWAY en toutes lettres, invisible du regex RWY du plan de
//  notam-filter.html) ; KJFK 2026-08-28 — les NOTAMC « RWY 04L/22R CLSD
//  CAN » qui auraient fermé les quatre pistes, et « NAV ILS RWY 04R IM
//  U/S » qui n'est qu'un marqueur.
//
//  Comme classify.test.mjs et plan-kind.test.mjs : on DÉCOUPE le code
//  réellement déployé dans minima.html, repéré par marqueur textuel et
//  jamais par numéro de ligne — un test qui recopierait la logique ne
//  prouverait rien. runwayList() (la base terrains) est le seul point
//  extérieur au détecteur : le test fournit la sienne.
//
//  Lancer :  node --test test/
// ============================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(HERE, "..", "minima.html"), "utf8").replace(/\r\n/g, "\n");

/** Le détecteur et son cycle de vie, extraits tels qu'ils tournent. */
async function chargerDetecteur() {
  const CONSTS = [
    "NFA_OUT_CONDS", "NFA_ILS_SUBJ", "NFA_ALS_SUBJ", "NFA_CLOSED_WORDS",
    "NFA_OTS_RE", "NFA_RESUME_RE", "NFA_RESTRICT_RE", "NFA_ILS_TXT_RE",
    "NFA_ALS_TXT_RE", "NFA_AD_CLSD_RE", "NFA_MARKER_US_RE", "NFA_RWY_REF_RE",
    "NFA_RWY_CLSD_RE", "NFA_CLSD_RWY_RE", "NFA_LOOKAHEAD_MS", "NFA_DAYS",
  ].map(nom => {
    const m = new RegExp(`^const ${nom} = (.+);$`, "m").exec(html);
    assert.ok(m, `const ${nom} introuvable dans minima.html`);
    return `const ${nom} = ${m[1]};`;
  });
  // Fonctions sur plusieurs lignes : accolade fermante en colonne 0.
  const FNS = ["nfaItems", "nfaTs", "nfaSchedActiveAt", "nfaActiveIn",
               "nfaPairsOf", "nfaEndsFor", "nfaDetect", "nfGet", "nfEndsOf",
               "nfIlsOut", "nfAlsOut", "nfEntry", "nfUserSetEnd",
               "nfUserToggleRwy", "nfaApply"].map(nom => {
    const re = new RegExp(`function ${nom}\\([^)]*\\)\\{[\\s\\S]*?\\n\\}`);
    const m = re.exec(html);
    assert.ok(m, `function ${nom}() introuvable dans minima.html`);
    return m[0];
  });
  // nfaDesigs tient sur une ligne : sa fermante est sur la même ligne.
  const one = /^function nfaDesigs\(s\)\{.*\}$/m.exec(html);
  assert.ok(one, "function nfaDesigs() introuvable dans minima.html");
  // La base terrains du test remplace runwayList() ; nfStore/nfSave, le
  // sessionStorage. Rien d'autre ne sort du module découpé.
  const STUBS = `
const TEST_RWYS = { LFPG:["08L/26R","08R/26L","09L/27R","09R/27L"], LFPO:["02/20","06/24","07/25"], LFAB:["13/31"] };
function runwayList(icao){ return TEST_RWYS[icao] || []; }
const nfStore = {};
function nfSave(){}
function nfSeed(icao, e){ nfStore[icao] = e; }
`;
  const src = [...CONSTS, one[0], ...FNS, STUBS,
    "export { nfaDetect, nfaActiveIn, nfaItems, nfGet, nfIlsOut, nfAlsOut, nfEntry, nfUserSetEnd, nfUserToggleRwy, nfaApply, nfSeed };"].join("\n");
  return import("data:text/javascript;base64," + Buffer.from(src).toString("base64"));
}

// Horloge figée : 2026-08-28 10:00Z. Les items B)/C) des cas s'écrivent
// autour d'elle — le test ne dépend pas du jour où il tourne.
const NOW = Date.UTC(2026, 7, 28, 10, 0);
const Q = (icao, code, bcde) =>
  `A1000/26 NOTAMN Q) LFFF/${code}/IV/NBO/A/000/999/4901N00227E005 A) ${icao} ${bcde}`;
const BC = "B) 2608280900 C) 2608291000";

test("Q-line : piste fermée par paire, ILS et rampe par EXTRÉMITÉ", async () => {
  const { nfaDetect } = await chargerDetecteur();
  // QMRLC + refs adjacentes → la paire citée, pas les autres.
  let d = nfaDetect("LFPG", [Q("LFPG", "QMRLC", `${BC} E) RWY 09L/27R CLSD DUE WIP`)], NOW);
  assert.deepEqual(Object.keys(d.rwy), ["09L/27R"]);
  assert.deepEqual(d.ils, {});
  // QICAS « ILS RWY 26L U/S » → la SEULE extrémité 26L, aucune piste fermée.
  d = nfaDetect("LFPG", [Q("LFPG", "QICAS", `${BC} E) ILS RWY 26L U/S`)], NOW);
  assert.deepEqual(d.ils, { "26L": ["A1000/26"] });
  assert.deepEqual(Object.keys(d.rwy), []);
  // QICAS sans ref de piste → repli conservatif : toutes les extrémités.
  d = nfaDetect("LFPG", [Q("LFPG", "QICAS", `${BC} E) ILS U/S DUE MAINT`)], NOW);
  assert.equal(Object.keys(d.ils).length, 8);
  // QLAAS (rampe d'approche) → l'extrémité citée.
  d = nfaDetect("LFPG", [Q("LFPG", "QLAAS", `${BC} E) ALS RWY 27R U/S`)], NOW);
  assert.deepEqual(Object.keys(d.als), ["27R"]);
  // QFALC (aérodrome fermé) → toutes les paires.
  d = nfaDetect("LFPG", [Q("LFPG", "QFALC", `${BC} E) AD CLSD DUE STAFF SHORTAGE`)], NOW);
  assert.equal(Object.keys(d.rwy).length, 4);
  // QMXLC (taxiway) citant une piste comme borne → rien.
  d = nfaDetect("LFPG", [Q("LFPG", "QMXLC", `${BC} E) TWY B CLSD BTN RWY 09L AND TWY A`)], NOW);
  assert.deepEqual(Object.keys(d.rwy), []);
});

test("texte sans Q-line (NOTAM US) : RUNWAY en toutes lettres, OTS, AD CLSD — et l'équipement prime sur la piste", async () => {
  const { nfaDetect } = await chargerDetecteur();
  // LFPO A2740/26 : « CLOSURE OF RUNWAY 06/24 » (le cas fondateur).
  let d = nfaDetect("LFPO", [`A2740/26 NOTAMN Q) LFFF/QMRLC/IV/NBO/A/000/999/4830N00223E005 A) LFPO ${BC} E) DUE TO THE CLOSURE OF RUNWAY 06/24 TWY W2 UNAVBL`], NOW);
  assert.deepEqual(Object.keys(d.rwy), ["06/24"]);
  // « APCH LGT OTS » américain, sans Q-line ni série OACI → l'extrémité 27R.
  d = nfaDetect("LFPG", [`07/210 A) LFPG ${BC} E) RWY 27R APCH LGT OTS`], NOW);
  assert.deepEqual(Object.keys(d.als), ["27R"]);
  assert.deepEqual(d.als["27R"], ["07/210"]);
  // « AD CLSD » sans Q-line → toutes les paires.
  d = nfaDetect("LFAB", [`07/300 A) LFAB ${BC} E) AD CLSD DUE FLOODING`], NOW);
  assert.deepEqual(Object.keys(d.rwy), ["13/31"]);
  // « ILS RWY 06 CLSD » parle de l'ILS du 06 : jamais de piste fermée.
  d = nfaDetect("LFPO", [`07/400 A) LFPO ${BC} E) ILS RWY 06 CLSD FOR MAINT`], NOW);
  assert.deepEqual(Object.keys(d.ils), ["06"]);
  assert.deepEqual(Object.keys(d.rwy), []);
});

test("garde-fous : reprise d'exploitation, restriction partielle, envergure", async () => {
  const { nfaDetect } = await chargerDetecteur();
  const rien = d => {
    assert.deepEqual(d.ils, {}); assert.deepEqual(d.als, {});
    assert.deepEqual(Object.keys(d.rwy), []);
  };
  rien(nfaDetect("LFPG", [Q("LFPG", "QMRLC", `${BC} E) RWY 08R/26L RESUMED NORMAL OPS, PREVIOUSLY CLSD`)], NOW));
  rien(nfaDetect("LFPG", [Q("LFPG", "QMRLC", `${BC} E) RWY 08L/26R CLSD TO ACFT WINGSPAN ABOVE 36M`)], NOW));
  rien(nfaDetect("LFPO", [`07/500 A) LFPO ${BC} E) RWY 06/24 CLSD FOR ACFT A388 AND B748`], NOW));
  // « CLSD FOR MAINT » est une VRAIE fermeture — la raison n'est pas une
  // restriction (régression attrapée par la première passe de ce test).
  const d = nfaDetect("LFPG", [Q("LFPG", "QMRLC", `${BC} E) RWY 09R/27L CLSD FOR MAINT`)], NOW);
  assert.deepEqual(Object.keys(d.rwy), ["09R/27L"]);
});

test("annulations et marqueurs (cas réels KJFK du 2026-08-28) : jamais un drapeau", async () => {
  const { nfaDetect } = await chargerDetecteur();
  // NOTAMC : l'E) recopie la fermeture LEVÉE — le lire au premier degré
  // fermait les quatre pistes de KJFK un jour de trafic normal.
  let d = nfaDetect("LFPG", [`A7208/26 NOTAMC A7190/26 Q) KZNY/QMRXX////000/999/4038N07346W005 A) LFPG B) 2608261340 E) RWY 09L/27R CLSD CAN`], NOW);
  assert.deepEqual(Object.keys(d.rwy), []);
  // Marqueur intérieur HS (KJFK 05/149) : l'ILS entier reste utilisable.
  d = nfaDetect("LFPG", [`05/149 A) LFPG ${BC} E) NAV ILS RWY 04R IM U/S`], NOW);
  assert.deepEqual(d.ils, {});
  // Mais une panne ILS réelle du même cru flagge toujours (LFPO A5442/26).
  d = nfaDetect("LFPG", [`A5442/26 NOTAMN Q) LFFF/QICAS/I/NBO/A/000/999/4844N00223E005 A) LFPG ${BC} E) ILS RWY 02 U/S`], NOW);
  assert.equal(Object.keys(d.ils).length, 8); // « 02 » inconnu de LFPG → repli toutes extrémités
});

test("validité : passé, PERM, fenêtre de six heures, chantier de nuit, jours", async () => {
  const { nfaDetect, nfaActiveIn, nfaItems } = await chargerDetecteur();
  // NOTAM échu → rien.
  let d = nfaDetect("LFPG", [Q("LFPG", "QMRLC", "B) 2601010800 C) 2601011200 E) RWY 09R/27L CLSD")], NOW);
  assert.deepEqual(Object.keys(d.rwy), []);
  // C) PERM → toujours actif.
  d = nfaDetect("LFPG", [Q("LFPG", "QMRLC", "B) 2601010800 C) PERM E) RWY 09R/27L CLSD")], NOW);
  assert.deepEqual(Object.keys(d.rwy), ["09R/27L"]);
  // Chantier de nuit 2300-0400 : invisible à 10:00Z (+6 h → 16:00),
  // visible à 20:00Z (+6 h → 02:00).
  const nuit = Q("LFPG", "QMRLC", `${BC} D) 2300-0400 E) RWY 09R/27L CLSD FOR MAINT`);
  assert.deepEqual(Object.keys(nfaDetect("LFPG", [nuit], NOW).rwy), []);
  const SOIR = Date.UTC(2026, 7, 28, 20, 0);
  assert.deepEqual(Object.keys(nfaDetect("LFPG", [nuit], SOIR).rwy), ["09R/27L"]);
  // Jours : le 2026-08-28 est un vendredi — MON-THU ne mord pas, FRI si.
  const it = txt => nfaItems(txt.replace(/\s+/g, " "));
  assert.equal(nfaActiveIn(it(`${BC} D) MON-THU 0800-1200 E) X`), NOW, NOW + 6 * 3600000), false);
  assert.equal(nfaActiveIn(it(`${BC} D) FRI 0800-1200 E) X`), NOW, NOW + 6 * 3600000), true);
});

test("cycle de vie par extrémité : refus retenu, NOTAM nouveau recoche, disparition décoche, manuel survit", async () => {
  const { nfaDetect, nfaApply, nfGet, nfIlsOut, nfAlsOut, nfUserSetEnd, nfUserToggleRwy } = await chargerDetecteur();
  const rwy = Q("LFPG", "QMRLC", `${BC} E) RWY 09L/27R CLSD DUE WIP`);
  const ils = `A1001/26 NOTAMN Q) LFFF/QICAS/I/NBO/A/000/999/4901N00227E005 A) LFPG ${BC} E) ILS RWY 26L U/S`;
  const loc = `A2222/26 NOTAMN Q) LFFF/QILAS/I/NBO/A/000/999/4901N00227E005 A) LFPG ${BC} E) LOC RWY 08R U/S`;
  // Première passe : la 26L seule se coche, avec provenance — la 27L reste saine.
  nfaApply("LFPG", nfaDetect("LFPG", [rwy, ils], NOW), { n: 2 });
  assert.equal(nfIlsOut("LFPG", "26L"), true);
  assert.equal(nfIlsOut("LFPG", "27L"), false);
  assert.equal(nfGet("LFPG").rwyClosed["09L/27R"], true);
  assert.deepEqual(nfGet("LFPG").auto.ils, { "26L": ["A1001/26"] });
  // Le pilote décoche l'ILS 26L : le refetch des MÊMES NOTAM ne recoche pas.
  nfUserSetEnd("LFPG", "ils", "26L", false);
  nfaApply("LFPG", nfaDetect("LFPG", [rwy, ils], NOW), { n: 2 });
  assert.equal(nfIlsOut("LFPG", "26L"), false);
  // Un NOTAM NOUVEAU sur le 08R coche le 08R — le refus du 26L tient toujours.
  nfaApply("LFPG", nfaDetect("LFPG", [rwy, ils, loc], NOW), { n: 3 });
  assert.equal(nfIlsOut("LFPG", "08R"), true);
  assert.equal(nfIlsOut("LFPG", "26L"), false);
  assert.deepEqual(nfGet("LFPG").dis.ils, { "26L": ["A1001/26"] });
  // Le NOTAM piste disparaît : la paire se décoche seule.
  nfaApply("LFPG", nfaDetect("LFPG", [ils, loc], NOW), { n: 2 });
  assert.equal(nfGet("LFPG").rwyClosed["09L/27R"], undefined);
  // Un drapeau coché à la MAIN survit à un contrôle qui n'en parle pas.
  nfUserToggleRwy("LFPG", "08L/26R");
  nfUserSetEnd("LFPG", "als", "09R", true);
  nfaApply("LFPG", nfaDetect("LFPG", [ils, loc], NOW), { n: 2 });
  assert.equal(nfGet("LFPG").rwyClosed["08L/26R"], true);
  assert.equal(nfAlsOut("LFPG", "09R"), true);
});

test("migration v1 → v2 : un booléen coché s'étale sur toutes les extrémités, en manuel", async () => {
  const { nfEntry, nfIlsOut, nfGet, nfSeed } = await chargerDetecteur();
  nfSeed("LFPO", { ilsOut: true, lightsOut: false, rwyClosed: { "06/24": true },
                   man: { rwy: { "06/24": true } } });
  nfEntry("LFPO");
  for (const en of ["02","20","06","24","07","25"]) assert.equal(nfIlsOut("LFPO", en), true);
  assert.deepEqual(nfGet("LFPO").lightsOut, {});
  assert.equal(nfGet("LFPO").rwyClosed["06/24"], true);
  assert.equal(nfGet("LFPO").man.ils["02"], true);
  assert.equal(nfGet("LFPO").man.rwy["06/24"], true);
});
