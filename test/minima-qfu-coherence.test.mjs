// ============================================================
//  Cohérence entre le QFU AFFICHÉ (bande « Runway in use · estimated ») et le
//  QFU sur lequel les minima se CALCULENT (autoQfuForTab).
//
//  Cas réel fondateur : LFBD, 2026-09-02. La fiche déclare la 23
//  préférentielle, la bande affichait donc « QFU 23 · preferential » sous les
//  relevés — et le panneau de phase calculait ses minima au 29, parce que le
//  bornage du moteur ne se déclenchait que sur du TRAFIC OBSERVÉ. Deux pistes
//  à l'écran pour un seul atterrissage.
//
//  Ce que le test garde, dans les deux sens :
//    1. une PRÉFÉRENTIELLE borne le calcul (LFBD : 23, plus 29) ;
//    2. mais seulement tant qu'elle laisse une extrémité utilisable — une
//       intention publiée ne vaut pas un vent hors des limites de l'avion ;
//    3. une OBSERVATION, elle, borne sans condition : si le terrain utilise
//       cette piste, calculer sur une autre est une fiction ;
//    4. le DERNIER RECOURS (vent seul) ne borne rien, et c'est la BANDE qui
//       suit : il connaît la règle ILS du moteur (piste ILS tant qu'elle ne
//       rend pas plus de 5 kt dans le dos), sans quoi la bande nommerait une
//       piste que le calcul n'utiliserait pas ;
//    5. et parce qu'il ne borne pas, le moteur garde ses rangs de repli quand
//       les minima ferment la piste ILS.
//
//  Comme minima-qfu-vent.test.mjs : on DÉCOUPE le code réellement déployé,
//  repéré par marqueur textuel et jamais par numéro de ligne. Les entrées du
//  terrain (base piste, approches, verdicts, réponse du recensement) sont les
//  seuls points extérieurs ; le test fournit les siens.
//
//  Lancer :  node --test test/minima-qfu-coherence.test.mjs
// ============================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(HERE, "..", "minima.html"), "utf8").replace(/\r\n/g, "\n");

function decoupe(re, quoi) {
  const m = re.exec(html);
  assert.ok(m, `${quoi} introuvable dans minima.html — le marqueur a changé`);
  return m[0];
}

/* LFBD tel que la graine le porte : 05/23 (ILS CAT III au 23) et 11/29 (ILS
   CAT I au 29). Déclinaison mise à zéro pour que les caps du test se lisent
   tels quels — la conversion vrai → magnétique a son propre test. */
const QFUS = {
  "05/23": [{ id: "05", deg: 45 }, { id: "23", deg: 225 }],
  "11/29": [{ id: "11", deg: 106 }, { id: "29", deg: 286 }],
};
const ILS = new Set(["23", "29"]);

async function charger() {
  const src = [
    "globalThis.window = {};",
    // --- ce qui est mesuré : les constantes et le code déployés ---
    decoupe(/const QLV_MAX_TAIL_KT = \d+;/, "QLV_MAX_TAIL_KT"),
    decoupe(/const QLV_LAT_NM = [\d.]+;/, "QLV_LAT_NM"),
    decoupe(/const QLV_MATCH_DEG = \d+;.*/, "QLV_MATCH_DEG"),
    decoupe(/const QFU_RANK = \{[^}]*\};/, "QFU_RANK"),
    decoupe(/function windComponents\(qfuDeg, dir, speed\)\{[\s\S]*?\n\}/, "windComponents()"),
    decoupe(/function adPrefSet\(rec, kind\)\{[\s\S]*?\n\}/, "adPrefSet()"),
    decoupe(/function qlvEstimate\(icao\)\{[\s\S]*?\n\}/, "qlvEstimate()"),
    decoupe(/function autoQfuForTab\(tb, r, wind\)\{[\s\S]*?\n\}/, "autoQfuForTab()"),
    // --- le terrain, fourni par le test ---
    "let REC = null, WIND = null, HORS_LIMITES = new Set(), MINIMA_NOGO = new Set();",
    "const state = {get metar(){ return {station:'LFBD', wind:WIND}; }};",
    "const RWY_DB = {};",
    "const qlvCache = new Map();",
    "function currentIcao(){ return 'LFBD'; }",
    "function currentMagvar(){ return 0; }",
    "function adGet(){ return REC; }",
    "function runwayList(){ return Object.keys(" + JSON.stringify(QFUS) + "); }",
    "const QFUS = " + JSON.stringify(QFUS) + ";",
    "function qfusOf(pair){ return QFUS[pair].map(q=>({...q})); }",
    "function nfRwyClosed(){ return false; }",
    "function dtsQfu(){ return null; }",
    "const ILS = new Set(" + JSON.stringify([...ILS]) + ");",
    "function endHasIls(icao, end){ return ILS.has(end); }",
    "function endHasApp(){ return true; }",
    // Les verdicts : tout passe, sauf les extrémités que le test déclare hors
    // des limites de l'avion (vent) — c'est ce qui distingue une piste
    // souhaitée d'une piste utilisable.
    "function probeTab(){ return {overall:'GO', verdicts:[], warnings:[]}; }",
    "function qfuTabState(){ return 'go'; }",
    "function mVisInfo(tb, pr, q){ return {st: MINIMA_NOGO.has(q && q.id) ? 'nogo' : 'go'}; }",
    "function phaseWinds(){ return []; }",
    "function qfuWindState(deg){ return {st: HORS_LIMITES.has(deg) ? 'nogo' : 'go'}; }",
    // --- la manette du test ---
    "export function poser({pref, wind, obs, horsLimites, minimaNogo}){",
    "  REC = {runways:[{pair:'05/23'},{pair:'11/29'}], pref: pref || undefined};",
    "  WIND = wind; HORS_LIMITES = new Set(horsLimites || []);",
    "  MINIMA_NOGO = new Set(minimaNogo || []);",
    "  qlvCache.clear();",
    "  if (obs) qlvCache.set('LFBD', {at: Date.now(), data: obs});",
    "}",
    "export const bande = icao => qlvEstimate('LFBD');",
    "export const calcul = role => autoQfuForTab({role}, null, WIND);",
    "export const idDu = c => c && QFUS[c.pair][c.idx].id;",
  ].join("\n");
  return import("data:text/javascript;base64," + Buffer.from(src).toString("base64"));
}

