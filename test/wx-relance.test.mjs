// ============================================================
//  La SECONDE LECTURE de la page Weather (2026-09-03).
//
//  Le proxy sert les relevés depuis sa copie du fichier mondial de l'AWC et
//  la relit EN FOND : la première demande après une accalmie reçoit le relevé
//  d'avant. La page repasse donc une fois, huit secondes après l'ouverture —
//  sauf si le proxy dit avoir attendu son rafraîchissement (`refreshing:
//  false`). Ici on juge ce que la PAGE en fait : la lecture de la réponse
//  (wxFetchReply) et la décision de relance (wxPlanRelance), découpées dans le
//  code réellement déployé, par marqueur textuel et jamais par numéro de ligne.
//
//  Lancer :  node --test test/wx-relance.test.mjs
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
  assert.ok(m, `${quoi} introuvable dans notam-filter.html — le marqueur a changé`);
  return m[0];
}

/* Le module rejoue le code déployé avec un réseau et des minuteries de
   papier : `fetch` rend les réponses préparées dans l'ordre, `setTimeout` ne
   fait que noter ce qu'on lui confie. Déclarés en tête de module, ils
   masquent les globaux pour le code découpé — sans toucher à ceux du
   lanceur de tests. Le nonce en tête rend chaque chargement DISTINCT : deux
   sources identiques donneraient le même module, et son journal, à tous les
   tests. */
let nonce = 0;
async function charger() {
  const src = [
    "// chargement " + (++nonce),
    "const BACKEND_URL = 'http://proxy.test';",
    "const journal = { fetch: [], timers: [], cleared: [], silent: 0 };",
    "let reponses = [];",
    "const fetch = async (url, opts) => { journal.fetch.push({ url, cache: opts && opts.cache }); const d = reponses.shift(); return { ok: true, status: 200, json: async () => d }; };",
    "let seq = 0;",
    "const setTimeout = (fn, ms) => { const id = ++seq; journal.timers.push({ id, ms, fn }); return id; };",
    "const clearTimeout = id => journal.cleared.push(id);",
    "function refreshWxSilent() { journal.silent++; }",
    // --- ce qui est mesuré : le code déployé ---
    decoupe(/const WX_BATCH_MAX = \d+;/, "WX_BATCH_MAX"),
    decoupe(/async function wxFetchReply\(ids\) \{[\s\S]*?\n {4}\}/, "wxFetchReply()"),
    decoupe(/const WX_RELANCE_MS = [\de.]+;/, "WX_RELANCE_MS"),
    decoupe(/let wxRelance = null;\n {4}function wxPlanRelance\(reply\) \{[\s\S]*?\n {4}\}/, "wxPlanRelance()"),
    "const setReponses = r => { reponses = r; };",
    "const relanceEnCours = () => wxRelance;",
    "export { wxFetchReply, wxPlanRelance, WX_RELANCE_MS, WX_BATCH_MAX, journal, setReponses, relanceEnCours };",
  ].join("\n");
  return import("data:text/javascript;base64," + Buffer.from(src).toString("base64"));
}

const station = icao => ({ icao, metar: { raw: `METAR ${icao} 030800Z 27010KT CAVOK 20/10 Q1020` }, taf: null });

test("wxFetchReply : la requête part sans se resservir du cache HTTP, et rend les stations", async () => {
  const M = await charger();
  M.setReponses([{ stations: { LFPG: station("LFPG"), LFBO: station("LFBO") } }]);
  const r = await M.wxFetchReply(["LFPG", "LFBO"]);
  assert.equal(M.journal.fetch.length, 1);
  assert.equal(M.journal.fetch[0].cache, "no-cache");
  assert.match(M.journal.fetch[0].url, /\/api\/wx\?ids=LFPG,LFBO$/);
  assert.deepEqual(Object.keys(r.stations), ["LFPG", "LFBO"]);
  assert.equal(r.refreshing, undefined, "un proxy muet sur ce point ne dit ni vrai ni faux");
});

test("wxFetchReply : `refreshing` du proxy se lit, et un seul lot en vol suffit", async () => {
  const M = await charger();
  const ids = Array.from({ length: M.WX_BATCH_MAX + 1 }, (_, i) => "AA" + String(i).padStart(2, "0"));
  const lot = liste => Object.fromEntries(liste.map(i => [i, station(i)]));
  M.setReponses([
    { stations: lot(ids.slice(0, M.WX_BATCH_MAX)), refreshing: false },
    { stations: lot(ids.slice(M.WX_BATCH_MAX)), refreshing: true },
  ]);
  const r = await M.wxFetchReply(ids);
  assert.equal(M.journal.fetch.length, 2, "deux lots, deux requêtes");
  assert.equal(Object.keys(r.stations).length, ids.length, "les deux lots se rejoignent");
  assert.equal(r.refreshing, true);

  M.setReponses([{ stations: {}, refreshing: false }, { stations: {}, refreshing: false }]);
  assert.equal((await M.wxFetchReply(ids)).refreshing, false, "attendu des deux côtés : rien à relancer");
});

test("wxPlanRelance : le proxy qui a attendu son rafraîchissement dispense de la relance", async () => {
  const M = await charger();
  M.wxPlanRelance({ refreshing: false });
  assert.equal(M.journal.timers.length, 0);
  assert.equal(M.relanceEnCours(), null);
});

test("wxPlanRelance : proxy muet ou téléchargement en vol -> une relance silencieuse, huit secondes après", async () => {
  const M = await charger();
  for (const reply of [{}, { refreshing: true }]) {
    M.journal.timers.length = 0;
    M.wxPlanRelance(reply);
    assert.equal(M.journal.timers.length, 1, JSON.stringify(reply));
    assert.equal(M.journal.timers[0].ms, M.WX_RELANCE_MS);
    assert.ok(M.WX_RELANCE_MS >= 5e3 && M.WX_RELANCE_MS <= 15e3, "assez pour le téléchargement du proxy, moins que la minuterie de la minute");
    assert.ok(M.relanceEnCours() != null, "la relance est retenue, pour pouvoir l'annuler");
    M.journal.timers[0].fn();
    assert.equal(M.relanceEnCours(), null, "une fois partie, plus rien à annuler");
  }
  assert.equal(M.journal.silent, 2, "chaque relance passe par la lecture silencieuse");
});

test("wxPlanRelance : une nouvelle lecture remplace la relance en attente, elle ne s'y ajoute pas", async () => {
  const M = await charger();
  M.wxPlanRelance({});
  const premiere = M.journal.timers[0].id;
  M.wxPlanRelance({});
  assert.deepEqual(M.journal.cleared, [premiere], "la première est annulée");
  assert.equal(M.journal.timers.length, 2);
  assert.notEqual(M.relanceEnCours(), premiere);
});
