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
  "./icons/icon-192-v4.png", "./icons/icon-512-v4.png", "./icons/icon-maskable-192-v4.png", "./icons/icon-maskable-512-v4.png",
  "./icons/icon-180-v4.png", "./icons/favicon-32-v3.png", "./icons/favicon-16-v3.png", "./favicon.ico",
  // Photos des trois cases d'accueil (19 aout 2026). Meme regle que les icones :
  // servies "cache d'abord" par la regle 6, donc le nom porte la version — une
  // refonte d'image change le suffixe, on n'ecrase jamais en place.
  "./home-wx-v8.jpg", "./home-notam-v9.jpg", "./home-map-v2.jpg",
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
  "./fonts/ibm-plex-mono-v20-latin-ext-600.woff2"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).catch(() => {}));
  self.skipWaiting();                       // active la nouvelle version sans attendre
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))  // purge anciens caches
    )
  );
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
  const isHTML = e.request.mode === "navigate" || url.endsWith(".html") || url.endsWith("/");
  if (isHTML) {
    e.respondWith(
      fetch(url, { cache: "no-cache" }).then(r => {
        const copy = r.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        return r;
      }).catch(() => caches.match(e.request).then(r => r || caches.match("./notam-filter.html")))
    );
    return;
  }

  // 3) Plans de plateforme (layouts/*.json), frontières/fermetures FIR
  //    (fir/*.json) et annuaire OACI/IATA de fiches.html
  //    (annuaire-terrains.js, régénéré de temps en temps) : réseau d'abord
  //    ET mise en cache. Consultable EN VOL, sans connexion — tout en se
  //    rafraîchissant dès qu'on est en ligne.
  if (url.includes("/layouts/") || url.includes("/fir/") || url.includes("annuaire-terrains")) {
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
  //    de tuiles monde (tiles/*.pmtiles, 21 Mo). Cache d'abord — leurs noms
  //    portent une version, donc une copie en cache est forcément la bonne —
  //    ET MISE EN CACHE au passage : c'est ce dernier point qui manquait.
  //    La règle 6 ci-dessous sert bien "cache d'abord", mais elle ne DÉPOSE
  //    jamais rien : les icônes s'en tirent parce qu'elles sont pré-cachées à
  //    l'install, vendor/ et tiles/ ne l'étaient nulle part. Résultat, hors
  //    ligne le fond MapLibre ne démarrait pas (repli sur l'ancien fond canvas)
  //    ou démarrait sans tuiles (carte vide, surcouche seule).
  //    Pas de pré-cache à l'install : addAll() est atomique et 21 Mo au premier
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
