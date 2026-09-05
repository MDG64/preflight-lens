// Service Worker — Preflight Lens PWA (fichiers et clé de cache restés "notam-filter-*" :
// renommer casserait les URL GitHub Pages déjà en circulation ; le nom public de
// l'app a changé le 2026-08-18, ses URL non)
// v3 : "réseau d'abord" pour l'app (les MAJ s'affichent au prochain lancement),
//       "cache d'abord" pour les icônes, les appels API toujours en réseau,
//       et les PLANS (layouts/*.json) mis en cache à l'usage -> consultables
//       en vol, sans connexion.
// La clé de cache reste v5 À DESSEIN. Un service worker se réinstalle dès que
// ses OCTETS changent, quelle que soit cette clé : la renommer n'apporte donc
// aucun rafraîchissement, elle ne fait qu'une chose — `activate` supprime tous
// les caches dont le nom diffère, c'est-à-dire les plans (layouts/*.json) et
// les frontières FIR que les pilotes ont téléchargés pour consulter EN VOL.
// Ne la changer que si on veut délibérément purger les appareils.
const CACHE = "notam-filter-v5";
const ASSETS = [
  "./notam-filter.html", "./index.html", "./manifest.json", "./legal.html",
  // legal.html est pré-caché depuis sa publication (3 août 2026) : son article
  // premier rend les CGU opposables à l'usage du Service, elles doivent donc
  // rester lisibles même sans réseau. Rappel pour la suite : addAll() est
  // atomique — un seul 404 et TOUT le pré-cache échoue silencieusement, donc
  // n'ajouter ici que des fichiers dont l'existence est certaine.
  // Suffixe "-v2" À DESSEIN (4 août 2026, nouvelle icône N + loupe). La règle 5
  // sert les icônes en CACHE D'ABORD et la clé CACHE reste figée : réécrire
  // icon-192.png en place n'aurait JAMAIS atteint les appareils déjà installés,
  // ils auraient servi l'ancienne image indéfiniment. Changer le NOM change
  // l'URL, donc le cache la rate et va la chercher — sans purger la clé, ce qui
  // aurait effacé les plans hors ligne des pilotes. Même geste à la prochaine
  // refonte d'icône : incrémenter le suffixe, ne pas écraser.
  // Suffixe "-v4" (26 août 2026) : PREFLIGHT agrandi. Les favicons "PL" n'ont
  // pas changé, ils restent en v3.
  // Les MASKABLE passent en "-v5" (27 août 2026) : leur motif débordait de la
  // zone que la spécification garantit visible — un cercle de 80 % du côté —,
  // le manche de la loupe atteignant 94 % du demi-côté. Certains lanceurs
  // Android l'auraient rogné. Motif réduit de 17 %, dessin inchangé, fond
  // toujours plein-cadre. Les icônes "any", elles, n'ont pas de zone sûre à
  // respecter et restent en v4.
  "./icons/icon-192-v4.png", "./icons/icon-512-v4.png", "./icons/icon-maskable-192-v5.png", "./icons/icon-maskable-512-v5.png",
  "./icons/icon-180-v4.png", "./icons/favicon-32-v3.png", "./icons/favicon-16-v3.png", "./favicon.ico",
  // Photos des cases d'accueil (19 aout 2026). Meme regle que les icones :
  // servies "cache d'abord" par la regle 6, donc le nom porte la version — une
  // refonte d'image change le suffixe, on n'ecrase jamais en place.
  "./home-wx-v8.jpg", "./home-notam-v13.png", "./home-map-v3.jpg", "./home-minima-v1.jpg",
  // MINIMAS (28 aout 2026) : le module minima (copie déployée de Minima Lens)
  // et ses deux bases embarquées — la page doit s'ouvrir en vol, comme l'hôte.
  // Les bases se régénèrent (recompilation du seed, fiches d'approche) : la
  // règle 3 les sert « réseau d'abord », comme l'annuaire — le pré-cache ne
  // fige rien, il garantit seulement le premier lancement hors ligne.
  "./minima.html", "./airfield-seed.js", "./aircraft-db.js",
  // Temps de vol par route (2026-09-03), régénéré comme les bases : règle 3.
  "./routes-seed.js",
  // Fuseau horaire des terrains (2026-09-04), régénéré comme les bases par
  // Weather Lens/Tools/build-airport-tz.js : règle 3. Sans lui, les heures du vol
  // restent en Z seul — la page s'ouvre quand même.
  "./airport-tz.js",
  // La liste des manœuvres (2026-08-30), lue par le module minima ET par le
  // suivi. Elle ne se régénère pas comme les bases : c'est du code, elle suit
  // donc l'app. Sans elle, la fiche terrain n'affiche plus ni circling ni
  // sidestep, et le suivi ne les compte plus — les deux pages en dépendent
  // désormais, et le pré-cache doit les servir ensemble hors ligne.
  // Elle est aussi listée en règle 3 (« elle suit l'app ») : pré-cachée SEULE,
  // elle serait retombée en règle 6 « cache d'abord » et n'aurait plus jamais
  // consulté le réseau — la copie prise au dernier changement de sw.js aurait
  // tenu pour toujours, et une retouche de la liste n'aurait atteint AUCUN
  // appareil déjà installé. Le pré-cache garantit le premier lancement hors
  // ligne, la règle 3 garantit la mise à jour.
  "./manoeuvres.js",
  // Le suivi de la base : il lit le journal partage quand il le peut, et sa
  // derniere copie connue sinon -- encore faut-il que la PAGE soit la. Sans
  // ce pre-cache, hors ligne on n'aurait meme pas l'ecran pour le dire.
  "./suivi.html",
  // Le dépôt de fiches d'approche. Sa file d'attente IndexedDB existe POUR
  // le hors-ligne — une fiche photographiée sans réseau part au retour —,
  // mais sans la page en cache on tombait sur le repli, c'est-à-dire
  // l'accueil de Preflight : la file était injoignable exactement quand elle
  // sert. Son annuaire (annuaire-terrains.js) reste en règle 3, la page sait
  // déjà s'en passer ; son manifeste et ses icônes ne servent qu'à
  // l'installation, en ligne.
  "./fiches.html",
  // Polices auto-hébergées (2026-08-06, retrait de Google Fonts). Pré-cache
  // OBLIGATOIRE : la règle 6 les sert « cache d'abord » mais ne dépose jamais
  // rien — sans cette liste, la typo tomberait en police système hors ligne.
  // Noms versionnés (v20/v23) : immuables, mêmes règles que les icônes -v2.
  // Suffixe "-v2" sur les Mono latin (2026-08-21) : glyphes retouchés pour
  // ôter le point au centre du zéro — nouveau contenu, donc nouveau nom.
  // Passage à "-v3" (2026-08-26) : ces mêmes fichiers sortent du Reserved Font
  // Name « Plex » que l'OFL protège (une version modifiée ne peut pas garder le
  // nom réservé) — la famille interne devient « Preflight Mono », le CSS suit.
  // Les latin-ext ne sont pas retouchés : mêmes octets, donc même nom.
  "./fonts/ibm-plex-sans-v23-latin-wght.woff2",
  "./fonts/ibm-plex-sans-v23-latin-ext-wght.woff2",
  "./fonts/ibm-plex-mono-v20-latin-400-v3.woff2",
  "./fonts/ibm-plex-mono-v20-latin-ext-400.woff2",
  "./fonts/ibm-plex-mono-v20-latin-500-v3.woff2",
  "./fonts/ibm-plex-mono-v20-latin-ext-500.woff2",
  "./fonts/ibm-plex-mono-v20-latin-600-v3.woff2",
  "./fonts/ibm-plex-mono-v20-latin-ext-600.woff2",
  // Le picto de REPLI de la bande météo du jour. Les deux pages le nomment en
  // dur dans leur onerror (dayWxIconHtml / dwxIconHtml) : c'est le seul des 83
  // dont l'absence ne se rattrape par rien, puisqu'il EST le rattrapage. Les 82
  // autres passent par le réchauffage ci-dessous, qui a le droit d'échouer ;
  // celui-ci est dans le pré-cache atomique, avec les polices, parce que son
  // existence est certaine et qu'on ne veut pas d'un carré vide en vol.
  "./vendor/weather/cloudy.svg"
];

