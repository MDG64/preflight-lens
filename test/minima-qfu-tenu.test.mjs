// ============================================================
//  La CONFIGURATION TENUE de la bande « Runway in use · estimated »
//  (chantier du 2026-09-02, second temps).
//
//  Deux règles, demandées après une journée de recensement :
//
//    1. un QFU OBSERVÉ le reste tant que le vent ne passe pas dans le dos.
//       Avant, la mémoire mourait avec la fenêtre d'une heure du serveur : à
//       la première heure creuse, la bande retombait sur la préférentielle
//       publiée ou sur le vent, alors qu'on venait de voir le terrain
//       travailler. C'est le vent — et lui seul — qui libère un QFU tenu.
//
//    2. changer pour une piste SÉCANTE demande deux avions DE SUITE. Cas réel
//       d'Orly : les gros porteurs, peu nombreux, décollent en 25 pendant que
//       le reste du trafic part en 20. Un départ isolé faisait basculer la
//       bande entière — et avec elle les minima, qui se calculent sur le QFU
//       qu'elle désigne. Le trafic écarté n'est pas tu pour autant : la bande
//       le montre en note, avec la règle qui l'écarte.
//
//  La règle des deux avions vit dans le RECENSEMENT (notam-proxy
//  lib/qfu-census.js, `retenir` — ses propres tests) : le serveur voit les
//  avions dans l'ordre, et sa mémoire est la même pour tous. Ici on juge ce
//  que la PAGE en fait : `heldDep`/`heldArr`/`heldGnd` désignent la piste
//  quand la fenêtre est vide, bornent les flux de la fenêtre quand ils
//  divergent, et tombent quand le vent tourne.
//
//  Comme minima-qfu-coherence.test.mjs : on DÉCOUPE le code réellement
//  déployé, repéré par marqueur textuel et jamais par numéro de ligne.
//
//  Lancer :  node --test test/minima-qfu-tenu.test.mjs
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

/* Orly réduit à ses deux pistes utiles ici : 07/25 et 02/20, sécantes de 50°.
   Pas de seuils dans la fiche — l'appariement se fait au cap, comme sur un
   terrain sans parallèles. Déclinaison nulle : les caps se lisent tels quels. */
const QFUS = {
  "07/25": [{ id: "07", deg: 70 }, { id: "25", deg: 250 }],
  "02/20": [{ id: "02", deg: 20 }, { id: "20", deg: 200 }],
};

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
    decoupe(/function qlvState\(icao\)\{[\s\S]*?\n\}/, "qlvState()"),
    decoupe(/function autoQfuForTab\(tb, r, wind\)\{[\s\S]*?\n\}/, "autoQfuForTab()"),
    // --- le terrain, fourni par le test ---
    "let REC = null, WIND = null;",
    "const state = {get metar(){ return {station:'LFPO', wind:WIND}; }};",
    "const RWY_DB = {};",
    "const qlvCache = new Map();",
    "function currentIcao(){ return 'LFPO'; }",
    "function currentMagvar(){ return 0; }",
    "function adGet(){ return REC; }",
    "const QFUS = " + JSON.stringify(QFUS) + ";",
    "function runwayList(){ return Object.keys(QFUS); }",
    "function qfusOf(pair){ return QFUS[pair].map(q=>({...q})); }",
    "function nfRwyClosed(){ return false; }",
    "function dtsQfu(){ return null; }",
    "function dtsBoxHtml(){ return ''; }",
    "function endHasIls(){ return false; }",
    "function endHasApp(){ return true; }",
    "function escapeHtmlText(x){ return String(x); }",
    "function probeTab(){ return {overall:'GO', verdicts:[], warnings:[]}; }",
    "function qfuTabState(){ return 'go'; }",
    "function mVisInfo(){ return {st:'go'}; }",
    "function phaseWinds(){ return []; }",
    "function qfuWindState(){ return {st:'go'}; }",
    // --- la manette du test ---
    "export function poser({pref, wind, obs}){",
    "  REC = {runways:[{pair:'07/25'},{pair:'02/20'}], pref: pref || undefined};",
    "  WIND = wind;",
    "  qlvCache.clear();",
    "  if (obs) qlvCache.set('LFPO', {at: Date.now(), data: obs});",
    "}",
    "export const bande = () => qlvEstimate('LFPO');",
    "export const html = () => qlvState('LFPO').html;",
    "export const calcul = role => autoQfuForTab({role}, null, WIND);",
    "export const idDu = c => c && QFUS[c.pair][c.idx].id;",
  ].join("\n");
  return import("data:text/javascript;base64," + Buffer.from(src).toString("base64"));
}

const M = await charger();
const T = Date.parse("2026-09-02T14:00:00Z");
const iso = (t) => new Date(t).toISOString();
/* Le corps d'une réponse du recensement, tel que /api/qfu le rend. */
const censu = (o) => ({ ref: [48.73, 2.36], at: iso(T), window_min: 60,
  coverage: { passes: 20, seen: 40 }, arr: [], dep: [], gnd: [], ...o });

