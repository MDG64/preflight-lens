// ============================================================
//  Non-régression du pouce vent des cartes QFU de minima.html
//  (chantier du 2026-08-31 : la pastille lisait encore le seul METAR).
//
//  Depuis que chaque phase se juge sur la plus restrictive des deux lectures —
//  le relevé de maintenant et le vent limitant de la prévision dans SA fenêtre,
//  rafale d'un TEMPO/PROB comprise — la case « Wind » pouvait afficher un pouce
//  rouge (35 kt d'arrière annoncés) pendant que la carte du QFU restait au
//  panneau d'avertissement, faute de voir autre chose que l'observation.
//
//  Cas réel fondateur : LFPO 2026-08-31, QFU 07 (073°), METAR 250°/15 kt et une
//  prévision à 35 kt d'arrière dans la fenêtre du décollage. Deux causes
//  cumulées, dont ce test garde les deux :
//    1. la carte ne recevait que state.metar.wind ;
//    2. même sur l'observation, 15 kt d'arrière contre une limite de 15 kt
//       n'est PAS un dépassement (comparaison stricte) et sort en « marginal ».
//  Le point 2 est le barème voulu et ne bouge pas ; c'est le point 1 qui est
//  corrigé — qfuWindState prend désormais la LISTE des vents de la phase et
//  retient la composante la plus forte, en travers et en arrière séparément.
//
//  Comme classify.test.mjs et minima-notam-flags.test.mjs : on DÉCOUPE le code
//  réellement déployé, repéré par marqueur textuel et jamais par numéro de
//  ligne. cfg (limites de l'avion) et currentMagvar() sont les seuls points
//  extérieurs : le test fournit les siens.
//
//  Lancer :  node --test test/minima-qfu-vent.test.mjs
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

/** Le barème vent des cartes QFU, extrait tel qu'il tourne. */
async function chargerBaremeVent() {
  const src = [
    // Limites de l'avion : celles d'un moyen-courrier, valeurs du Setup.
    "let cfg = {maxCrosswindKt:38, maxTailwindKt:15};",
    "export const setLimites = c => { cfg = c; };",
    // Déclinaison du terrain : mise à zéro pour que les caps du test soient
    // lisibles tels quels (la conversion vrai → magnétique a son propre test).
    "let MAGVAR = 0;",
    "export const setMagvar = v => { MAGVAR = v; };",
    "function currentMagvar(){ return MAGVAR; }",
    decoupe(/function windComponents\(qfuDeg, dir, speed\)\{[\s\S]*?\n\}/, "windComponents()"),
    decoupe(/function qfuWindState\(deg, winds\)\{[\s\S]*?\n\}/, "qfuWindState()"),
    decoupe(/function phaseWinds\(wind, r\)\{[\s\S]*?\n\}/, "phaseWinds()"),
    "export { qfuWindState, phaseWinds, windComponents };",
  ].join("\n");
  return import("data:text/javascript;base64," + Buffer.from(src).toString("base64"));
}

const QFU_07 = 73;
const METAR_LFPO = { direction_deg: 250, speed_kt: 15 };          // 15 kt d'arrière pile
const TAF_RAFALE = { direction_deg: 250, speed_kt: 20, gust_kt: 35 };

test("le relevé seul : 15 kt d'arrière contre 15 kt de limite reste un avertissement", async () => {
  const { qfuWindState } = await chargerBaremeVent();
  const { c, st } = qfuWindState(QFU_07, [METAR_LFPO]);
  assert.equal(c.tail, 15);
  assert.equal(c.cross, 1);
  // Comparaison STRICTE : à la limite on n'est pas au-delà. Marge nulle ≤ 1 kt
  // → marginal. C'est le barème voulu, pas le défaut corrigé.
  assert.equal(st, "marginal");
});

test("la prévision de la phase entre dans le pouce de la carte", async () => {
  const { qfuWindState } = await chargerBaremeVent();
  // Le cas LFPO : la carte 07 sortait « marginal » quand la case « Wind »
  // affichait déjà 35 kt d'arrière contre 15 — c'est le défaut du 2026-08-31.
  const { c, st } = qfuWindState(QFU_07, [METAR_LFPO, TAF_RAFALE]);
  assert.equal(c.tail, 35);
  assert.equal(st, "nogo");
});

