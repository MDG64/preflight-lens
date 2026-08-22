// ============================================================
//  Une fermeture de piste ou de taxiway est Critical — et le plan et la
//  liste le disent d'une seule voix.
//
//  Bug réel (LFPO A2740/26, constaté le 2026-08-22) : « DUE TO THE CLOSURE
//  OF RUNWAY 06/24 FROM AUGUST 10 TO DECEMBER 17 ». Le plan peignait la
//  piste en ROUGE, la liste affichait une pastille AMBRE « Caution » — sur
//  le même NOTAM, dans la même app. Cause : hasClosureWord() ne connaissait
//  que CLSD/CLOSED, et planKind() s'était ajouté « CLOSURE » dans son coin
//  le 2026-07-27 (LFBO A4912/26) sans que severity() en profite. Le mot est
//  remonté dans CRITICAL_TEXT, donc dans le prédicat partagé.
//
//  Ce fichier verrouille les DEUX moitiés ensemble : tester severity() seule
//  laisserait revenir la divergence par l'autre bout. Les cas viennent d'un
//  audit du 2026-08-22 sur 7086 NOTAM réels de 957 terrains européens — 29
//  contenaient « CLOSURE », dont 9 que seul ce mot fait basculer.
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

/** severity() telle qu'elle tourne — même découpe que classify.test.mjs. */
async function chargerSeverity() {
  const L = html.split("\n");
  const debut = L.findIndex(l => l.includes("const SUBJECT_CATEGORIES = {"));
  const fin = L.findIndex(l => l.includes("return { categories: [...cats], severity: severity(q, e), source };"));
  assert.ok(debut >= 0 && fin > debut, "marqueurs de la section de classification introuvables");
  const src = [
    L.slice(debut, fin + 2).join("\n"),
    "const CNL_TEXT = " + /const CNL_TEXT = (\[[^\]]*\]);/.exec(html)[1] + ";",
    "const RESTRICT_TEXT = " + /const RESTRICT_TEXT = (\[[\s\S]*?\]);/.exec(html)[1] + ";",
    "const RESTRICT_ACFT_RE = " + /const RESTRICT_ACFT_RE = (\/.*\/);/.exec(html)[1] + ";",
    /function hasRestrictCond\(t\) \{[\s\S]*?\n {4}\}/.exec(html)[0],
    "export { severity };",
  ].join("\n");
  return import("data:text/javascript;base64," + Buffer.from(src).toString("base64"));
}

/** planKind() telle qu'elle tourne — même découpe que plan-kind.test.mjs. */
async function chargerPlanKind() {
  const motifs = {
    CRITICAL_TEXT: /const CRITICAL_TEXT = (\[[\s\S]*?\]);/,
    CNL_TEXT: /const CNL_TEXT = (\[[^\]]*\]);/,
    RESUME_TEXT: /const RESUME_TEXT = (\[[^\]]*\]);/,
    RESUME_OK_RE: /const RESUME_OK_RE = (\/.*\/);/,
    RESTRICT_TEXT: /const RESTRICT_TEXT = (\[[\s\S]*?\]);/,
    RESTRICT_ACFT_RE: /const RESTRICT_ACFT_RE = (\/.*\/);/,
    WITHDRAWN_RE: /const WITHDRAWN_RE = (\/.*\/g);/,
    WITHDRAWN_DATA_RE: /const WITHDRAWN_DATA_RE = (\/.*\/g);/,
  };
  const consts = Object.entries(motifs).map(([nom, re]) => {
    const m = re.exec(html);
    assert.ok(m, `${nom} introuvable dans notam-filter.html`);
    return `const ${nom} = ${m[1]};`;
  });
  const fns = ["isResumption", "hasRestrictCond", "hasClosureWord", "planKind"].map(nom => {
    const re = new RegExp(`function ${nom}\\([^)]*\\) \\{[\\s\\S]*?\\n {4}\\}`);
    const m = re.exec(html);
    assert.ok(m, `function ${nom}() introuvable dans notam-filter.html`);
    return m[0];
  });
  const src = [...consts, ...fns, "export { planKind };"].join("\n");
  return import("data:text/javascript;base64," + Buffer.from(src).toString("base64"));
}

// Cas réels, tirés du flux amont le 2026-08-22. Aucun ne contient CLSD, CLOSED,
// U/S ni NOT AVBL : c'est le seul mot « CLOSURE » qui les qualifie.
const FERMETURES = [
  ["LFPO A2740/26", "QPDTT", "AD PARIS ORLY (LFPO) : DUE TO THE CLOSURE OF RUNWAY 06/24 FROM AUGUST 10 TO DECEMBER 17, TEMPORARY APPROACH PROCEDURES ON RUNWAY 25 AND DEPARTURE PROCEDURES ON RUNWAY 20 ARE IMPLEMENTED."],
  ["EPBY E2589/26", "QMXLT", "TEMPORARY CLOSURE OF TWY C1 AT BYDGOSZCZ (EPBY) AERODROME."],
  ["LFPG A3623/26", "QMXLT", "REHABILITATION WORKS OF PART OF TWY T WITH CLOSURE OF A PART OF THE TWY."],
  ["LILN C0889/26", "QFAXX", "AD CLOSURE"],
  ["LHBP A5758/26", "QPDXX", "TEMPORARY PROCEDURES DUE TO CLOSURE OF RWY 13L/31R."],
];

// Témoins : rien de fermé, rien ne doit bouger. Le premier a été choisi parce
// qu'il parle de pistes sans en fermer aucune, le second parce que le mot
// « CLOSE » (proche) ressemble à « CLOSED » sans en être un — un test de mot
// entier, pas de sous-chaîne.
const TEMOINS = [
  ["minima RNP", "QPICH", "LNAV-VNAV MINIMA OPS IFR APCH PROC MODIFIED : RNP RWY 02.", "caution"],
  ["grue proche", "QOBCE", "TWR CRANE CLOSE TO PARIS-ORLY AD RDL018/1.43NM ARP.", "info"],
];

test("une fermeture annoncée par le mot CLOSURE est Critical dans la liste", async () => {
  const { severity } = await chargerSeverity();
  const ecarts = FERMETURES
    .map(([nom, q, e]) => [nom, severity(q, e)])
    .filter(([, sev]) => sev !== "critical")
    .map(([nom, sev]) => `${nom} : ${sev}`);
  assert.deepEqual(ecarts, []);
});

test("le plan et la liste ne se contredisent jamais sur une fermeture", async () => {
  const { severity } = await chargerSeverity();
  const { planKind } = await chargerPlanKind();
  const ecarts = FERMETURES
    .map(([nom, q, e]) => [nom, severity(q, e), planKind({ e })])
    .filter(([, sev, kind]) => !(sev === "critical" && kind === "closed"))
    .map(([nom, sev, kind]) => `${nom} : liste=${sev} plan=${kind}`);
  assert.deepEqual(ecarts, []);
});

test("le mot ne déborde pas : ce qui ne ferme rien garde son rang", async () => {
  const { severity } = await chargerSeverity();
  const ecarts = TEMOINS
    .map(([nom, q, e, attendu]) => [nom, severity(q, e), attendu])
    .filter(([, obtenu, attendu]) => obtenu !== attendu)
    .map(([nom, obtenu, attendu]) => `${nom} : attendu=${attendu} obtenu=${obtenu}`);
  assert.deepEqual(ecarts, []);
});