/* PICTOGRAMMES MÉTÉO met.no — le vocabulaire complet (83 symboles, ~280 Ko).
   Le code symbole EST le nom du fichier, et l'amont peut renvoyer n'importe
   lequel : sans réchauffage, seuls ceux DÉJÀ RENCONTRÉS en ligne existaient
   hors ligne (la règle 5 les dépose au passage, mais ne devine rien). Un vol
   qui change de météo — ou simplement de jour à nuit, chaque symbole ayant ses
   variantes _day/_night/_polartwilight — tombait donc sur le repli, quand il
   n'était pas là non plus.
   HORS du pré-cache atomique À DESSEIN : addAll() est tout ou rien, et faire
   dépendre l'installation entière de 83 noms de fichiers tiers, c'est offrir à
   un seul renommage le pouvoir de bloquer TOUTES les mises à jour de l'app.
   Le réchauffage, lui, échoue fichier par fichier et ne coûte rien.
   Les noms viennent du répertoire, coquilles d'amont comprises
   (« lightssleetshowersandthunder », deux s : c'est le nom réel chez met.no).
   Un symbole ajouté dans vendor/weather/ doit être ajouté ICI. */
const WX_SYMBOLS = [
  "clearsky_day", "clearsky_night", "clearsky_polartwilight", "cloudy",
  "fair_day", "fair_night", "fair_polartwilight", "fog",
  "heavyrain", "heavyrainandthunder", "heavyrainshowers_day", "heavyrainshowers_night",
  "heavyrainshowers_polartwilight", "heavyrainshowersandthunder_day", "heavyrainshowersandthunder_night", "heavyrainshowersandthunder_polartwilight",
  "heavysleet", "heavysleetandthunder", "heavysleetshowers_day", "heavysleetshowers_night",
  "heavysleetshowers_polartwilight", "heavysleetshowersandthunder_day", "heavysleetshowersandthunder_night", "heavysleetshowersandthunder_polartwilight",
  "heavysnow", "heavysnowandthunder", "heavysnowshowers_day", "heavysnowshowers_night",
  "heavysnowshowers_polartwilight", "heavysnowshowersandthunder_day", "heavysnowshowersandthunder_night", "heavysnowshowersandthunder_polartwilight",
  "lightrain", "lightrainandthunder", "lightrainshowers_day", "lightrainshowers_night",
  "lightrainshowers_polartwilight", "lightrainshowersandthunder_day", "lightrainshowersandthunder_night", "lightrainshowersandthunder_polartwilight",
  "lightsleet", "lightsleetandthunder", "lightsleetshowers_day", "lightsleetshowers_night",
  "lightsleetshowers_polartwilight", "lightsnow", "lightsnowandthunder", "lightsnowshowers_day",
  "lightsnowshowers_night", "lightsnowshowers_polartwilight", "lightssleetshowersandthunder_day", "lightssleetshowersandthunder_night",
  "lightssleetshowersandthunder_polartwilight", "lightssnowshowersandthunder_day", "lightssnowshowersandthunder_night", "lightssnowshowersandthunder_polartwilight",
  "partlycloudy_day", "partlycloudy_night", "partlycloudy_polartwilight", "rain",
  "rainandthunder", "rainshowers_day", "rainshowers_night", "rainshowers_polartwilight",
  "rainshowersandthunder_day", "rainshowersandthunder_night", "rainshowersandthunder_polartwilight", "sleet",
  "sleetandthunder", "sleetshowers_day", "sleetshowers_night", "sleetshowers_polartwilight",
  "sleetshowersandthunder_day", "sleetshowersandthunder_night", "sleetshowersandthunder_polartwilight", "snow",
  "snowandthunder", "snowshowers_day", "snowshowers_night", "snowshowers_polartwilight",
  "snowshowersandthunder_day", "snowshowersandthunder_night", "snowshowersandthunder_polartwilight"
];

