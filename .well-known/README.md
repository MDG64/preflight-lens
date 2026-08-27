# assetlinks.json — Digital Asset Links pour la TWA Android

Ce fichier lie le domaine `notam.feyndev.com` à l'application Android : sans
lui — ou avec une mauvaise empreinte — la TWA s'ouvre **avec la barre d'URL
Chrome visible**, sans aucune erreur nulle part. C'est le symptôme à
reconnaître.

L'empreinte actuelle est un **placeholder** (que des zéros), posé avant le
premier dépôt sur Play. À remplacer par la vraie, en deux temps :

1. **`package_name`** doit être exactement l'`applicationId` donné à
   Bubblewrap (`com.feyndev.notamlens` — si un autre id est choisi au moment
   du `bubblewrap init`, changer les DEUX au même moment).
2. **`sha256_cert_fingerprints`** : après le premier upload de l'AAB, relever
   l'empreinte dans la **Play Console → Configuration → Signature d'application
   → Certificat de clé de signature d'application** (Play App Signing).
   ⚠️ PAS l'empreinte de la clé locale d'upload générée par Bubblewrap :
   Google re-signe l'AAB avec sa propre clé, et c'est CELLE-LÀ que l'appareil
   vérifie en production. On peut lister les deux empreintes (locale + Play)
   dans le tableau pour que le build de test local passe aussi en plein écran.

## Empreinte de la clé d'upload locale

Relevée le 27 août 2026 sur le keystore de Bubblewrap (alias `notamlens`,
RSA 2048, valide jusqu'au 23 décembre 2053) :

```
83:2C:BE:44:F7:DC:3F:93:20:E5:05:51:53:BA:08:E8:20:11:8F:54:00:45:71:3B:FA:E7:33:00:C3:7C:66:3D
```

C'est la **seconde** empreinte à mettre dans le tableau, jamais la seule : elle
ne vaut que pour les builds signés localement. Celle qui compte en production
reste celle de Play App Signing (point 2 ci-dessus).

Pour la relire depuis la machine — PowerShell, opérateur d'appel `&` obligatoire
devant un chemin entre guillemets ; le mot de passe du magasin est demandé et la
saisie reste invisible :

```powershell
& "$env:USERPROFILE\OpenJDK17U-jdk_x64_windows_hotspot_17.0.20_8\jdk-17.0.20+8\bin\keytool.exe" -list -v -keystore "$env:USERPROFILE\notam-lens-android\android-keystore" -alias notamlens
```

Une empreinte de certificat n'est pas un secret : celle-ci finira servie
publiquement dans `assetlinks.json`. Le keystore lui-même et ses deux mots de
passe vivent hors du dépôt, dans le coffre `Secrets-NOTAM-Lens`.

Vérification une fois en ligne :
https://developers.google.com/digital-asset-links/tools/generator
(ou `curl https://notam.feyndev.com/.well-known/assetlinks.json`).
