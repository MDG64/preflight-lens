// ============================================================
//  Non-régression de classifyNotam() contre la revue humaine du 2026-07-28.
//
//  Le classificateur vit dans le <script> de notam-filter.html, qui ne
//  s'exécute pas hors navigateur (DOM, service worker, fetch). Plutôt que
//  d'extraire le code dans un module — ce qui obligerait à charger un fichier
//  de plus dans une app volontairement mono-fichier — le test DÉCOUPE la
//  section de classification et l'évalue seule. Les bornes sont repérées par
//  marqueur textuel, jamais par numéro de ligne : le fichier bouge à chaque
//  modification.
//
//  Lancer :  node --test test/
// ============================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(HERE, "..", "notam-filter.html"), "utf8");

async function chargerClassificateur() {
  const L = html.split("\n");
  const debut = L.findIndex(l => l.includes("const SUBJECT_CATEGORIES = {"));
  const fin = L.findIndex(l => l.includes("return { categories: [...cats], severity: severity(q, e), source };"));
  assert.ok(debut >= 0 && fin > debut, "marqueurs de la section de classification introuvables");
  // CNL_TEXT, RESTRICT_TEXT et hasRestrictCond() sont déclarés bien plus bas
  // dans le fichier (severity() les utilise par remontée de portée, comme
  // planKind() qui vit là-bas) : on les rapatrie.
  const src = [
    L.slice(debut, fin + 2).join("\n"),
    "const CNL_TEXT = " + /const CNL_TEXT = (\[[^\]]*\]);/.exec(html)[1] + ";",
    "const RESTRICT_TEXT = " + /const RESTRICT_TEXT = (\[[\s\S]*?\]);/.exec(html)[1] + ";",
    "const RESTRICT_ACFT_RE = " + /const RESTRICT_ACFT_RE = (\/.*\/);/.exec(html)[1] + ";",
    /function hasRestrictCond\(t\) \{[\s\S]*?\n {4}\}/.exec(html)[0],
    "export { classifyNotam };",
  ].join("\n");
  return import("data:text/javascript;base64," + Buffer.from(src).toString("base64"));
}

/** Rejoue l'extraction Q-code / item E) que fait parseNotam() sur le brut. */
function champs(brut) {
  const t = brut.replace(/\r/g, "");
  return {
    q: (/Q\)\s*[A-Z]{4}\/(Q[A-Z]{4})/.exec(t) || [])[1] || null,
    e: (/\bE\)([\s\S]*?)(?=\n\s*[A-Z]\)\s|$)/.exec(t) || [])[1] || "",
  };
}

const { cas } = JSON.parse(readFileSync(join(HERE, "verdicts-aerodrome-2026-07-28.json"), "utf8"));

// Un verdict de revue est un fait DATÉ, pas une vérité perpétuelle : il arrive
// qu'une revue ultérieure le retourne. Le cas est réel — KSKA « BASH PHASE I IN
// EFFECT », rangé au sol le 2026-07-28 puis passé en départ+approche le
// 2026-07-31 avec le mot-clé BASH lui-même. Plutôt que de réécrire le verdict
// d'origine (ce fichier est un enregistrement de décisions humaines, pas une
// liste d'attentes à ajuster jusqu'à ce que ça passe), le cas porte un champ
// `revise` qui date et motive le retournement. C'est lui qui fait foi ici, et
// les deux versions restent lisibles côte à côte.
const verdictRetenu = c => (c.revise ? c.revise.attendu : c.attendu);

test("les 9 NOTAM de terrain relus sont classés conformément à la revue", async () => {
  const { classifyNotam } = await chargerClassificateur();
  const ecarts = [];
  for (const c of cas) {
    const { q, e } = champs(c.texte);
    const obtenu = classifyNotam(q, e).categories.slice().sort().join("+");
    // Le verdict « null » de la revue = le NOTAM reste dans « Unclassified ».
    const attendu = [].concat(verdictRetenu(c)).sort().join("+").replace("null", "non_classe");
    const quand = c.revise ? ` (révisé le ${c.revise.le})` : "";
    if (obtenu !== attendu) ecarts.push(`${c.sujet} (${c.hash.slice(0, 8)}) attendu=${attendu}${quand} obtenu=${obtenu}`);
  }
  assert.deepEqual(ecarts, []);
});

