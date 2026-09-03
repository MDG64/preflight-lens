// ============================================================
//  Un NOTAMC ANNULE un autre message : il ne ferme rien, ne restreint rien.
//
//  Bug réel (KMIA, signalé le 2026-08-29 depuis la vue Layout) :
//
//      A2541/26 NOTAMC A2443/26
//      E) TWY Q BTN TWY Q1 AND TWY Z CLSD TO ACFT WINGSPAN MORE THAN 118FT
//         CANCELED
//
//  sortait en ROUGE « Critical » dans la liste sol. La source US recopie le
//  texte du message annulé et lui accole CANCELED : lu au premier degré, son
//  CLSD faisait une fermeture — l'inverse exact de ce que le NOTAM annonce.
//  Le mot CANCELED de queue ne rattrapait rien, CNL_TEXT n'écoutant que les
//  formes « NOTAM CNL/CANCELLED/WITHDRAWN/VOID ». Seul l'EN-TÊTE tranche, et
//  sans ambiguïté : CANCEL_HEAD_RE, lu par parseNotam() -> n.cnl, puis par
//  severity() (rang dans la liste) et isResumption()/planKind() (couleur du
//  plan). Même lecture que nfaDetect() dans Minima Lens.
//
//  Les 8 NOTAMC relevés ce jour-là sur KMIA sont ici, plus les témoins qui
//  vérifient que rien d'autre n'a bougé : une vraie fermeture reste rouge, et
//  un message qui se contente de CITER un NOTAMC n'est pas annulé pour autant.
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

/** parseNotam() telle qu'elle tourne — même découpe que parse-items.test.mjs. */
async function chargerParseNotam() {
  const ordre = /const ITEM_ORDRE = ("[A-Z]+");/.exec(html);
  assert.ok(ordre, "ITEM_ORDRE introuvable dans notam-filter.html");
  const cancel = /const CANCEL_HEAD_RE = (\/.*\/);/.exec(html);
  assert.ok(cancel, "CANCEL_HEAD_RE introuvable dans notam-filter.html");
  // unwrapNotam() (ex-unwrapOriginalNotam) lit WRAPPED_RE, et parseNotam()
  // valide la ligne Q) par qField() et ses quatre regex : tous déclarés hors
  // des fonctions découpées, on les rapatrie — comme classify.test.mjs le
  // fait pour CNL_TEXT et RESTRICT_TEXT.
  const consts = ["WRAPPED_RE", "Q_CODE", "Q_TRAFFIC", "Q_PURPOSE", "Q_SCOPE"].map(nom => {
    const m = new RegExp(`const ${nom}\\s*= (\\/.*?\\/);`).exec(html);
    assert.ok(m, `${nom} introuvable dans notam-filter.html`);
    return `const ${nom} = ${m[1]};`;
  });
  const qField = /const qField = \(re, v\) => \{.*\};/.exec(html);
  assert.ok(qField, "qField introuvable dans notam-filter.html");
  const fns = ["cleanHtml", "itemMarkers", "field", "innerBody", "unwrapNotam", "parseNotam"].map(nom => {
    const re = new RegExp(`function ${nom}\\([^)]*\\) \\{[\\s\\S]*?\\n {4}\\}`);
    const m = re.exec(html);
    assert.ok(m, `function ${nom}() introuvable dans notam-filter.html`);
    return m[0];
  });
  const src = ["const ITEM_ORDRE = " + ordre[1] + ";",
               "const CANCEL_HEAD_RE = " + cancel[1] + ";",
               ...consts, qField[0],
               ...fns, "export { parseNotam };"].join("\n");
  return import("data:text/javascript;base64," + Buffer.from(src).toString("base64"));
}

/** severity() telle qu'elle tourne — même découpe que severity-closure.test.mjs. */
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

/* NOTAM RÉELS — /api/notams/KMIA, relevé du 2026-08-29. Le corps dupliqué
   (l'en-tête recopié dans l'item E) est celui de la source, pas une mise en
   forme du test : innerBody() le traverse pour livrer le texte utile. */