test("chaque composante prend son pire vent, séparément", async () => {
  const { qfuWindState } = await chargerBaremeVent();
  // Le travers vient d'un vent, l'arrière d'un autre : les deux ne viennent pas
  // forcément du même — c'est le pickMax par composante du moteur.
  const travers = { direction_deg: 163, speed_kt: 30 };   // plein travers du 07
  const arriere = { direction_deg: 250, speed_kt: 20 };
  const { c, st } = qfuWindState(QFU_07, [travers, arriere]);
  assert.equal(c.cross, 30);
  assert.equal(c.tail, 20);
  assert.equal(st, "nogo");   // 20 kt d'arrière > 15
});

test("un vent de face ne se compte pas comme un arrière négatif", async () => {
  const { qfuWindState } = await chargerBaremeVent();
  // Sans le plancher à 0, une composante de face « -20 » aurait pu passer pour
  // le pire arrière d'une liste et fausser la marge.
  const face = { direction_deg: 73, speed_kt: 20 };
  const traversPur = { direction_deg: 163, speed_kt: 10 };
  const { c, st } = qfuWindState(QFU_07, [face, traversPur]);
  assert.equal(c.tail, 0);
  assert.equal(c.cross, 10);
  assert.equal(st, "go");
});

test("un vent sans direction ne vote pas mais n'efface pas les autres", async () => {
  const { qfuWindState } = await chargerBaremeVent();
  const vrb = { direction_deg: null, speed_kt: 25, variable: true };
  assert.equal(qfuWindState(QFU_07, [vrb]).st, "unknown");
  assert.equal(qfuWindState(QFU_07, [vrb, TAF_RAFALE]).st, "nogo");
});

test("un vent seul reste accepté — l'appel du surlignage TAF le fait encore", async () => {
  const { qfuWindState } = await chargerBaremeVent();
  assert.equal(qfuWindState(QFU_07, TAF_RAFALE).st, "nogo");
  assert.equal(qfuWindState(QFU_07, null).st, "unknown");
  assert.equal(qfuWindState(QFU_07, []).st, "unknown");
});

test("la rafale gouverne, même annoncée par la prévision", async () => {
  const { qfuWindState } = await chargerBaremeVent();
  const sansRafale = { direction_deg: 250, speed_kt: 20 };
  assert.equal(qfuWindState(QFU_07, [sansRafale]).c.tail, 20);
  assert.equal(qfuWindState(QFU_07, [TAF_RAFALE]).c.tail, 35);
});

test("phaseWinds prend les vents du moteur, et retombe sur l'observation à défaut", async () => {
  const { phaseWinds } = await chargerBaremeVent();
  const r = { windCands: [{ w: METAR_LFPO, src: "METAR" }, { w: TAF_RAFALE, src: "TAF" }] };
  assert.deepEqual(phaseWinds(METAR_LFPO, r), [METAR_LFPO, TAF_RAFALE]);
  // Phase pas encore calculée, ou verdict tombé en erreur (assess() rend alors
  // un résultat nu) : la seule observation, comportement d'avant le chantier.
  assert.deepEqual(phaseWinds(METAR_LFPO, undefined), [METAR_LFPO]);
  assert.deepEqual(phaseWinds(METAR_LFPO, { overall: "UNKNOWN", verdicts: [] }), [METAR_LFPO]);
  assert.deepEqual(phaseWinds(METAR_LFPO, { windCands: [] }), [METAR_LFPO]);
  assert.deepEqual(phaseWinds(null, null), []);
});

test("le moteur pose bien sa liste de vents sur le résultat de la phase", () => {
  // Sans cette ligne, phaseWinds() retomberait silencieusement sur le relevé et
  // les cartes repartiraient dans le défaut corrigé, tests verts à l'appui.
  const bloc = decoupe(
    /if \(fcLim && fcLim\.gustOverride\) windCands\.push\([\s\S]*?if \(qfu!=null && windCands\.length\)\{/,
    "la construction de windCands");
  assert.match(bloc, /res\.windCands = windCands;/);
});

test("plus aucune carte ne juge le vent sur le seul relevé", () => {
  // Le défaut d'origine tenait en un argument : qfuWindState(q.deg, wind).
  // Tout appel doit désormais passer par phaseWinds() — sauf celui du
  // surlignage TAF, qui juge UN groupe du message et se nomme.
  const appels = html.split("\n")
    .filter(l => l.includes("qfuWindState(") && !l.includes("function qfuWindState("));
  assert.ok(appels.length >= 3, "les appels de qfuWindState ont disparu — marqueur à revoir");
  for (const l of appels) {
    assert.ok(/phaseWinds\(|pick\.w/.test(l), `appel resté au relevé seul : ${l.trim()}`);
  }
});
