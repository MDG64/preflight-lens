// ============================================================
//  Une envergure maximale est une CONDITION, pas une fermeture.
//
//  Bug réel (LFPO A5411/26, constaté le 2026-08-22) : « TWY W34 AND W4
//  PROHIBITED FOR ACFT WITH WINGSPAN MORE THAN OR EQUAL TO 65 METERS »
//  peignait les deux voies en ROUGE « fermées » et sortait Critical dans la
//  liste — alors qu'elles restent ouvertes à tout ce qui fait moins de 65 m.
//  Au même terrain, A5166/26 dit la même chose avec « WINGSPAN GREATER OR
//  EQUAL TO 36M » et sortait correctement en ambre : RESTRICT_TEXT connaissait
//  GREATER, ABOVE, OVER, EXCEEDS et HIGHER THAN, mais pas MORE. Deux
//  rédactions d'une même règle donnaient deux couleurs.
//
//  Ce fichier verrouille la FAMILLE entière des comparateurs, pas le seul mot
//  ajouté : c'est la liste qui se complète mal, un par un, depuis le début.
//  Ajouter un comparateur au vocabulaire réel du corpus sans l'ajouter ici
//  doit se voir.
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
  const fin = L.findIndex(l => l.includes("return { categories: [...cats], severity: severity(q, e, cnl), source };"));
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

// Toutes les rédactions du comparateur relevées dans le corpus réel le
// 2026-08-22 (7767 NOTAM, 1248 terrains européens), montées sur la même
// phrase pour n'isoler que le mot qui change.
const COMPARATEURS = [
  "MORE THAN OR EQUAL TO 65 METERS",   // LFPO A5411/26 — le cas déclencheur
  "MORE THAN 69M",                     // EHAM A1733/26
  "GREATER OR EQUAL TO 36M",           // LFPO A5166/26
  "GREATER THAN 52M",                  // LRTR A3927/26
  "ABOVE 28M",
  "OVER 19.2M",                        // LEBL A5722/26
  "EXCEEDS 36M",                       // LFPO A5141/26
  "HIGHER THAN 40M",
];
const phrase = c => `TWY W34 AND W4 PROHIBITED FOR ACFT WITH WINGSPAN ${c}.`;

test("une envergure maximale laisse la surface ouverte, quel que soit le comparateur", async () => {
  const { severity } = await chargerSeverity();
  const { planKind } = await chargerPlanKind();
  const ecarts = [];
  for (const c of COMPARATEURS) {
    const e = phrase(c);
    const sev = severity("QMXLT", e), kind = planKind({ e });
    if (sev !== "caution" || kind !== "restricted") ecarts.push(`WINGSPAN ${c} : liste=${sev} plan=${kind}`);
  }
  assert.deepEqual(ecarts, []);
});

test("sans condition d'envergure, l'interdiction reste une fermeture totale", async () => {
  const { severity } = await chargerSeverity();
  const { planKind } = await chargerPlanKind();
  // Le garde-fou de la règle ci-dessus : c'est la CONDITION qui fait retomber
  // en ambre, pas le mot PROHIBITED. Sans elle, rouge — sinon le correctif
  // aurait ouvert une porte au lieu de fermer un trou.
  const e = "TWY W34 AND W4 PROHIBITED FOR ALL ACFT.";
  assert.equal(severity("QMXLT", e), "critical");
  assert.equal(planKind({ e }), "closed");
});