const KMIA = [
  ["A2541/26 NOTAMC A2443/26\nQ) KZMA/QMXXX////000/999/2547N08017W005\nA) KMIA\nB) 2608261810\nE) A2541/26 NOTAMC A2443/26\nQ) KZMA/QMXXX////000/999/2547N08017W005\nA) KMIA\nB) 2608261810\nE) TWY Q BTN TWY Q1 AND TWY Z CLSD TO ACFT WINGSPAN MORE THAN 118FT CANCELED",
   "TWY Q BTN TWY Q1 AND TWY Z CLSD TO ACFT WINGSPAN MORE THAN 118FT CANCELED"],
  ["A2545/26 NOTAMC A2544/26\nQ) KZMA/QMNXX////000/999/2547N08017W005\nA) KMIA\nB) 2608261948\nE) TWY W BTN TWY N AND TERMINAL APN SPOT 13 TXL CLSD CANCELED",
   "TWY W BTN TWY N AND TERMINAL APN SPOT 13 TXL CLSD CANCELED"],
  ["A2550/26 NOTAMC A2508/26\nQ) KZMA/QLPXX////000/999/2547N08017W005\nA) KMIA\nB) 2608271523\nE) RWY 09 PAPI U/S CANCELED",
   "RWY 09 PAPI U/S CANCELED"],
];

test("un NOTAMC est reconnu sur son en-tête, quoi que recopie son texte", async () => {
  const { parseNotam } = await chargerParseNotam();
  for (const [raw, texte] of KMIA) {
    const n = parseNotam(raw);
    assert.equal(n.cnl, true, `${n.id} : annulation non reconnue`);
    assert.equal(n.e, texte, `${n.id} : item E) mal découpé`);
  }
});

test("le NOTAM annulé ne sort ni en Critical ni en fermeture sur le plan", async () => {
  const { parseNotam } = await chargerParseNotam();
  const { severity } = await chargerSeverity();
  const { planKind } = await chargerPlanKind();
  const ecarts = [];
  for (const [raw] of KMIA) {
    const n = parseNotam(raw);
    const sev = severity(n.qcode, n.e, n.cnl);
    const kind = planKind(n);
    if (sev !== "info") ecarts.push(`${n.id} : severity ${sev} au lieu de info`);
    if (kind !== "reopened") ecarts.push(`${n.id} : planKind ${kind} au lieu de reopened`);
  }
  assert.deepEqual(ecarts, [], "un NOTAMC annonce une LEVÉE, il ne peint rien en rouge");
});

test("les témoins ne bougent pas : une vraie fermeture reste une fermeture", async () => {
  const { parseNotam } = await chargerParseNotam();
  const { severity } = await chargerSeverity();
  const { planKind } = await chargerPlanKind();
  const TEMOINS = [
    // le message annulé LUI-MÊME (NOTAMN), tel qu'il vivait avant sa levée
    ["A2544/26 NOTAMN\nQ) KZMA/QMNXX////000/999/2547N08017W005\nA) KMIA\nB) 2608251200\nE) TWY W BTN TWY N AND TERMINAL APN SPOT 13 TXL CLSD",
     false, "critical", "closed"],
    // un NOTAM qui CITE un NOTAMC dans son corps n'est pas une annulation :
    // l'en-tête reste un NOTAMN, la fermeture est bien active.
    ["A2601/26 NOTAMN\nQ) KZMA/QMXXX////000/999/2547N08017W005\nA) KMIA\nB) 2608291200\nE) REF A2541/26 NOTAMC A2443/26 - TWY Q CLSD",
     false, "critical", "closed"],
  ];
  const ecarts = [];
  for (const [raw, cnl, sev, kind] of TEMOINS) {
    const n = parseNotam(raw);
    if (n.cnl !== cnl) ecarts.push(`${n.id} : cnl ${n.cnl} au lieu de ${cnl}`);
    const s = severity(n.qcode, n.e, n.cnl), k = planKind(n);
    if (s !== sev) ecarts.push(`${n.id} : severity ${s} au lieu de ${sev}`);
    if (k !== kind) ecarts.push(`${n.id} : planKind ${k} au lieu de ${kind}`);
  }
  assert.deepEqual(ecarts, [], "seul l'en-tête NOTAMC annule, et rien d'autre");
});
