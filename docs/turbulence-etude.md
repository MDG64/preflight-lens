# Turbulence sur la carte : trace sol, zones par FL, prévision H+x

Étude d'architecture pour un module « turbulence » de Preflight Lens, dans la
continuité de l'analyse Turbli. Tout ce qui est marqué **vérifié** a été
testé le 2026-09-03 (requêtes HTTP réelles) ; le reste vient de la
documentation des fournisseurs.

Trois questions, trois réponses courtes :

| Question | Réponse | Source retenue |
|---|---|---|
| Trace sol du vol précédent | Oui, gratuit | OpenSky `/flights/departure` puis `/tracks/all` (30 jours d'historique) |
| Zones de turbulence par FL sur la carte | Oui, mais **pas** avec les grilles WAFS EDR : elles ne sont plus publiques. On calcule un indice (Ellrod TI1) à partir des vents GFS 0,25° | GFS sur AWS Open Data (public, sans compte) + SIGMET TURB de l'AWC |
| Alerte à H+x minutes après le décollage | Oui : on rejoue le profil du vol précédent minute par minute contre la grille horaire | Même grille, échéances horaires jusqu'à H+120 |

Échelle demandée, 3 niveaux : **light / moderate / severe** (seuils au §5).

---

## 1. Ce que l'étude Turbli avait juste, et ce qui a changé

- **Juste** : Turbli assemble une grille EDR (GTG/WAFS) et une route par
  indicatif (plan de vol déposé ou vol précédent), puis échantillonne la
  grille le long de la route à l'altitude et à l'heure de chaque segment.
- **À corriger : les grilles WAFS 0,25° de turbulence ne sont plus en accès
  libre.** Vérifié : sur NOMADS, `gfs.tCCz.awf_0p25.fFFF.grib2` répond 404 et
  le répertoire `com/wafs/prod/` répond 403 ; le bucket AWS `noaa-gfs-bdp-pds`
  ne contient aucun fichier `awf`/`wafs`. La Service Change Notice 22-104 de
  NCEP explique le retrait des données de risque WAFS « due to a restricted
  access agreement ». Elles ne sont servies que par **WIFS** (États-Unis,
  inscription réservée aux compagnies, prestataires MET et autorités) et
  **SADIS** (Met Office, abonnement). Un pilote seul ou un petit outil n'y
  a pas accès.
- **GTG / DAFS / GTGN** restent gratuits mais **CONUS seulement**.
- **Conséquence** : pour l'Europe, la seule voie gratuite est de recalculer
  soi-même un indice de turbulence en air clair depuis les vents d'un modèle
  public (GFS ou ECMWF open data). C'est ce que GTG fait en interne, avec
  plus de diagnostics et une calibration par PIREP. On perd la calibration,
  on garde la physique (cisaillement × déformation).
- **Gratuit et mondial, en plus** : les **SIGMET internationaux** de l'AWC
  (`https://aviationweather.gov/api/data/isigmet?format=json&hazard=turb`,
  vérifié : 40 SIGMET TURB actifs, polygones + base/top en pieds +
  qualificatif MOD/SEV). C'est l'observation/prévision officielle des MWO,
  à dessiner par-dessus la grille calculée.
- Les PIREP de l'AWC sont quasi vides hors Amérique du Nord (vérifié : 0
  PIREP turbulence sur l'Europe en 3 h). Inutile ici.

---

## 2. Trace sol du vol précédent

### 2.1 Option recommandée : OpenSky Network (gratuit)

Besoin : à partir d'un indicatif OACI (`AFR1234`, pas `AF1234`) et d'un
terrain de départ, récupérer la trace du dernier vol effectué sous cet
indicatif.

Authentification : OAuth2 *client credentials* (compte gratuit), jeton
valable 30 min :

```
POST https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token
grant_type=client_credentials&client_id=…&client_secret=…
```

Recette en deux appels :

1. **Trouver le vol** : `GET /api/flights/departure?airport=LFPG&begin=<t-48h>&end=<t>`
   (fenêtre ≤ 2 jours). Réponse : liste de `{icao24, callsign, firstSeen,
   lastSeen, estDepartureAirport, estArrivalAirport}`. On filtre sur le
   callsign (padded à 8 caractères, à `trim()`), on prend le `firstSeen` le
   plus récent. La table des vols est reconstruite par lot chaque nuit : le
   « vol précédent » est celui d'hier ou d'avant, ce qui est exactement le
   besoin.
2. **La trace** : `GET /api/tracks/all?icao24=<hex>&time=<firstSeen>`.
   Réponse : `{icao24, callsign, startTime, endTime, path:[[time, lat, lon,
   baro_altitude_m, true_track, on_ground], …]}`. Historique **≤ 30 jours**.
   La trace est décimée (points aux changements de cap/altitude), ce qui
   suffit largement pour une ligne sur la carte et pour le profil du §4.

Quotas (par famille d'endpoint) : 4 000 crédits/jour avec compte, 8 000 si
on héberge un récepteur. Un appel `/tracks` par consultation est négligeable
et le backend met en cache par (callsign, jour).

Limites : altitudes barométriques en mètres ; pas de trace au-delà de 30
jours ; un indicatif absent la veille (vol saisonnier) remonte vide → repli
sur la route orthodromique (§4.3).

### 2.2 Compléments et alternatives

- **adsb.lol** (déjà utilisé par le backend pour le QFU) : **live seulement**
  (`/v2/callsign/{cs}` vérifié, `/v2/hex`, `/v2/point/{lat}/{lon}/{nm}`).
  Aucun endpoint d'historique. Les dumps quotidiens `adsblol/globe_history_2026`
  (GitHub, un tar par jour, plusieurs Go) sont inexploitables à la demande.
  En revanche `POST /api/0/routeset` avec `{"planes":[{"callsign":"AFR1234",
  "lat":48.9,"lng":2.5}]}` rend origine/destination d'un indicatif : utile
  pour valider le couple indicatif → étape avant d'interroger OpenSky.
- **Enregistrer soi-même** : le backend « recense » déjà adsb.lol toutes les
  30 min autour des grands terrains. Étendre ce recensement en suivant
  `/v2/callsign/{cs}` toutes les 2 min pour une liste d'indicatifs suivis
  donne une trace maison, sans quota OpenSky, mais seulement pour les vols
  que l'on a décidé de suivre à l'avance.
- **FlightAware AeroAPI** (payant, ~0,01 $/requête) : `GET /flights/{ident}`
  (10 jours en arrière) donne les `fa_flight_id`, puis
  `GET /flights/{id}/track` rend `{timestamp, latitude, longitude,
  altitude (centaines de ft), groundspeed, heading}` à pleine résolution ;
  `/history/flights/{ident}?start&end` remonte à 2011 (≥ 15 jours). Et
  `GET /flights/{ident}/route` donne la route **déposée** (fixes), ce que
  Turbli affiche. À réserver si l'on veut la route déposée plutôt que la
  trace volée.

### 2.3 Forme côté backend (Railway, comme `/api/qfu`)

```
GET /api/trace?cs=AFR1234&dep=LFPG
→ 200 { cs, icao24, date, dep, dest, source:"opensky",
        points:[[t, lat, lon, alt_ft, trk], …] }   (cache 24 h)
→ 404 { reason:"no-flight-30d" }                      (repli orthodromie)
```

Le client trace une `line` MapLibre (source GeoJSON `LineString`), comme la
couche FIR existante, et garde les points pour le §4.

---

## 3. Zones de turbulence sur la carte selon le niveau de vol choisi

### 3.1 Données : vents GFS 0,25° sur AWS (public, vérifié)

- Bucket `https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.YYYYMMDD/HH/atmos/`
  (HTTP 200 sans compte), fichiers `gfs.tHHz.pgrb2.0p25.fFFF.grib2` avec leur
  index `.idx`. 4 cycles/jour (00/06/12/18 Z, disponibles ~3 h 30 après),
  **échéances horaires f000…f120**, puis toutes les 3 h jusqu'à f384.
- Grâce au `.idx`, on télécharge par **Range HTTP** uniquement les champs
  utiles : `UGRD`, `VGRD`, `HGT` (et `TMP` pour la Richardson si on veut) aux
  niveaux 700, 600, 500, 400, 350, 300, 250, 200, 150 hPa. Soit 27 champs ×
  ~0,7 Mo ≈ 20 Mo par échéance, monde entier. Pour l'Europe seule, on
  découpe après décodage.
- Le bucket **n'envoie pas d'en-têtes CORS** (vérifié) : le téléchargement se
  fait côté serveur, jamais dans la PWA. Le GRIB2 GFS est compressé en
  JPEG2000 : décoder avec `eccodes`/`cfgrib` (Python) ou `wgrib2` dans
  l'image Docker Railway. Pas de décodeur JavaScript fiable pour ce packing.
- Alternative sans GRIB : **ECMWF open data** 0,25° (CC-BY, horaire jusqu'à
  H+90, 9 niveaux de pression), même principe. Ou **Open-Meteo** en JSON
  (vent et géopotentiel à 19 niveaux, horaire, 16 jours, coordonnées
  multiples par requête) : parfait pour prototyper sans toucher au GRIB,
  mais il faut demander une grille de points pour dériver spatialement, et le
  quota gratuit (usage non commercial) limite la maille.

### 3.2 Du FL au niveau de pression (atmosphère standard)

| FL | hPa GFS le plus proche | FL | hPa |
|---|---|---|---|
| FL100 | 700 | FL300 | 300 |
| FL140 | 600 | FL340 | 250 |
| FL180 | 500 | FL390 | 200 |
| FL240 | 400 | FL450 | 150 |
| FL270 | 350 | | |

Ce sont les huit niveaux qu'utilise l'AWC pour son affichage WAFS, plus
FL100 : on propose le même sélecteur (9 niveaux) plutôt qu'un pas de 1 000 ft
qui n'apporterait rien avec un modèle à ~25 km.

### 3.3 L'indice : Ellrod TI1

Pour chaque niveau *p* et son voisin inférieur *p+1* (par exemple 250 et
300 hPa pour FL340) :

```
DSH = ∂v/∂x + ∂u/∂y            (déformation de cisaillement)
DST = ∂u/∂x − ∂v/∂y            (déformation d'étirement)
DEF = sqrt(DSH² + DST²)
VWS = |V(p) − V(p+1)| / (z(p) − z(p+1))     (cisaillement vertical, s⁻¹)
TI1 = VWS × DEF                             (s⁻²)
```

Dérivées horizontales par différences centrées sur la grille 0,25° (Δx
corrigé par cos φ), `z` tiré de `HGT`. TI2 ajoute la convergence
(`VWS × (DEF + CVG)`), utile près des jets. Seuils classiques (Ellrod &
Knapp 1992), en 10⁻⁷ s⁻² :

| Niveau | TI1 |
|---|---|
| light | 4 – 8 |
| moderate | 8 – 12 |
| severe | ≥ 12 |

C'est un indice d'air clair (CAT). Pour la turbulence convective, on ajoute
un masque « CB » : `CAPE` (champ GFS de surface, aussi dans `pgrb2`) au-dessus
de 1 000 J/kg **et** niveau demandé sous le sommet estimé, marqué au moins
moderate. Le relief (ondes orographiques) reste hors de portée à cette
maille ; le SIGMET couvre ce cas.

### 3.4 Produit servi au client

Pré-calcul à chaque cycle GFS (cron toutes les 6 h sur le backend) :

- pour chaque échéance horaire de f003 à f036 (couvre tout départ dans les
  24 h à venir avec marge), pour chacun des 9 niveaux : une grille Europe
  (35°N–72°N, 25°W–45°E → 149 × 281 points) de la classe 0/1/2/3 sur un
  `Uint8Array`, soit ~42 Ko brut, 3 à 6 Ko gzip.
- puis **contourage** (marching squares, `d3-contour` ou équivalent Python)
  aux trois seuils → un `MultiPolygon` par classe.

Endpoint :

```
GET /api/turb?fl=340&t=2026-09-03T14:00Z&bbox=-10,35,30,60
→ 200 GeoJSON FeatureCollection, features [{ properties:{ level:"light"|"moderate"|"severe",
     fl:340, valid:"…Z", run:"2026-09-03T06Z", src:"gfs-ellrod" } }]   (cache 1 h)
GET /api/turb/sigmet            → SIGMET TURB de l'AWC, filtrés au FL (base ≤ FL ≤ top), cache 10 min
```

Côté carte (`notam-filter.html`), trois couches `fill` sur une source
GeoJSON, filtrées par `level`, avec la même palette que l'échelle
(jaune / orange / rouge, opacité 0,35), puis une couche `line` hachurée pour
les SIGMET. Le sélecteur de FL et le curseur horaire ne font que changer
l'URL de la source : rien à recalculer dans le navigateur. Le service worker
peut garder la dernière réponse par (fl, heure) : la carte reste lisible
hors ligne au briefing.

---

## 4. Alerte « turbulence à H+x minutes après le décollage »

### 4.1 Principe

On ne prédit pas une position, on **rejoue un profil** : à chaque minute
après le décollage, où sera l'avion (lat, lon) et à quel niveau, puis quelle
classe la grille donne à cet endroit, à ce niveau, à cette heure.

### 4.2 Le profil

Trois sources, par ordre de préférence :

1. **La trace du vol précédent** (§2) : on la rééchantillonne à la minute
   depuis le premier point `on_ground=false`, en gardant l'altitude vraie de
   la veille. C'est le plus fidèle (SID réelle, paliers ATC, TOC réel).
2. **La route déposée** (AeroAPI `/route`, si payant) + un profil de montée
   type.
3. **Orthodromie dep → dest** + profil de montée type. Pour un A320 :

| Temps après décollage | Distance | Niveau |
|---|---|---|
| 5 min | ~30 NM | FL100 |
| 10 min | ~70 NM | FL200 |
| 17 min | ~120 NM | FL300 |
| 22 min | ~160 NM | croisière FL350 |

(250 kt sous FL100, puis 300 kt / M0,78 ; à paramétrer par type via
`aircraft-db.js`.)

### 4.3 L'échantillonnage

```
for m in 0..durée:
    (lat, lon, alt) = profil(m)
    fl   = niveau GFS le plus proche de alt
    t    = t_décollage + m
    cls  = max( grille[fl][échéance(t)] interpolée bilinéairement en (lat, lon),
                grille[fl][échéance(t)+1h] idem )      # on prend le pire des deux heures encadrantes
    cls  = max(cls, sigmet_turb(lat, lon, alt, t))
```

Prendre le maximum des deux échéances horaires encadrantes, plutôt qu'une
interpolation temporelle, va dans le sens de la sécurité et absorbe une
partie de l'incertitude sur l'heure réelle de décollage.

### 4.4 Ce que voit le pilote

Un ruban temporel sous la carte, de H+0 à l'arrivée, coloré par classe, et
une liste ne retenant que les **transitions** :

```
H+14 min   FL240  moderate   35 NM SE de DJL   (GFS 06Z, échéance 14Z)
H+31 min   FL350  light      jusqu'à H+47
H+52 min   FL350  severe     SIGMET LFFF 3 valide 13:00–17:00, FL300–FL400
```

Un tap sur une ligne recentre la carte au point et bascule le sélecteur de
FL et l'heure sur ceux de l'alerte : la zone de §3 apparaît sous le point.

### 4.5 Limites à afficher

- Précision temporelle : le GFS est horaire, mais son erreur de position sur
  les zones de CAT est de l'ordre de 50–100 NM ; « H+14 » veut dire « dans
  la tranche H+10 à H+20 ».
- Latence : le cycle 06Z sort vers 09:30Z. Une consultation à 10Z utilise
  donc une prévision de 4 h d'âge ; l'échéance affichée le dit (`run`,
  `valid`).
- Sans EDR calibré, l'indice ne connaît pas la masse de l'avion : les seuils
  du §5 sont ceux d'un avion moyen (A320/B737). Un régional ressent une
  classe de plus, un gros-porteur une de moins.

---

## 5. Échelle à trois niveaux

Deux échelles coexistent : l'EDR (ce que Turbli, WAFS et GTG affichent) et
l'indice Ellrod (ce que nous calculons). Le module n'expose que la classe.

| Classe | EDR (m^2/3 s^-1), avion moyen | Ellrod TI1 (10⁻⁷ s⁻²) | Couleur |
|---|---|---|---|
| light | 0,15 – 0,20 | 4 – 8 | jaune |
| moderate | 0,20 – 0,35 | 8 – 12 | orange |
| severe | ≥ 0,35 | ≥ 12 | rouge |

Les seuils EDR sont ceux qu'appliquent les WAFC pour tracer MOD et SEV sur
les cartes SIGWX depuis le 26 novembre 2024 (AIC 131/2024 du Royaume-Uni :
MOD si 0,20 ≤ EDR < 0,35, SEV si EDR ≥ 0,35) ; le seuil bas 0,15 est celui à
partir duquel l'AWC commence à colorer sa carte WAFS. Ils servent le jour où
une source EDR devient accessible (WIFS/SADIS, ou GTG si l'on couvre les
États-Unis) : le contrat `/api/turb` ne change pas, seule la fonction de
classement change.

---

## 6. Pipeline complet et coûts

```
cron 6 h (backend)      : GFS AWS (Range sur .idx) → décodage → TI1 par niveau
                          → grilles Uint8 + GeoJSON contourés → cache disque / KV
cron 10 min             : SIGMET TURB (AWC isigmet) → polygones filtrés par FL
à la demande            : /api/trace (OpenSky, cache 24 h)
                          /api/turb?fl&t (statique une fois calculé)
                          /api/turb/route?cs&dep&tko= (profil §4, ~1 ms par minute de vol)
client (PWA)            : 3 couches fill + 1 line + ligne de trace + ruban temporel,
                          tout en GeoJSON, rien à décoder, cache service worker
```

- Coût données : 0 € (AWS Open Data, OpenSky, AWC). Trafic serveur ≈ 20 Mo
  × 34 échéances × 4 cycles ≈ 2,7 Go/jour, à réduire à ~1 Go en ne
  décodant que la sous-grille Europe (le Range ne coupe pas
  géographiquement, mais on peut passer à 12 échéances si le besoin est
  « départ dans les 12 h »).
- CPU : le calcul TI1 sur 9 niveaux × 34 échéances tient en quelques
  dizaines de secondes en NumPy.
- Évolution payante possible sans refonte : AeroAPI pour la route déposée
  (0,01 $/vol), SADIS/WIFS pour l'EDR officiel si l'éligibilité est obtenue.

## 7. Ordre de réalisation proposé

1. `/api/trace` OpenSky + ligne sur la carte (un jour de travail, valeur
   immédiate).
2. Pipeline GFS → TI1 → GeoJSON, sélecteur de FL et curseur horaire.
3. SIGMET TURB en surcouche.
4. Profil H+x et ruban temporel, d'abord sur la trace de la veille, repli
   orthodromie.
5. Masque convectif (CAPE) et pondération par type avion.

---

## 8. Ce qui est implémenté (branche `claude/turbli-architecture-apis-wz2xus`)

La route reste l'orthodromie déjà dessinée par la carte ; la trace du vol
précédent (§2) n'est pas intégrée pour l'instant.

**Profil H+x (§4) — implémenté sur l'orthodromie.** Dès qu'une route est
entrée, la couche Turbulence de la carte rejoue dep → dest : montée par
paliers de performance d'un jet moyen (2 400 ft/min et 250 kt sous FL100,
1 800 ft/min et 330 kt jusqu'à FL240, 1 200 ft/min et 420 kt au-dessus),
croisière à 450 kt au FL du curseur, descente symétrique ; une étape trop
courte plafonne là où montée et descente se rejoignent. Décollage à
l'horizon choisi (now, +3, +6, +12 h). Chaque minute est lue dans la grille
au FL le plus proche, avec la pire des deux échéances qui encadrent l'heure ;
sous 9 000 ft la grille ne dit rien. Sur la carte, ce rejeu ne se voit que
sur la route : l'orthodromie surlignée en jaune/orange/rouge là où il
rencontre de la turbulence — le cartouche ne porte plus le détail du vol.
Ce détail vit sur la page Turbulence (troisième onglet de Weather), qui
refait le même rejeu sur les heures saisies par le pilote : la ligne de
résumé (« LFPG → KJFK · 3 150 NM · 7 h 40 · TKO 11:26Z · FL340 · worst
severe »), le ruban de la durée du vol coloré par classe, l'échelle
H+/heure Z, la liste des épisodes de turbulence — plages continues, pire
classe, durée, niveaux, distance (« H+1:45 · 13:11Z · severe · for 132 min ·
FL340 · 753 NM from LFPG » ; les light de moins de trois minutes restent
sur le ruban seulement), un tap sur un morceau ou une ligne ouvrant son
cartouche. Le cartouche Turbulence de la carte, lui, ne garde que le choix
du niveau et de l'heure, avec la validité de la grille : rien n'y mène vers
cette page, qui reste l'onglet de Weather.
Fonctions pures entre les marqueurs `[turb-profile]`,
testées dans `test/turb-grid.test.mjs` (distance et point d'orthodromie,
profil long et court, encadrement des échéances, échantillonnage).

**Serveur — `tools/turb/build_turb.py`** (Python, numpy + eccodes). À lancer
par cron toutes les 6 h sur le backend Railway, ou à la main :

```
python3 tools/turb/build_turb.py --out /var/turb --hours 3-36
python3 tools/turb/build_turb.py --selftest        # sans réseau
```

Il lit l'index `.idx` du GFS 0,25° sur AWS Open Data, télécharge par Range
HTTP les seuls champs utiles (UGRD, VGRD, HGT à 11 niveaux, CAPE : ~20 Mo
par échéance, 10 s), calcule l'indice Ellrod TI1 à chaque FL, applique le
masque convectif et écrit une arborescence statique à servir telle quelle
sous `/api/turb/` :

```
index.json          { run, generated, hours:[…], fls:[100,…,450],
                      grid:{lat0,lon0,dlat,dlon,nlat,nlon}, thresholds,
                      files:"png", encoding:{ levels:[64,128,192], … } }
FL340/h006.png      PNG gris 8 bits, un octet par point, du nord au sud et
                    d'ouest en est ; sa grille dans un chunk tEXt « turb »
```

**Depuis le 2026-09-04, le fichier porte la VALEUR de l'indice, plus une
classe** : l'octet vaut TI1 (en 10⁻⁷ s⁻²) × 16, tronqué au pas de 16
(1 × 10⁻⁷ : seize niveaux, quatre par classe), plafonné à 240 et mis à
zéro sous light ; light = 64, moderate = 128, severe = 192 — tronqué, pas
arrondi, donc exactement TI1 ≥ 4, 8, 12 —, seuils publiés dans l'index
(`encoding.levels`, avec `step` et `floor`) et relus par le client — rien
en dur. Le relèvement convectif pose la nuance FORTE de sa classe (96,
160, 224). La grille est celle du modèle, **le monde entier à 0,25°**
(1 440 × 721 points), sans regroupement : c'est ce champ que le client
lisse entre les points. Le PNG est écrit à la main (filtres adaptatifs
None/Sub/Up/Average/Paeth à la manière de libpng, zlib 9) — pas de Pillow
à installer — et pèse 90 à 130 Ko par fichier (mesuré le 2026-09-04 :
au pas de 4 et avec les valeurs sous light, c'était 235 à 363 Ko, et la
page Turbulence en charge une quinzaine ; `--pool 2` diviserait encore
par quatre en revenant à 0,5°). Le masque convectif n'est
pas le CAPE seul (les tropiques en ont en permanence) : il exige de la
pluie convective instantanée du modèle (CPRAT) et relève en severe sous
les cellules dont la réflectivité simulée (REFC) dépasse 40 dBZ. L'index
s'écrit en dernier, pour qu'un client qui le lit trouve toutes les
échéances annoncées. L'ancien format (classes 0..3 en RLE JSON, grille
regroupée à 0,5°) reste lu par le client, pour la transition.

**Publication — `.github/workflows/turb.yml`.** Toutes les 6 h (HH+4 h 20 après
chaque cycle GFS) et à la demande, GitHub Actions lance le script et pousse
le dossier en un seul commit sur la branche orpheline `turb-data`, servie
par raw.githubusercontent.com (CORS ouvert, cache 5 min, gzip). L'app
essaie `/api/turb/` sur le backend, puis cette branche.

**Client — `notam-filter.html`, carte de route, vue Weather.** Un
interrupteur **Turbulence** sous **Wind** ; allumé, il déplie un cartouche
avec le **curseur FL** (neuf niveaux, FL100 à FL450), l'horizon
**now / +3 h / +6 h / +12 h** et la ligne « GFS 00Z run · valid 06Z (+6 h) ·
0.25° grid », qui passe en ambre avec la mention OLD RUN si le cycle a plus
de 18 h. Le client décode le PNG lui-même (`turbPngParse`,
`turbPngUnfilter`, zlib par `DecompressionStream` ; un canvas en repli) —
les pixels sortent exacts, sans gestion des couleurs —, lit la grille dans
le chunk tEXt, tire les classes aux seuils de l'index pour le rejeu, et
peint la **nappe lissée** : le champ est rééchantillonné au pixel par une
interpolation bicubique de Catmull-Rom (`turbResample` — elle passe
exactement par les valeurs des points, une case severe reste severe en son
centre ; les colonnes bouclent à l'antiméridien), puis chaque pixel prend
la couleur de sa valeur par une table de 256 entrées (`turbLut`) — la
palette d'un radar de précipitations, deux nuances par classe (jaune pâle,
jaune ; orange, orange foncé ; rouge, magenta), transparent sous light,
plus soutenue sur le thème jour. Le raster (`turbRasterFor`) couvre la vue
et 30 % de marge à la demi-résolution de l'écran, une seule `drawImage`
le pose (l'écran est affine dans l'espace Mercator sous MapLibre, en
lon/lat sinon) ; il est refait quand la vue sort de la marge, 130 ms après
le dernier cran de zoom, ou quand le fichier, le thème ou la projection
changent. Le rejeu du profil, lui, ne lisse rien : sur une grille fine
(≤ 0,3°) il lit la pire des neuf cases autour du point (`turbCellClass`),
le regard latéral qu'avait le regroupement 2 × 2 d'avant. Les fichiers
lus restent en mémoire par (FL, échéance), et le service worker garde le
dernier pour le hors ligne (`sw.js`, règle 3 ter). Trois lignes de légende
(deux nuances par pastille) et une note « indice modèle, pas un produit
aéro » apparaissent avec l'interrupteur ; l'aide et Data sources portent le
crédit NOAA GFS et la même réserve.

**Tests — `test/turb-grid.test.mjs`** : décodage RLE, refus d'une grille
tronquée, classes ↔ valeurs, lecture PNG (les cinq filtres, IDAT en
morceaux, tEXt, et `test/turb-fixture.png` écrit par le pipeline Python
avec `--fixture` — l'encodeur du serveur lu par le décodeur du client),
choix de l'échéance, rééchantillonnage (exact aux centres, rond entre les
cases, bouclage à l'antiméridien), inverse du Mercator, palette, regard
latéral du rejeu. Le pipeline Python a son autotest (`--selftest`, avec
l'aller-retour PNG sur du bruit) ; le workflow se relance aussi à chaque
push qui touche `tools/turb/` ou son fichier.

**Publication sans serveur — `.github/workflows/turb.yml`.** Toutes les 6 h
(HH+4 h 20), GitHub Actions lance le script et pousse son dossier de sortie
en un seul commit sur la branche orpheline `turb-data`, écrasée à chaque
fois. L'app essaie d'abord `/api/turb/` sur le backend, puis
`https://raw.githubusercontent.com/MDG64/preflight-lens/turb-data/`
(CORS ouvert, cache 5 min) : aucune pièce à déployer sur Railway pour que
les nappes s'affichent. Le backend peut plus tard servir la même
arborescence pour reprendre la main.

**Reste à faire** : SIGMET TURB en
surcouche (§1) ; profil par type avion (vitesses et taux depuis
`aircraft-db.js`) et heure de décollage libre ; calibration des
seuils Ellrod contre quelques journées de SIGMET et de retours pilotes.

## Sources

- OpenSky REST API : https://openskynetwork.github.io/opensky-api/rest.html
- adsb.lol OpenAPI : https://api.adsb.lol/api/openapi.json ; dumps https://github.com/adsblol/globe_history_2026
- AeroAPI v4 (référence non officielle) : https://wal.sh/research/ads-b/aeroapi-reference.html
- NCEP SCN 22-104 (retrait WAFS de NOMADS) : https://www.weather.gov/media/notification/pdf2/scn22-104_gfs.v16.3.0_aaa.pdf
- WIFS User's Guide : https://aviationweather.gov/wifs/users_guide/
- AWC WAFS help (niveaux, EDR×100 ≥ 15) : https://aviationweather.gov/wafs/help.html
- AWC Data API (isigmet, pirep) : https://aviationweather.gov/data/api/
- GFS sur AWS Open Data : https://noaa-gfs-bdp-pds.s3.amazonaws.com/
- ECMWF open data : https://www.ecmwf.int/en/forecasts/datasets/open-data
- Open-Meteo (niveaux de pression) : https://open-meteo.com/en/docs
- Ellrod index : https://en.wikipedia.org/wiki/Ellrod_index
- AIC 131/2024 (seuils EDR SIGWX 0,20 / 0,35) : https://www.aurora.nats.co.uk/htmlAIP/Publications/2024-07-25/html/eAIC/EG-eAIC-2024-131-P-en-GB.html
- Turbli, FAQ et cartes : https://turbli.com/frequently-asked-questions/