test("une révision de verdict dit bien autre chose que le verdict d'origine", () => {
  // Garde-fou du mécanisme ci-dessus : une révision qui répète le verdict
  // qu'elle est censée corriger ne documente rien et masquerait une régression
  // le jour où le classificateur reviendrait à son comportement d'avant.
  const revises = cas.filter(c => c.revise);
  assert.ok(revises.length, "plus aucune révision : retirer le mécanisme plutôt que le laisser sans emploi");
  for (const c of revises) {
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(c.revise.le), `${c.sujet} : révision sans date exploitable`);
    assert.ok(c.revise.pourquoi, `${c.sujet} : révision sans motif`);
    assert.notDeepEqual([].concat(c.revise.attendu).sort(), [].concat(c.attendu).sort(),
      `${c.sujet} : révision identique au verdict d'origine, à supprimer`);
  }
});

test("le point d'attente est au sol, l'attente en vol reste en approche", async () => {
  const { classifyNotam } = await chargerClassificateur();
  // Cas réel B2380/26 : sortait Ground + Arrival, le mot « HOLDING » suffisant
  // à le ranger aussi en approche. Un point d'attente est une position au sol.
  assert.deepEqual(classifyNotam("QMRXX", "HOLDING POINT E NOT AVBL, USE E1.").categories.sort(),
    ["sol"]);
  assert.deepEqual(classifyNotam("QMXLC", "TWY B HOLDING POSITION MARKINGS U/S").categories.sort(),
    ["sol"]);
  // L'attente EN VOL reste bien de l'approche, par le Q-code (QPH…) comme par
  // le texte quand le Q-code ne dit rien.
  assert.ok(classifyNotam("QPHCS", "HOLDING PROCEDURE RWY 32L REVISED").categories.includes("approche"));
  assert.ok(classifyNotam("QXXXX", "HOLDING PATTERN OVER TOU NDB NOT AVBL").categories.includes("approche"));
});

test("un NOTAM d'ILS est en approche seule, jamais au sol", async () => {
  const { classifyNotam } = await chargerClassificateur();
  // Cas réel B3282/26 : sortait Arrival + Ground, le « (MAINT) » de la cause
  // suffisant à le ranger aussi au sol.
  assert.deepEqual(classifyNotam("QICAS", "ILS RWY 25 U/S (MAINT): DO NOT USE, POSSIBLE FALSE INDICATIONS.").categories,
    ["approche"]);
  // Les composantes de l'ILS suivent le même régime, par leur seul Q-code.
  for (const q of ["QIGAS", "QILAS", "QIDAS", "QIOAS", "QIUAS"])
    assert.deepEqual(classifyNotam(q, "GP RWY 07 U/S DUE MAINT, WIP ON TWY A").categories, ["approche"],
      `${q} devrait être en approche seule`);
  // Sans Q-code exploitable, le texte prend le relais.
  assert.deepEqual(classifyNotam("QXXXX", "ILS RWY 25 U/S (MAINT)").categories, ["approche"]);
  assert.deepEqual(classifyNotam(null, "ILS RWY 25 U/S (MAINT)").categories, ["approche"]);
  // Mais l'ILS cité comme CAUSE ne doit pas dépouiller une fermeture de piste :
  // là c'est le Q-code qui tranche, et il ne parle pas d'ILS.
  assert.ok(classifyNotam("QMRLC", "RWY 25 CLSD DUE ILS MAINT").categories.includes("sol"));
  // Et « ILS » en sous-chaîne d'un autre mot ne déclenche pas le forçage : le
  // « sol » de ce NOTAM de taxiway survit. (Il repart quand même AUSSI en
  // approche — le mot-clé historique « ILS » de FREETEXT_KEYWORDS attrape
  // « DETAILS » par sous-chaîne ; c'est un faux positif antérieur, additif,
  // qu'on se contente de ne pas aggraver ici.)
  assert.ok(classifyNotam("QXXXX", "TWY A CLSD, SEE AIP FOR DETAILS").categories.includes("sol"));
});

test("la famille VOR/TACAN sert au départ autant qu'à l'arrivée", async () => {
  const { classifyNotam } = await chargerClassificateur();
  // Cas réel F1570/26 : sortait Arrival + Ground. Le TACAN sert aussi les SID,
  // et le « (MAINT) » de la cause n'en fait pas un NOTAM de surface.
  assert.deepEqual(classifyNotam("QNNAS", "TACAN LOR CH105X U/S (MAINT): DO NOT USE, POSSIBLE FALSE INDICATIONS").categories.sort(),
    ["approche", "depart"]);
  // Les quatre codes de la famille vont ensemble : VOR/DME, TACAN, VORTAC, VOR.
  for (const q of ["QNMAS", "QNNAS", "QNTAS", "QNVAS"])
    assert.deepEqual(classifyNotam(q, "U/S DUE TO MAINT").categories.sort(), ["approche", "depart"],
      `${q} devrait être en approche + départ`);
  // Sans Q-code exploitable, le texte donne les deux phases lui aussi.
  assert.deepEqual(classifyNotam("QXXXX", "VOR TOU U/S").categories.sort(), ["approche", "depart"]);
  // Les autres aides restent en approche seule : ni le NDB ni le DME ne sont
  // devenus des aides de départ au passage.
  assert.deepEqual(classifyNotam("QNBAS", "NDB U/S").categories, ["approche"]);
  assert.deepEqual(classifyNotam("QNDAS", "DME U/S").categories, ["approche"]);
});

