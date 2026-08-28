/* aircraft-db.js — base des types commerciaux servant de valeurs de départ à
   Operation setup. Choisir un type remplit la catégorie, l'équipage, les
   limitations de vent et la capacité tout temps ; tout reste modifiable, et
   une valeur retouchée à la main l'emporte sur celle du type.

   Ces chiffres sont des valeurs TYPIQUES de la famille, pas les limitations
   de l'exemplaire : le vent traversier des manuels est une valeur démontrée
   en essais, la DH / RVR la plus basse dépend de l'AFM, du MEL et de
   l'approbation de l'exploitant. Toujours confronter à l'AFM et à l'OM-B
   avant d'en faire un critère de vol.

   Champs d'une entrée :
     id        désignateur OACI (ce qui part dans « Type designator »)
     name      libellé lisible
     mfr       constructeur — sert au regroupement de la liste
     cat       catégorie d'aéronef A–E (Vat à la masse maxi à l'atterrissage)
     engines   nombre de moteurs
     pilots    équipage minimal certifié (1 ou 2)
     xwind     vent traversier maxi démontré / limite usuelle (kt, piste sèche)
     tailwind  vent arrière maxi (kt)
     autoland  atterrissage automatique disponible
     hudls     HUD / HUDLS d'usage courant sur le type
     apFdToDh  PA ou directeur de vol utilisable jusqu'à la DH
     rollout   NONE | FAIL_PASSIVE | FAIL_OPERATIONAL
     dh        DH la plus basse typiquement approuvée (ft ; 0 = sans DH)
     rvr       RVR la plus basse typiquement approuvée (m)
     lvo       libellé de la capacité tout temps, pour la ligne d'information
*/
window.AIRCRAFT_DB = [
  /* ---------------- Airbus ---------------- */
  {id:"A318", name:"Airbus A318",        mfr:"Airbus", cat:"C", engines:2, pilots:2, xwind:38, tailwind:15, autoland:true,  hudls:false, apFdToDh:true, rollout:"FAIL_OPERATIONAL", dh:50,  rvr:125, lvo:"CAT IIIB"},
  {id:"A319", name:"Airbus A319",        mfr:"Airbus", cat:"C", engines:2, pilots:2, xwind:38, tailwind:15, autoland:true,  hudls:false, apFdToDh:true, rollout:"FAIL_OPERATIONAL", dh:50,  rvr:125, lvo:"CAT IIIB"},
  {id:"A320", name:"Airbus A320",        mfr:"Airbus", cat:"C", engines:2, pilots:2, xwind:38, tailwind:15, autoland:true,  hudls:false, apFdToDh:true, rollout:"FAIL_OPERATIONAL", dh:50,  rvr:125, lvo:"CAT IIIB"},
  {id:"A321", name:"Airbus A321",        mfr:"Airbus", cat:"C", engines:2, pilots:2, xwind:38, tailwind:15, autoland:true,  hudls:false, apFdToDh:true, rollout:"FAIL_OPERATIONAL", dh:50,  rvr:125, lvo:"CAT IIIB"},
  {id:"A19N", name:"Airbus A319neo",     mfr:"Airbus", cat:"C", engines:2, pilots:2, xwind:38, tailwind:15, autoland:true,  hudls:false, apFdToDh:true, rollout:"FAIL_OPERATIONAL", dh:50,  rvr:125, lvo:"CAT IIIB"},
  {id:"A20N", name:"Airbus A320neo",     mfr:"Airbus", cat:"C", engines:2, pilots:2, xwind:38, tailwind:15, autoland:true,  hudls:false, apFdToDh:true, rollout:"FAIL_OPERATIONAL", dh:50,  rvr:125, lvo:"CAT IIIB"},
  {id:"A21N", name:"Airbus A321neo",     mfr:"Airbus", cat:"C", engines:2, pilots:2, xwind:38, tailwind:15, autoland:true,  hudls:false, apFdToDh:true, rollout:"FAIL_OPERATIONAL", dh:50,  rvr:125, lvo:"CAT IIIB"},
  {id:"BCS1", name:"Airbus A220-100",    mfr:"Airbus", cat:"C", engines:2, pilots:2, xwind:35, tailwind:10, autoland:true,  hudls:true,  apFdToDh:true, rollout:"FAIL_PASSIVE",      dh:50,  rvr:175, lvo:"CAT IIIA"},
  {id:"BCS3", name:"Airbus A220-300",    mfr:"Airbus", cat:"C", engines:2, pilots:2, xwind:35, tailwind:10, autoland:true,  hudls:true,  apFdToDh:true, rollout:"FAIL_PASSIVE",      dh:50,  rvr:175, lvo:"CAT IIIA"},
  {id:"A332", name:"Airbus A330-200",    mfr:"Airbus", cat:"C", engines:2, pilots:2, xwind:40, tailwind:10, autoland:true,  hudls:false, apFdToDh:true, rollout:"FAIL_OPERATIONAL", dh:50,  rvr:125, lvo:"CAT IIIB"},
  {id:"A333", name:"Airbus A330-300",    mfr:"Airbus", cat:"C", engines:2, pilots:2, xwind:40, tailwind:10, autoland:true,  hudls:false, apFdToDh:true, rollout:"FAIL_OPERATIONAL", dh:50,  rvr:125, lvo:"CAT IIIB"},
  {id:"A339", name:"Airbus A330-900neo", mfr:"Airbus", cat:"C", engines:2, pilots:2, xwind:40, tailwind:10, autoland:true,  hudls:false, apFdToDh:true, rollout:"FAIL_OPERATIONAL", dh:50,  rvr:125, lvo:"CAT IIIB"},
  {id:"A343", name:"Airbus A340-300",    mfr:"Airbus", cat:"C", engines:4, pilots:2, xwind:35, tailwind:10, autoland:true,  hudls:false, apFdToDh:true, rollout:"FAIL_OPERATIONAL", dh:50,  rvr:125, lvo:"CAT IIIB"},
  {id:"A346", name:"Airbus A340-600",    mfr:"Airbus", cat:"D", engines:4, pilots:2, xwind:35, tailwind:10, autoland:true,  hudls:false, apFdToDh:true, rollout:"FAIL_OPERATIONAL", dh:50,  rvr:125, lvo:"CAT IIIB"},
  {id:"A359", name:"Airbus A350-900",    mfr:"Airbus", cat:"C", engines:2, pilots:2, xwind:40, tailwind:15, autoland:true,  hudls:true,  apFdToDh:true, rollout:"FAIL_OPERATIONAL", dh:0,   rvr:75,  lvo:"CAT IIIB sans DH"},
  {id:"A35K", name:"Airbus A350-1000",   mfr:"Airbus", cat:"D", engines:2, pilots:2, xwind:40, tailwind:15, autoland:true,  hudls:true,  apFdToDh:true, rollout:"FAIL_OPERATIONAL", dh:0,   rvr:75,  lvo:"CAT IIIB sans DH"},
  {id:"A388", name:"Airbus A380-800",    mfr:"Airbus", cat:"C", engines:4, pilots:2, xwind:40, tailwind:10, autoland:true,  hudls:false, apFdToDh:true, rollout:"FAIL_OPERATIONAL", dh:0,   rvr:75,  lvo:"CAT IIIB sans DH"},

  /* ---------------- Boeing ---------------- */
  {id:"B733", name:"Boeing 737-300",     mfr:"Boeing", cat:"C", engines:2, pilots:2, xwind:33, tailwind:10, autoland:true,  hudls:false, apFdToDh:true, rollout:"FAIL_PASSIVE",      dh:50,  rvr:200, lvo:"CAT IIIA"},
  {id:"B737", name:"Boeing 737-700",     mfr:"Boeing", cat:"C", engines:2, pilots:2, xwind:33, tailwind:10, autoland:true,  hudls:true,  apFdToDh:true, rollout:"FAIL_PASSIVE",      dh:50,  rvr:175, lvo:"CAT IIIA (HUD)"},
  {id:"B738", name:"Boeing 737-800",     mfr:"Boeing", cat:"C", engines:2, pilots:2, xwind:33, tailwind:15, autoland:true,  hudls:true,  apFdToDh:true, rollout:"FAIL_PASSIVE",      dh:50,  rvr:175, lvo:"CAT IIIA (HUD)"},
  {id:"B739", name:"Boeing 737-900ER",   mfr:"Boeing", cat:"C", engines:2, pilots:2, xwind:33, tailwind:15, autoland:true,  hudls:true,  apFdToDh:true, rollout:"FAIL_PASSIVE",      dh:50,  rvr:175, lvo:"CAT IIIA (HUD)"},
  {id:"B38M", name:"Boeing 737 MAX 8",   mfr:"Boeing", cat:"C", engines:2, pilots:2, xwind:33, tailwind:15, autoland:true,  hudls:true,  apFdToDh:true, rollout:"FAIL_PASSIVE",      dh:50,  rvr:175, lvo:"CAT IIIA (HUD)"},
  {id:"B39M", name:"Boeing 737 MAX 9",   mfr:"Boeing", cat:"C", engines:2, pilots:2, xwind:33, tailwind:15, autoland:true,  hudls:true,  apFdToDh:true, rollout:"FAIL_PASSIVE",      dh:50,  rvr:175, lvo:"CAT IIIA (HUD)"},
  {id:"B752", name:"Boeing 757-200",     mfr:"Boeing", cat:"C", engines:2, pilots:2, xwind:35, tailwind:15, autoland:true,  hudls:false, apFdToDh:true, rollout:"FAIL_OPERATIONAL", dh:50,  rvr:150, lvo:"CAT IIIB"},
  {id:"B763", name:"Boeing 767-300ER",   mfr:"Boeing", cat:"C", engines:2, pilots:2, xwind:35, tailwind:15, autoland:true,  hudls:false, apFdToDh:true, rollout:"FAIL_OPERATIONAL", dh:50,  rvr:150, lvo:"CAT IIIB"},
  {id:"B772", name:"Boeing 777-200ER",   mfr:"Boeing", cat:"D", engines:2, pilots:2, xwind:38, tailwind:15, autoland:true,  hudls:true,  apFdToDh:true, rollout:"FAIL_OPERATIONAL", dh:0,   rvr:75,  lvo:"CAT IIIB sans DH"},
  {id:"B77W", name:"Boeing 777-300ER",   mfr:"Boeing", cat:"D", engines:2, pilots:2, xwind:38, tailwind:15, autoland:true,  hudls:true,  apFdToDh:true, rollout:"FAIL_OPERATIONAL", dh:0,   rvr:75,  lvo:"CAT IIIB sans DH"},
  {id:"B788", name:"Boeing 787-8",       mfr:"Boeing", cat:"C", engines:2, pilots:2, xwind:38, tailwind:15, autoland:true,  hudls:true,  apFdToDh:true, rollout:"FAIL_OPERATIONAL", dh:0,   rvr:75,  lvo:"CAT IIIB sans DH"},
  {id:"B789", name:"Boeing 787-9",       mfr:"Boeing", cat:"D", engines:2, pilots:2, xwind:38, tailwind:15, autoland:true,  hudls:true,  apFdToDh:true, rollout:"FAIL_OPERATIONAL", dh:0,   rvr:75,  lvo:"CAT IIIB sans DH"},
  {id:"B78X", name:"Boeing 787-10",      mfr:"Boeing", cat:"D", engines:2, pilots:2, xwind:38, tailwind:15, autoland:true,  hudls:true,  apFdToDh:true, rollout:"FAIL_OPERATIONAL", dh:0,   rvr:75,  lvo:"CAT IIIB sans DH"},
  {id:"B744", name:"Boeing 747-400",     mfr:"Boeing", cat:"C", engines:4, pilots:2, xwind:33, tailwind:10, autoland:true,  hudls:false, apFdToDh:true, rollout:"FAIL_OPERATIONAL", dh:50,  rvr:125, lvo:"CAT IIIB"},
  {id:"B748", name:"Boeing 747-8",       mfr:"Boeing", cat:"C", engines:4, pilots:2, xwind:33, tailwind:10, autoland:true,  hudls:true,  apFdToDh:true, rollout:"FAIL_OPERATIONAL", dh:50,  rvr:125, lvo:"CAT IIIB"},

  /* ---------------- Embraer ---------------- */
  {id:"E170", name:"Embraer 170",        mfr:"Embraer", cat:"C", engines:2, pilots:2, xwind:38, tailwind:10, autoland:false, hudls:false, apFdToDh:true, rollout:"NONE", dh:100, rvr:300, lvo:"CAT II"},
  {id:"E75L", name:"Embraer 175",        mfr:"Embraer", cat:"C", engines:2, pilots:2, xwind:38, tailwind:10, autoland:false, hudls:false, apFdToDh:true, rollout:"NONE", dh:100, rvr:300, lvo:"CAT II"},
  {id:"E190", name:"Embraer 190",        mfr:"Embraer", cat:"C", engines:2, pilots:2, xwind:38, tailwind:10, autoland:false, hudls:false, apFdToDh:true, rollout:"NONE", dh:100, rvr:300, lvo:"CAT II"},
  {id:"E195", name:"Embraer 195",        mfr:"Embraer", cat:"C", engines:2, pilots:2, xwind:38, tailwind:10, autoland:false, hudls:false, apFdToDh:true, rollout:"NONE", dh:100, rvr:300, lvo:"CAT II"},
  {id:"E290", name:"Embraer E190-E2",    mfr:"Embraer", cat:"C", engines:2, pilots:2, xwind:38, tailwind:10, autoland:false, hudls:true,  apFdToDh:true, rollout:"NONE", dh:100, rvr:300, lvo:"CAT II"},
  {id:"E295", name:"Embraer E195-E2",    mfr:"Embraer", cat:"C", engines:2, pilots:2, xwind:38, tailwind:10, autoland:false, hudls:true,  apFdToDh:true, rollout:"NONE", dh:100, rvr:300, lvo:"CAT II"},

  /* ---------------- Régional ---------------- */
  {id:"CRJ7", name:"Bombardier CRJ700",  mfr:"Régional", cat:"C", engines:2, pilots:2, xwind:32, tailwind:10, autoland:false, hudls:false, apFdToDh:true, rollout:"NONE", dh:100, rvr:300, lvo:"CAT II"},
  {id:"CRJ9", name:"Bombardier CRJ900",  mfr:"Régional", cat:"C", engines:2, pilots:2, xwind:32, tailwind:10, autoland:false, hudls:false, apFdToDh:true, rollout:"NONE", dh:100, rvr:300, lvo:"CAT II"},
  {id:"CRJX", name:"Bombardier CRJ1000", mfr:"Régional", cat:"C", engines:2, pilots:2, xwind:32, tailwind:10, autoland:false, hudls:false, apFdToDh:true, rollout:"NONE", dh:100, rvr:300, lvo:"CAT II"},
  {id:"DH8D", name:"Dash 8 Q400",        mfr:"Régional", cat:"C", engines:2, pilots:2, xwind:35, tailwind:10, autoland:false, hudls:false, apFdToDh:true, rollout:"NONE", dh:100, rvr:300, lvo:"CAT II"},
  {id:"AT45", name:"ATR 42-500",         mfr:"Régional", cat:"B", engines:2, pilots:2, xwind:35, tailwind:10, autoland:false, hudls:false, apFdToDh:true, rollout:"NONE", dh:200, rvr:550, lvo:"CAT I"},
  {id:"AT72", name:"ATR 72-500/600",     mfr:"Régional", cat:"B", engines:2, pilots:2, xwind:35, tailwind:15, autoland:false, hudls:false, apFdToDh:true, rollout:"NONE", dh:200, rvr:550, lvo:"CAT I"},
  {id:"SF34", name:"Saab 340",           mfr:"Régional", cat:"B", engines:2, pilots:2, xwind:30, tailwind:10, autoland:false, hudls:false, apFdToDh:true, rollout:"NONE", dh:200, rvr:550, lvo:"CAT I"},
  {id:"JS41", name:"Jetstream 41",       mfr:"Régional", cat:"B", engines:2, pilots:2, xwind:30, tailwind:10, autoland:false, hudls:false, apFdToDh:true, rollout:"NONE", dh:200, rvr:550, lvo:"CAT I"},

  /* ---------------- Affaires ---------------- */
  {id:"GLEX", name:"Bombardier Global 6000", mfr:"Affaires", cat:"C", engines:2, pilots:2, xwind:32, tailwind:10, autoland:false, hudls:true,  apFdToDh:true, rollout:"NONE", dh:100, rvr:300, lvo:"CAT II"},
  {id:"GLF6", name:"Gulfstream G650",        mfr:"Affaires", cat:"C", engines:2, pilots:2, xwind:33, tailwind:10, autoland:false, hudls:true,  apFdToDh:true, rollout:"NONE", dh:100, rvr:300, lvo:"CAT II / EFVS"},
  {id:"F2TH", name:"Dassault Falcon 2000",   mfr:"Affaires", cat:"C", engines:2, pilots:2, xwind:30, tailwind:10, autoland:false, hudls:true,  apFdToDh:true, rollout:"NONE", dh:100, rvr:300, lvo:"CAT II"},
  {id:"FA7X", name:"Dassault Falcon 7X",     mfr:"Affaires", cat:"C", engines:3, pilots:2, xwind:30, tailwind:10, autoland:false, hudls:true,  apFdToDh:true, rollout:"NONE", dh:100, rvr:300, lvo:"CAT II"},
  {id:"C56X", name:"Cessna Citation XLS",    mfr:"Affaires", cat:"B", engines:2, pilots:1, xwind:24, tailwind:10, autoland:false, hudls:false, apFdToDh:true, rollout:"NONE", dh:200, rvr:550, lvo:"CAT I"},
  {id:"C25C", name:"Cessna Citation CJ4",    mfr:"Affaires", cat:"B", engines:2, pilots:1, xwind:24, tailwind:10, autoland:false, hudls:false, apFdToDh:true, rollout:"NONE", dh:200, rvr:550, lvo:"CAT I"},
  {id:"E55P", name:"Embraer Phenom 300",     mfr:"Affaires", cat:"B", engines:2, pilots:1, xwind:25, tailwind:10, autoland:false, hudls:false, apFdToDh:true, rollout:"NONE", dh:200, rvr:550, lvo:"CAT I"},
  {id:"PC24", name:"Pilatus PC-24",          mfr:"Affaires", cat:"B", engines:2, pilots:1, xwind:25, tailwind:10, autoland:false, hudls:false, apFdToDh:true, rollout:"NONE", dh:200, rvr:550, lvo:"CAT I"},

  /* ---------------- Monopilote / travail aérien ---------------- */
  {id:"B350", name:"Beechcraft King Air 350", mfr:"Monopilote", cat:"B", engines:2, pilots:1, xwind:25, tailwind:10, autoland:false, hudls:false, apFdToDh:true, rollout:"NONE", dh:200, rvr:550, lvo:"CAT I"},
  {id:"PC12", name:"Pilatus PC-12",           mfr:"Monopilote", cat:"A", engines:1, pilots:1, xwind:30, tailwind:10, autoland:false, hudls:false, apFdToDh:true, rollout:"NONE", dh:250, rvr:800, lvo:"CAT I"},
  {id:"TBM9", name:"Daher TBM 940",           mfr:"Monopilote", cat:"A", engines:1, pilots:1, xwind:25, tailwind:10, autoland:false, hudls:false, apFdToDh:true, rollout:"NONE", dh:250, rvr:800, lvo:"CAT I"},
  {id:"C208", name:"Cessna 208B Caravan",     mfr:"Monopilote", cat:"A", engines:1, pilots:1, xwind:20, tailwind:10, autoland:false, hudls:false, apFdToDh:true, rollout:"NONE", dh:250, rvr:800, lvo:"CAT I"}
];