const M = await charger();

test("LFBD : la 23 préférentielle est aussi la 23 des calculs", async () => {
  // Vent 290/8 : la 29 rend 8 kt de face, la 23 seulement 3 — le classement du
  // moteur, seul, prenait la 29. La fiche, elle, publie la 23.
  M.poser({ pref: { to: ["23"], ldg: ["23"] }, wind: { direction_deg: 290, speed_kt: 8 } });

  const e = M.bande();
  assert.equal(e.ldg.how.startsWith("preferential"), true, "la bande doit tenir la préférentielle");
  assert.deepEqual(e.ldg.ids, ["23"]);

  assert.equal(M.idDu(M.calcul("LANDING")), "23", "le calcul doit suivre la bande");
  assert.equal(M.idDu(M.calcul("DEPARTURE")), "23", "le décollage aussi");
});

test("une préférentielle inutilisable ne borne pas : le moteur reprend le terrain", async () => {
  // La fiche préfère la 05, mais le vent y sort des limites de l'avion. Une
  // intention publiée ne cloue pas le pilote sur une piste où il ne peut pas
  // aller — contrairement à une observation (test suivant).
  M.poser({ pref: { ldg: ["05"] }, wind: { direction_deg: 290, speed_kt: 8 }, horsLimites: [45] });

  assert.deepEqual(M.bande().ldg.ids, ["05"], "la bande affiche bien la préférentielle");
  assert.equal(M.idDu(M.calcul("LANDING")), "29", "le calcul repart sur la piste utilisable");
});

test("une observation borne sans condition, même hors limites", async () => {
  // Trois arrivées vues au 045° : le terrain se pose au 05. Calculer au 29
  // parce que c'est plus confortable serait une fiction.
  M.poser({
    wind: { direction_deg: 290, speed_kt: 8 },
    horsLimites: [45],
    obs: { at: new Date().toISOString(), window_min: 60,
           arr: [{ trk: 45, n: 3, last: new Date().toISOString() }], dep: [], gnd: [] },
  });

  const e = M.bande();
  assert.equal(e.ldg.how.startsWith("observed"), true);
  assert.deepEqual(e.ldg.ids, ["05"]);
  assert.equal(M.idDu(M.calcul("LANDING")), "05", "le calcul se fait sur la piste UTILISÉE");
});

test("au vent seul, la bande connaît la règle ILS du moteur", async () => {
  // Vent 130/10 : la 11 rend 9 kt de face mais n'a pas d'ILS ; la 23, ILS, ne
  // rend que 0,9 kt dans le dos. Le moteur prend la 23 (rang 1) ; la bande
  // annonçait la 11. Deux pistes pour un seul atterrissage, à nouveau.
  M.poser({ wind: { direction_deg: 130, speed_kt: 10 } });

  const e = M.bande();
  assert.deepEqual(e.ldg.ids, ["23"], "la bande nomme la piste ILS");
  assert.equal(e.ldg.how.startsWith("ILS runway"), true, "et le dit : " + e.ldg.how);
  assert.equal(M.idDu(M.calcul("LANDING")), "23");

  // Le décollage n'a pas d'approche : il reste au meilleur vent de face, et le
  // moteur le suit sans être borné.
  assert.deepEqual(e.to.ids, ["11"]);
  assert.equal(e.to.how.startsWith("wind"), true, "le décollage reste au vent : " + e.to.how);
  assert.equal(M.idDu(M.calcul("DEPARTURE")), "11");
});

test("le dernier recours ne borne pas : le moteur peut encore se rabattre", async () => {
  // Même vent 130/10, mais les minima de la 23 ne laissent pas descendre. Le
  // rang 2 du moteur (approche publiée, 6 kt de face au moins) l'envoie à la
  // 11 — ce qu'un bornage sur la bande lui interdirait. La bande, elle,
  // continue de nommer la piste ILS : elle dit ce que le terrain UTILISE, le
  // panneau dit où CET avion peut aller, et la divergence est le message.
  M.poser({ wind: { direction_deg: 130, speed_kt: 10 }, minimaNogo: ["23"] });

  assert.deepEqual(M.bande().ldg.ids, ["23"]);
  assert.equal(M.idDu(M.calcul("LANDING")), "11", "le rang 2 doit rester atteignable");
});