test("le PAR reste en arrivée seule, et « MAINT » ne classe plus rien à lui seul", async () => {
  const { classifyNotam } = await chargerClassificateur();
  // Cas réel M2497/26 : sortait Arrival + Ground, sur le seul « DUE TO MAINT ».
  assert.deepEqual(classifyNotam("QCPAS", "PAR RWY 25, 07 AND 20 U/S DUE TO MAINT.").categories,
    ["approche"]);
  // « MAINT » ne s'ajoute plus à un classement existant…
  assert.deepEqual(classifyNotam("QPDAS", "SID XYZ 2A SUSPENDED DUE TO MAINT").categories, ["depart"]);
  // …mais il garde toute sa valeur en dernier recours, quand rien d'autre ne
  // classe : c'est le cas des NOTAM américains en QXXXX.
  assert.deepEqual(classifyNotam("QXXXX", "MAINT IN PROGRESS").categories, ["sol"]);
  assert.deepEqual(classifyNotam(null, "SCHEDULED MAINT").categories, ["sol"]);
  // Et une surface citée reste au sol, la maintenance n'y change rien.
  assert.ok(classifyNotam("QMXLC", "TWY B CLSD DUE TO MAINT").categories.includes("sol"));
  assert.ok(classifyNotam("QXXXX", "APRON MAINT IN PROGRESS").categories.includes("sol"));
});

test("capacité de stationnement et assistance en piste sont au sol", async () => {
  const { classifyNotam } = await chargerClassificateur();
  // Cas réels RJSM L0023/26 et L0024/26 (propositions LLM du 2026-08-03), tous
  // deux en QXXXX : sans mot-clé de lieu ils restaient « Unclassified ».
  assert.deepEqual(classifyNotam("QXXXX",
    "WORKING MOG FOR AMC ATGHS MISAWA IS ONE WIDE-BODY OR TWO NARROW-BODY AIRCRAFT").categories,
    ["sol"]);
  assert.deepEqual(classifyNotam("QXXXX",
    "AMC ATGHS HAS NO POTABLE WATER TRUCK AVAILABLE UNTIL FURTHER NOTICE.").categories,
    ["sol"]);
  // La forme développée passe aussi bien que l'abréviation.
  assert.deepEqual(classifyNotam("QXXXX", "MAX ON GROUND REDUCED TO TWO ACFT").categories, ["sol"]);
  // Mais MOGAS n'est pas un MOG : le mot-clé est encadré d'espaces pour que la
  // comparaison par sous-chaîne ne l'attrape pas.
  assert.deepEqual(classifyNotam("QXXXX", "MOGAS NOT AVBL").categories, ["non_classe"]);
  // Et le mot-clé ne dépouille pas un classement plus précis venu du Q-code.
  assert.ok(classifyNotam("QICAS", "ILS RWY 25 U/S, NO POTABLE WATER TRUCK").categories.includes("approche"));
});

test("« WITHDRAWN » ne classe en Critical que s'il retire une surface", async () => {
  const { classifyNotam } = await chargerClassificateur();
  // Cas réel LFBD A1354/26 : le mot suffisait à faire une fermeture totale —
  // pastille rouge dans la liste ET piste rouge plein sur le plan — alors que
  // seules des VALEURS publiées à l'AIP sont retirées.
  assert.equal(classifyNotam("QMRXX",
    "RWY 23 AND 29 TDZ VALUES WITHDRAWN : REF AIP AD 2 LFBD.12.").severity, "caution");
  // Une vraie surface retirée du service reste bien Critical.
  assert.equal(classifyNotam("QMRLC", "RWY 05/23 WITHDRAWN").severity, "critical");
  // Et « NOTAM WITHDRAWN » est une annulation : Information, comme NOTAM CNL /
  // NOTAM VOID. C'est aussi ce que le plan en dit (planKind -> "reopened") ;
  // avant, la liste le contredisait en le laissant Critical.
  assert.equal(classifyNotam("QMRXX", "TWY M23 - NOTAM WITHDRAWN").severity, "info");
  assert.equal(classifyNotam("QMRXX", "TWY M23 - NOTAM VOID").severity, "info");
});