test("la fenêtre s'est vidée : le QFU tenu désigne encore, et il DATE", () => {
  // Vent 200/10 : la 20 est face au vent, rien ne la conteste. Le dernier
  // départ vu remonte à trois heures — la fenêtre d'une heure est vide depuis
  // longtemps, la configuration tenue, elle, ne l'est pas.
  M.poser({ wind: { direction_deg: 200, speed_kt: 10 },
    obs: censu({ lastDep: iso(T - 3 * 3600e3),
      heldDep: { trk: 200, off: 0, at: iso(T - 3 * 3600e3), since: iso(T - 5 * 3600e3), n: 14 } }) });

  const e = M.bande();
  assert.deepEqual(e.to.ids, ["20"]);
  assert.match(e.to.how, /^last observed 11:00Z ×14$/, "l'heure et l'effectif portent la mémoire");
  assert.equal(e.to.obs, true, "c'est une observation : elle borne le calcul");
  assert.ok(!e.to.fresh, "mais pas du direct");
  assert.equal(e.obsUsed, false, "donc pas de point vert");
  assert.equal(M.idDu(M.calcul("DEPARTURE")), "20", "et les minima se calculent dessus");
});

test("le vent passe derrière : le QFU tenu est libéré, la note le date", () => {
  // Vent viré au 020/12 : la 20 prend 12 kt dans le dos, plus de
  // QLV_MAX_TAIL_KT. Elle sort des candidates, la mémoire ne désigne donc
  // plus rien et l'estimation reprend au vent — c'est tout le contrat.
  M.poser({ wind: { direction_deg: 20, speed_kt: 12 },
    obs: censu({ lastDep: iso(T - 3 * 3600e3),
      heldDep: { trk: 200, off: 0, at: iso(T - 3 * 3600e3), since: iso(T - 5 * 3600e3), n: 14 } }) });

  const e = M.bande();
  assert.deepEqual(e.to.ids, ["02"]);
  assert.match(e.to.how, /^wind 12 kt head/, "le vent reprend la main : " + e.to.how);
  assert.match(e.to.how, /last departure seen 20 11:00Z/, "et la note dit ce qu'on tenait");
});

test("Orly : un gros porteur en 25 ne renverse pas la 20 tenue, mais se voit", () => {
  // Le serveur n'a pas basculé (il faut deux avions de suite sur une
  // sécante) : `heldDep` est toujours au 200. Le flux 250 de la fenêtre est
  // donc écarté du vote — et montré en note.
  M.poser({ wind: { direction_deg: 200, speed_kt: 10 },
    obs: censu({ dep: [{ trk: 250, n: 1, off: 0, last: iso(T - 10 * 60e3) }],
      lastDep: iso(T - 10 * 60e3),
      heldDep: { trk: 200, off: 0, at: iso(T - 20 * 60e3), since: iso(T - 3 * 3600e3), n: 9 } }) });

  const e = M.bande();
  assert.deepEqual(e.to.ids, ["20"], "la bande tient la 20");
  assert.equal(M.idDu(M.calcul("DEPARTURE")), "20", "et le calcul avec elle");
  assert.match(M.html(), /1 departure also observed on 25 — a crossing runway takes two in a row to switch/);
});

test("deux de suite : le serveur a basculé, la bande suit en direct", () => {
  // Même terrain, mais le recensement a vu deux départs 25 d'affilée : sa
  // configuration tenue est passée au 250, et la fenêtre reprend la main.
  M.poser({ wind: { direction_deg: 200, speed_kt: 10 },
    obs: censu({ dep: [{ trk: 250, n: 2, off: 0, last: iso(T - 5 * 60e3) }],
      lastDep: iso(T - 5 * 60e3),
      heldDep: { trk: 250, off: 0, at: iso(T - 5 * 60e3), since: iso(T - 12 * 60e3), n: 2 } }) });

  const e = M.bande();
  assert.deepEqual(e.to.ids, ["25"]);
  assert.match(e.to.how, /^observed 13:55Z ×2$/);
  assert.equal(e.obsUsed, true, "du direct : le point vert revient");
  assert.ok(!/also observed/.test(M.html()), "plus rien à écarter, plus de note");
});

test("chaque usage tient le sien : le décollage vu n'écrase pas l'atterrissage tenu", () => {
  // Trois départs en 20 dans la fenêtre, aucune arrivée depuis une heure et
  // demie — mais on tenait les arrivées au 07. L'alignement d'un sens sur
  // l'autre ne joue plus : il devine un cap, la mémoire, elle, a vu.
  M.poser({ wind: { direction_deg: 200, speed_kt: 6 },
    obs: censu({ dep: [{ trk: 200, n: 3, off: 0, last: iso(T - 5 * 60e3) }],
      lastDep: iso(T - 5 * 60e3), lastArr: iso(T - 90 * 60e3),
      heldDep: { trk: 200, off: 0, at: iso(T - 5 * 60e3), since: iso(T - 3600e3), n: 3 },
      heldArr: { trk: 70, off: 0, at: iso(T - 90 * 60e3), since: iso(T - 4 * 3600e3), n: 7 } }) });

  const e = M.bande();
  assert.deepEqual(e.to.ids, ["20"]);
  assert.match(e.to.how, /^observed /);
  assert.deepEqual(e.ldg.ids, ["07"], "l'atterrissage garde ce qu'on tenait");
  assert.match(e.ldg.how, /^last observed 12:30Z ×7$/);
});

test("sans configuration tenue, rien ne change : le vent, et pas de note", () => {
  M.poser({ wind: { direction_deg: 200, speed_kt: 10 }, obs: censu({}) });
  const e = M.bande();
  assert.deepEqual(e.to.ids, ["20"]);
  assert.match(e.to.how, /^wind 10 kt head$/, "pas de queue de note sans mémoire : " + e.to.how);
});