/* Réchauffage, fichier par fichier et sans jamais rejeter. Un symbole déjà en
   cache n'est pas redemandé : au deuxième lancement c'est 83 lectures locales
   et zéro requête. Le tout tient dans une seule activation, en tâche de fond —
   on ne bloque rien, et si le réseau coupe au milieu, ce qui manque sera repris
   à la prochaine activation ou déposé à l'usage par la règle 5. */
async function warmWxSymbols() {
  let pris = 0, rates = 0;
  const c = await caches.open(CACHE);
  await Promise.all(WX_SYMBOLS.map(async n => {
    const url = "./vendor/weather/" + n + ".svg";
    try {
      if (await c.match(url)) return;
      await c.add(url);
      pris++;
    } catch (_) { rates++; }
  }));
  if (pris || rates) console.info(`[SW] pictos météo : ${pris} déposé(s), ${rates} manquant(s)`);
}

self.addEventListener("install", e => {
  // Pas de .catch() qui avale, À DESSEIN. addAll() est atomique : un seul 404
  // et ZÉRO fichier n'est déposé. En avalant l'erreur, l'installation
  // réussissait quand même, et un service worker au cache VIDE passait tous les
  // contrôles — le premier lancement hors ligne échouait alors sans qu'aucun
  // signal ne l'ait annoncé, c'est-à-dire en vol. En laissant l'échec remonter,
  // l'installation échoue franchement : l'ancien service worker reste en place
  // (l'app continue de fonctionner, réseau d'abord) et le navigateur retentera.
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).catch(err => {
    console.error("[SW] pré-cache incomplet, installation abandonnée :", err);
    throw err;
  }));
  self.skipWaiting();                       // active la nouvelle version sans attendre
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))  // purge anciens caches
    )
  );
  // Réchauffage des pictogrammes : lancé ici, mais HORS du waitUntil À DESSEIN.
  // Tant qu'une activation n'est pas terminée, le navigateur ne distribue aucun
  // événement fetch : y attacher 83 téléchargements ferait attendre la page
  // entière derrière eux, et d'autant plus longtemps que la liaison est
  // mauvaise — c'est-à-dire précisément quand il ne faut pas.
  // En tâche de fond, le service worker reste vivant tant que l'app le fait
  // travailler, ce qui est le cas juste après une activation. S'il est arrêté
  // en route, rien n'est perdu : les symboles déjà déposés y restent, les
  // autres seront repris à la prochaine activation, et de toute façon déposés
  // à l'usage par la règle 5.
  warmWxSymbols();
  self.clients.claim();
});