test("un REIL hors service est ambre, en départ ET en approche", async () => {
  const { classifyNotam } = await chargerClassificateur();
  // Cas réel KVCV 02/017 (proposition LLM du 2026-08-07) : en QXXXX, aucun
  // mot-clé ne l'attrapait -> « Unclassified », et le seul « U/S » l'aurait
  // classé Critical. La revue le veut ambre, sur les deux phases.
  const kvcv = classifyNotam("QXXXX", "RWY 35 RWY END ID LGT U/S");
  assert.deepEqual(kvcv.categories.sort(), ["approche", "depart"]);
  assert.equal(kvcv.severity, "caution");
  // Les autres graphies de la même installation passent aussi.
  for (const e of ["REIL RWY 35 U/S", "RWY 17 END IDENT LGT U/S",
                   "RUNWAY END IDENTIFIER LIGHTS RWY 09 OUT OF SERVICE"])
    assert.deepEqual(classifyNotam("QXXXX", e).categories.sort(), ["approche", "depart"], e);
  // CREIL (LFPC) n'est pas un REIL : le mot-clé est encadré d'un espace à
  // gauche pour que la comparaison par sous-chaîne ne l'attrape pas.
  assert.deepEqual(classifyNotam("QXXXX", "CREIL TRAINING AREA ACTIVE").categories, ["non_classe"]);
  // Le plafond ambre ne masque pas une fermeture citée dans le même message.
  assert.equal(classifyNotam("QMRLC", "RWY 35 CLSD. RWY END ID LGT U/S").severity, "critical");
  assert.equal(classifyNotam("QXXXX", "REIL RWY 35 U/S. LDG RWY 35 PROHIBITED").severity, "critical");
  // Et il ne s'applique qu'aux feux hors service, pas à toute mention de REIL.
  assert.equal(classifyNotam("QMRLC", "RWY 35 CLSD, REIL RELOCATED").severity, "critical");
});

test("les activités annoncées — drones et feux d'artifice — sont de l'Information", async () => {
  const { classifyNotam } = await chargerClassificateur();
  // Cas réels R2211/26 (QWULW) et D3872/26 (QWZLW) : ressortaient Caution
  // ambre, la condition « LW » étant inconnue de CONDITION_SEVERITY. Une
  // activité annoncée se note, elle ne ferme rien.
  assert.equal(classifyNotam("QWULW",
    "UNMANNED ACFT WILL TAKE PLACE WI COORD 280340N 0163025W - 280403N 0162959W").severity, "info");
  assert.equal(classifyNotam("QWZLW",
    "FIREWORKS DISPLAY AT COORD 280229N 0163914W LAS GALLETAS/ ARONA").severity, "info");
  // Sans Q-code exploitable, le texte prend le relais.
  assert.equal(classifyNotam("QXXXX", "DRONE OPS WI 2NM RADIUS OF AD, SFC-400FT AGL").severity, "info");
  assert.equal(classifyNotam(null, "FIREWORKS DISPLAY OVER THE HARBOUR").severity, "info");
  // Mais une fermeture qui cite l'activité comme CAUSE reste critique : le
  // mot « DRONE » ne doit pas dépouiller un « RWY CLSD ».
  assert.equal(classifyNotam("QMRLC", "RWY 07/25 CLSD DUE TO DRONE ACTIVITY").severity, "critical");
  // Et « TWR UNMANNED » (tour non tenue) n'est pas un NOTAM de drone : seul
  // « UNMANNED ACFT/AIRCRAFT » compte, jamais le mot nu.
  assert.notEqual(classifyNotam("QSTAH", "TWR UNMANNED DLY 2200-0600").severity, "info");
});

test("une annulation qui recopie son en-tête n'est jamais soumise au LLM", () => {
  // Ces NOTAMC ONT un item E) — il recopie l'en-tête, mot pour mot. Le filtre
  // `n.e` de proposeUnclassified() les laissait donc passer : 5 appels LLM sur
  // les 9 propositions de terrain de la revue, pour des textes sans la moindre
  // information opérationnelle.
  const re = new RegExp(/const CANCEL_ECHO_RE = (\/.*\/);/.exec(html)[1].slice(1, -1));
  const annulations = cas.filter(c => re.test(champs(c.texte).e));
  assert.equal(annulations.length, 5);
  // Tous ont bien été tranchés « null » par la revue : les écarter ne perd rien.
  assert.ok(annulations.every(c => [].concat(c.attendu).join("") === "null"));
  // Et le garde-fou doit rester branché sur la liste des envois.
  assert.ok(html.includes("!CANCEL_ECHO_RE.test(n.e)"),
    "le garde-fou de proposeUnclassified() a disparu");
  // Aucun NOTAM porteur de texte réel ne doit tomber dans le filtre.
  for (const c of cas.filter(x => !annulations.includes(x))) {
    assert.ok(!re.test(champs(c.texte).e), `${c.sujet} filtré à tort`);
  }
});
