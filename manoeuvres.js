/* manoeuvres.js — LA liste des manœuvres, et rien d'autre.
   ------------------------------------------------------------------
   Une manœuvre n'est pas une approche. Elle se commence au terme de
   l'approche publiée sur une carte, elle reste donc sous la piste de CETTE
   carte, et c'est cette carte-là — jamais une table réglementaire — qui
   chiffre ses minima. D'où trois traits qu'elles ont toutes : elles ne
   figurent pas dans la liste `a` de la graine (on ne « choisit » pas une
   manœuvre pour une piste), elles n'ont pas de `fac` donc aucun minimum
   standard, et elles se relèvent puis se valident comme les approches.

   POURQUOI CE FICHIER. Deux pages doivent les énumérer exactement de la même
   façon : la fiche terrain de Minima Lens, qui propose la ligne et la fait
   valider, et la page de suivi, qui compte ce qui reste à faire. Elles le
   faisaient chacune de son côté, à coups de blocs recopiés. Le sidestep est
   arrivé dans la fiche et pas dans le suivi ; le circling à tracé prescrit a
   suivi le lendemain, avec le même oubli. Le terrain se lisait alors COMPLET
   avec une ligne encore en attente — un compteur qui ment sur du travail non
   fait est pire que pas de compteur.

   Ajouter une manœuvre, désormais : une entrée ici, et rien ailleurs.

   Chaque entrée porte :
     id       la clé de la graine (n[extrémité][id]) et du journal
     label    le nom affiché, le même dans les deux pages
     i        la lettre de la ligne dans la fiche — elle nomme les champs de
              saisie (adDh_36_c) et distingue les manœuvres des approches,
              qui portent leur rang numérique. Deux manœuvres ne peuvent pas
              partager la même lettre.
     adLabel  le nom que porte la ligne quand la carte ne nomme AUCUNE piste
              (extrémité « - », voir AD_END_AD). Absent, le nom se fabrique.
     cible    le champ de la graine où lire la piste d'ATTERRISSAGE quand elle
              diffère de celle de l'approche — le sidestep se pose sur l'autre
              extrémité, et « Sidestep » seul tairait l'essentiel. */
(function (w) {
  "use strict";

  /* L'extrémité des cartes qui ne nomment pas de piste — « RNP A », « LOC A »,
     un NDB dont le titre ne porte aucun QFU. Elles publient pour le terrain
     entier ; leurs minima se rangent sous cette clé. */
  w.AD_END_AD = "-";

  w.AD_MANOEUVRES = [
    /* Le circling ordinaire : manœuvre à vue du terrain, la seule dont un
       repère réglementaire existe — mais il vient de la CATÉGORIE d'aéronef
       (Vat), pas de l'installation au sol, et adStdMinima le traite à part. */
    { id: "CIRCLING", label: "Circling", i: "c",
      adLabel: "Circling — aerodrome" },
    /* Le sidestep : on se pose sur l'autre extrémité, mais c'est l'approche
       publiée ici qui autorise la manœuvre et qui en chiffre les minima.
       Aucune table ne lui donne de standard — seule la carte chiffre. */
    { id: "SIDESTEP", label: "Sidestep", i: "s", cible: "s" },
    /* Le circling à tracé prescrit est une AUTRE manœuvre, pas une variante
       d'écriture du circling : la carte impose un tracé au lieu de laisser
       manœuvrer à vue, souvent de jour seulement, et publie pour lui ses
       propres minima — 1170 ft à La Corogne, 1830 à Pampelune, là où la table
       de circling tiendrait dans 600. D'où sa ligne à part, et surtout aucun
       standard : la table des catégories chiffre le circling ordinaire, pas
       celui-là. Quand les deux sont publiés, aucun ne remplace l'autre : le
       pilote choisit celle qu'il vole. */
    { id: "CIRCLING_P_TRK", label: "Circling — prescribed tracks", i: "p",
      adLabel: "Circling — prescribed tracks, aerodrome" }
  ];

  /* L'entrée, depuis un identifiant ou depuis elle-même — les appelants
     tiennent tantôt l'un, tantôt l'autre. */
  w.adManoeuvre = function (m) {
    if (m && m.id) return m;
    for (var i = 0; i < w.AD_MANOEUVRES.length; i++)
      if (w.AD_MANOEUVRES[i].id === m) return w.AD_MANOEUVRES[i];
    return null;
  };
  w.adEstManoeuvre = function (id) { return !!w.adManoeuvre(id); };

  /* Le libellé d'une ligne, terrain et extrémité compris. UNE seule fabrique,
     pour que la fiche et le suivi écrivent le même mot sur la même ligne.
     Une manœuvre publiée sous « - » sans adLabel n'est pas tue pour autant :
     elle prend son nom suivi de « — aerodrome ». Rien ne doit disparaître
     faute d'avoir été prévu — c'est exactement ce qui a produit ce fichier. */
  w.adManoeuvreLabel = function (m, icao, end, estAd) {
    var o = w.adManoeuvre(m);
    if (!o) return m && m.id ? m.id : m;
    if (estAd || end === w.AD_END_AD) return o.adLabel || (o.label + " — aerodrome");
    if (!o.cible) return o.label;
    var champ = ((w.AD_SEED || {})[icao] || {})[o.cible];
    var vers = champ && champ[end];
    return vers ? o.label + " " + vers : o.label;
  };
})(window);