self.addEventListener("fetch", e => {
  const url = e.request.url;

  // 1) Appels API (proxy NOTAM) : toujours le réseau, jamais de cache.
  if (url.includes("/api/notams/")) {
    e.respondWith(fetch(e.request));
    return;
  }

  // 2) Pages HTML / navigation : réseau d'abord -> les mises à jour apparaissent
  //    dès qu'on est en ligne ; repli sur le cache si hors-ligne.
  //    fetch(url, {cache:"no-cache"}) plutôt que fetch(e.request) : sinon, en
  //    mode "navigate", le navigateur peut servir sa propre copie HTTP en
  //    cache (Cache-Control: max-age=600 côté GitHub Pages) sans même
  //    toucher le réseau — une réouverture d'app dans les 10 minutes suivant
  //    un déploiement resterait alors bloquée sur l'ancienne version.
  //    "no-cache" et pas "no-store" : les deux consultent le réseau à CHAQUE
  //    navigation, mais no-store partait sans If-None-Match, donc chaque
  //    démarrage à froid re-téléchargeait le corps entier (~0,8 Mo gzip) même
  //    inchangé — c'est ce poste qui plafonnait GitHub Pages (100 Go/mois).
  //    Avec no-cache, Pages répond 304 tant que rien n'a changé ; après un
  //    304, le fetch() rend quand même un 200 complet (copie HTTP du
  //    navigateur), donc le c.put() ci-dessous continue de fonctionner.
  //    La clé de cache est l'ADRESSE SANS SA REQUÊTE. Les pages se passent
  //    leur état par l'adresse — minima.html?dep=…&dest=…&altn=…,
  //    minima.html?ad=…, notam-filter.html?view=… — et le Cache API compare
  //    les URL requête comprise. Hors ligne, minima.html?dep=LFBO ratait donc
  //    la copie pré-cachée sous "minima.html" et tombait sur le repli :
  //    l'accueil de Preflight revenait à la place du module Minimas, comme si
  //    la page n'existait pas. Une seule porte y menait sans requête (aucune),
  //    donc le module était INJOIGNABLE en vol.
  //    Le dépôt suit la même clé : sinon chaque route visitée en ligne
  //    laissait sa propre copie de la page (~1 Mo pièce) dans le cache.
  //    Et c'est cette même clé, pas l'URL brute, qu'on teste ci-dessous :
  //    "minima.html?ad=LFPO" ne finit pas par ".html", la règle l'aurait
  //    laissé filer jusqu'à la règle 6. Une navigation s'annonce (mode
  //    "navigate") et passait quand même ; un fetch() de la même adresse,
  //    non.
  const key = url.split("#")[0].split("?")[0];
  const isHTML = e.request.mode === "navigate" || key.endsWith(".html") || key.endsWith("/");
  if (isHTML) {
    e.respondWith(
      fetch(url, { cache: "no-cache" }).then(r => {
        const copy = r.clone();
        caches.open(CACHE).then(c => c.put(key, copy)).catch(() => {});
        return r;
      }).catch(() => caches.match(key).then(r => r || caches.match("./notam-filter.html")))
    );
    return;
  }

  // 3) Plans de plateforme (layouts/*.json), frontières/fermetures FIR
  //    (fir/*.json), annuaire OACI/IATA de fiches.html
  //    (annuaire-terrains.js, régénéré de temps en temps), bases du module
  //    MINIMAS (airfield-seed.js recompilé depuis aero-db, aircraft-db.js,
  //    routes-seed.js recompilé par Weather Lens/Tools/build-routes.py,
  //    airport-tz.js recompilé par Weather Lens/Tools/build-airport-tz.js) et
  //    liste des manœuvres (manoeuvres.js, du code qui suit l'app) :
  //    réseau d'abord ET mise en cache. Consultable EN VOL, sans connexion —
  //    tout en se rafraîchissant dès qu'on est en ligne.
  //    TOUT FICHIER PRÉ-CACHÉ QUI CHANGE SANS QUE sw.js CHANGE A SA PLACE ICI.
  //    La règle 6 ne dépose rien : un tel fichier y serait servi depuis la
  //    copie déposée à l'install et ne consulterait plus jamais le réseau.
  //    Les autres entrées du pré-cache y échappent parce qu'elles sont soit
  //    des pages (règle 2), soit le manifeste (règle 4), soit des fichiers
  //    dont le NOM porte la version — icônes, photos, polices.
  if (url.includes("/layouts/") || url.includes("/fir/") || url.includes("annuaire-terrains") ||
      url.includes("airfield-seed") || url.includes("aircraft-db") || url.includes("manoeuvres") ||
      url.includes("routes-seed") || url.includes("airport-tz")) {
    e.respondWith(
      fetch(e.request).then(r => {
        if (r && r.ok) {
          const copy = r.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        }
        return r;
      }).catch(() => caches.match(e.request))    // hors ligne : la copie gardée
    );
    return;
  }

  // 3 bis) COUCHE MÉTÉO MONDIALE (/api/wx/map) : réseau d'abord ET dépôt.
  //    Seul appel d'API mis en cache, et la seule exception à la règle 1 :
  //    c'est un INSTANTANÉ mondial complet — 5 300 stations, catégorie et vent
  //    — que le proxy régénère toutes les 150 s. 93 Ko gzippés, à côté des
  //    21 Mo de tuiles déjà déposés par la règle 5 : le coût ne se discute pas.
  //    Sans lui, hors ligne la carte perdait TOUTE couleur en dehors des
  //    terrains de la route — le reste du monde passait gris, alors que la
  //    dernière situation connue reste ce qu'on a de mieux pour un déroutement.
  //    Elle n'est pas servie « cache d'abord » : en ligne, une couche météo
  //    doit être la plus fraîche possible, la copie n'est qu'un filet.
  //    Les AUTRES appels météo (/api/wx?ids=…) restent hors cache À DESSEIN :
  //    leur URL porte la liste des terrains, chaque combinaison déposerait sa
  //    propre entrée, et l'app garde déjà ces relevés-là en localStorage, par
  //    terrain et datés (notam_wx:*).
  //    L'app ne déduit PAS de cette règle que les données sont fraîches : elle
  //    lit l'heure de l'instantané dans le corps (`updated`) et l'affiche.
  if (url.includes("/api/wx/map")) {
    e.respondWith(
      fetch(e.request).then(r => {
        if (r && r.ok) {
          const copy = r.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        }
        return r;
      }).catch(() => caches.match(e.request))   // hors ligne : le dernier instantané
    );
    return;
  }

  // 3 quater) SIGMET TURBULENCE (/api/sigmet/turb) : réseau d'abord, copie en
  //    filet. Une copie ne périme personne — chaque bulletin porte sa validité
  //    et la page ne pose sur le vol que ceux dont l'heure tombe dedans ; un
  //    SIGMET expiré gardé en cache ne s'allume donc jamais. Ce qu'on gagne :
  //    au briefing, sans réseau, la dernière liste connue reste posée sur la
  //    courbe au lieu de disparaître.
  if (url.includes("/api/sigmet/")) {
    e.respondWith(
      fetch(e.request).then(r => {
        if (r && r.ok) {
          const copy = r.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        }
        return r;
      }).catch(() => caches.match(e.request))   // hors ligne : la dernière liste
    );
    return;
  }

  // 3 quinquies) CARREAUX RADAR / SATELLITE et statut de la couche Storm
  //    (/api/storm/) : réseau seul, JAMAIS de copie — une image d'orage
  //    d'il y a deux heures passerait pour le présent, et le statut date les
  //    images. Hors ligne, la couche est vide et le dit elle-même.
  if (url.includes("/api/storm/")) {
    e.respondWith(fetch(e.request));
    return;
  }

  // 3 ter) ZONES DE TURBULENCE (/api/turb/… sur le backend, ou la branche
  //    turb-data sur raw.githubusercontent.com) : réseau d'abord ET dépôt, pour
  //    la même raison que la couche météo mondiale — la dernière grille lue
  //    reste ce qu'on a de mieux hors ligne, et le cartouche en affiche le
  //    cycle. Une entrée par (FL, échéance) consultée, un PNG gris de quelques dizaines de Ko chacune (2026-09-04, maille 0,25°) ; l'app
  //    lit le cycle dans le corps et signale elle-même un run trop vieux.
  if (url.includes("/api/turb/") || url.includes("/preflight-lens/turb-data/")) {
    e.respondWith(
      fetch(e.request).then(r => {
        if (r && r.ok) {
          const copy = r.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        }
        return r;
      }).catch(() => caches.match(e.request))   // hors ligne : la dernière grille
    );
    return;
  }

  // 4) manifest.json : il porte l'identité de l'app (nom sous l'icône, écran
  //    de démarrage, nom repris par le wrapper store). En cache d'abord il
  //    restait figé jusqu'au prochain changement de CACHE — un renommage de
  //    l'app n'atteignait jamais les appareils déjà installés. Réseau d'abord
  //    donc, et avec {cache:"no-cache"} pour la même raison qu'en règle 2 :
  //    sans lui, le navigateur sert sa propre copie HTTP et le renommage
  //    reste invisible même avec le réseau ; le 304 suffit quand rien n'a bougé.
  if (url.endsWith("/manifest.json")) {
    e.respondWith(
      fetch(url, { cache: "no-cache" }).then(r => {
        if (r && r.ok) {
          const copy = r.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        }
        return r;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  // 5) Fond vectoriel de la carte ROUTE : moteur MapLibre (vendor/) et archive
  //    de tuiles monde (tiles/*.pmtiles, 14 Mo). Cache d'abord — leurs noms
  //    portent une version, donc une copie en cache est forcément la bonne —
  //    ET MISE EN CACHE au passage : c'est ce dernier point qui manquait.
  //    La règle 6 ci-dessous sert bien "cache d'abord", mais elle ne DÉPOSE
  //    jamais rien : les icônes s'en tirent parce qu'elles sont pré-cachées à
  //    l'install, vendor/ et tiles/ ne l'étaient nulle part. Résultat, hors
  //    ligne le fond MapLibre ne démarrait pas (repli sur l'ancien fond canvas)
  //    ou démarrait sans tuiles (carte vide, surcouche seule).
  //    Pas de pré-cache à l'install : addAll() est atomique et 14 Mo au premier
  //    lancement, c'est une facture de données non demandée. Le dépôt se fait à
  //    la première ouverture de la carte route en ligne.
  if (url.includes("/vendor/") || url.includes("/tiles/")) {
    e.respondWith(
      caches.match(e.request).then(hit => hit || fetch(e.request).then(r => {
        // Une réponse partielle (206) n'est pas stockable dans le Cache API et
        // ne vaut rien hors ligne : on la laisse passer sans la garder.
        if (r && r.ok && r.status === 200) {
          const copy = r.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        }
        return r;
      }))
    );
    return;
  }

  // 6) Autres ressources (icônes) : cache d'abord, réseau en repli.
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
