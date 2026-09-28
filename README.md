# Mon espace de stockage

Application web de stockage de fichiers personnel (dans l'esprit de Dropbox) :
authentification sécurisée, explorateur de fichiers, upload drag & drop
(fichiers **et** dossiers), prévisualisation vidéo/texte, téléchargement zip à
la volée et indicateur de quota. Aucune inscription publique.

---

## 1. Architecture

### Stack

| Composant | Choix |
|---|---|
| Framework | Next.js 16 (App Router, TypeScript) — frontend + API dans une seule app |
| Base de données | SQLite via Prisma 7 + adaptateur libSQL (métadonnées uniquement) ; client généré dans `src/generated/prisma` par `npm install` |
| Sessions | table `Session` en base ; cookie `iron-session` chiffré (`httpOnly`, `sameSite=strict`, `secure` si `APP_HTTPS=true`) ne portant qu'un identifiant |
| Mots de passe | `bcrypt` (coût 12) |
| Zip à la volée | `archiver` (streaming, sans fichier temporaire) |
| UI | Tailwind CSS |
| Stockage | dossier `storage/` à la racine, **hors de `public/`**, jamais servi statiquement |

### Principe de sécurité central

- **Le nom de fichier fourni par l'utilisateur ne touche jamais le disque.**
  Chaque fichier est stocké sous un UUID interne, dans
  `storage/<userId>/<2 premiers chars de l'uuid>/<uuid>`. Le nom original
  n'existe qu'en base de données → le *path traversal* est structurellement
  impossible. La sanitization des noms (`src/lib/validation.ts`) est une
  défense supplémentaire, pas l'unique rempart.
- **Ownership vérifié partout.** Toute lecture/écriture d'un `Node` passe par
  `src/lib/nodes.ts`, qui contraint systématiquement `ownerId = session`.
  Aucun chemin de code ne charge une ressource par son seul id → pas d'IDOR.
- **Deux frontières.** Le fichier `src/proxy.ts` (ex-middleware) fait une
  redirection *deny-by-default* et pose les en-têtes de sécurité ; la vraie
  autorisation est refaite côté serveur dans chaque page/route
  (`getAuthenticatedUser` / `requireUser`).

### Schéma de base de données

```
User      id, email(unique), passwordHash, isAdmin,
          quotaBytes (défaut 50 Go), usedBytes (dénormalisé, transactionnel),
          totpSecret (chiffré), totpPendingSecret, totpLastCounter,
          totpRecoveryCodes (empreintes)                // 2FA optionnelle

Node      id, ownerId, parentId (null = racine), type ("FILE"|"FOLDER"),
          name (affiché), size, mimeType, storageKey (UUID disque, unique)
          @@unique([ownerId, parentId, name])   // pas de doublon dans un dossier
          + index unique partiel (ownerId, name) WHERE parentId IS NULL (racine)

LoginLog  id, userId, email, ip, success, createdAt   // journal des connexions

Session   id (sha256 de l'identifiant du cookie), userId,
          createdAt, lastSeenAt, expiresAt              // sessions serveur

TwoFactorChallenge id (sha256), userId, ip, attempts, expiresAt
                                                        // étape 2FA du login
```

Fichiers et dossiers partagent la table `Node` (arbre par `parentId`) : le
renommage, le déplacement, la suppression récursive et le fil d'ariane sont
codés une seule fois. `usedBytes` est mis à jour dans la **même transaction**
que chaque upload/suppression, pour un quota instantané : incrément
conditionnel atomique à l'upload (`usedBytes + taille <= quotaBytes`),
descendants recensés dans la transaction de suppression. En cas d'incident
(crash entre l'écriture disque et la base, effacement disque raté…) :

```bash
npm run reconcile          # rapport : quotas faux, orphelins disque, fichiers manquants
npm run reconcile -- --fix # recalcule usedBytes et supprime les orphelins disque
```

### Structure des dossiers

```
server.mjs                        # serveur HTTP (IP client fiable) autour de Next
src/
├── proxy.ts                      # redirection deny-by-default + CSP à nonce + headers
├── app/
│   ├── login/                    # page de connexion (publique)
│   ├── page.tsx                  # redirige vers /folder/root ou /login
│   ├── (drive)/                  # groupe protégé (auth vérifiée côté serveur)
│   │   ├── layout.tsx            # sidebar + indicateur d'espace + auto-logout
│   │   ├── folder/[id]/          # explorateur (racine = /folder/root)
│   │   ├── security/             # 2FA du compte (enrôlement, codes de récupération)
│   │   └── admin/users | logins/ # gestion des comptes, journal des connexions
│   └── api/
│       ├── auth/login | 2fa | logout | session | expired/
│       ├── account/2fa/          # enrôlement / désactivation 2FA
│       ├── nodes/                # GET listing/recherche, POST création dossier
│       ├── nodes/[id]/           # PATCH renommer/déplacer, DELETE
│       ├── nodes/[id]/upload/    # upload streamé (corps brut → disque)
│       ├── nodes/[id]/content/   # download + streaming Range (mp4)
│       ├── nodes/[id]/zip/       # zip d'un dossier (ou de "root") à la volée
│       ├── usage/                # quota
│       └── admin/users | logins/
├── lib/
│   ├── db, session, storage, nodes, rate-limit, validation, api, format
│   ├── totp, totp-crypto, two-factor, mime, client-ip, activity
└── components/
    ├── DriveShell, Sidebar, StorageMeter, UsageContext, Modal
    ├── account/                  # page Sécurité
    ├── admin/                    # gestion des utilisateurs
    ├── explorer/                 # explorateur, upload drag & drop, déplacement
    └── preview/
        ├── registry.tsx          # mime → composant   ← POINT D'EXTENSION previews
        ├── VideoPreview, TextPreview, ImagePreview
prisma/    schema.prisma, seed.ts, migrations/
scripts/   set-password, reconcile, encrypt-totp-secrets, find-truncated-uploads
storage/   fichiers binaires (gitignored)
```

### Fonctionnalités de sécurité

- Cookies `httpOnly` + `sameSite=strict` ; `secure` **uniquement si
  `APP_HTTPS=true`** (`NODE_ENV=production` ne l'active pas : en accès
  HTTP simple, un cookie `secure` ne serait jamais renvoyé par le
  navigateur). En production exposée sur Internet, servir l'app en HTTPS
  et mettre `APP_HTTPS=true` (voir « Déploiement »).
- **Anti-CSRF double** : `sameSite=strict` + vérification du header `Origin`
  sur toute mutation.
- **Anti brute-force** : blocage à délai progressif (1 → 2 → 4 → 8 min,
  plafonné à 30 min) après 5 échecs d'un même couple **(compte, IP)** ou
  20 échecs d'une même IP tous comptes confondus. Jamais de blocage sur le
  seul e-mail (sinon n'importe qui pourrait bloquer le propriétaire) : un
  compte visé depuis de nombreuses IP est seulement **ralenti** (2 s par
  tentative) et signalé à l'admin dans le journal des connexions. Pendant
  un blocage, mot de passe **et** code 2FA valides permettent quand même de
  se connecter. Réponse identique que le compte existe ou non, comparaison
  bcrypt même sur compte inexistant (anti-énumération / timing).
- **Rate limiting** (token bucket en mémoire, borné à 10 000 clés) sur le
  login (par IP réelle du client, voir `TRUST_PROXY`) et sur l'upload (par
  utilisateur : rafale de 200 fichiers puis 10/s, 3 envois simultanés max).
- **Upload borné pendant le transfert** : refus immédiat si le
  `Content-Length` dépasse la taille max ou le quota restant, et comptage
  des octets au fil de l'eau : l'écriture est interrompue (fichier partiel
  supprimé, 413) dès que `min(MAX_UPLOAD_SIZE_BYTES, quota restant)` est
  dépassé, y compris en `Transfer-Encoding: chunked`.
- **Journal des connexions** conservé 90 jours.
- **Sessions côté serveur** : le cookie chiffré ne contient qu'un
  identifiant aléatoire ; utilisateur et rôle sont relus en base à chaque
  requête. Déconnexion, changement de mot de passe, réinitialisation 2FA,
  suppression du compte ou « déconnecter toutes les sessions » (admin)
  révoquent immédiatement les sessions concernées. Durée de vie absolue :
  12 h.
- **Déconnexion automatique** après 30 min d'inactivité : TTL glissant
  côté serveur (qui fait foi) + minuteur côté client. L'activité est
  partagée entre onglets, et un upload en cours ou une vidéo en lecture
  comptent comme de l'activité (heartbeat serveur toutes les 5 min tant
  que l'utilisateur est actif).
- **En-têtes** (posés par `src/proxy.ts` sur toutes les réponses hors
  `_next/static`) : CSP à nonce par requête (`script-src 'self'
  'nonce-…' 'strict-dynamic'`, sans `'unsafe-inline'` pour les scripts ;
  toutes les pages sont rendues dynamiquement pour recevoir le nonce),
  `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: no-referrer`, `Permissions-Policy`,
  `Cross-Origin-Opener-Policy` et `Cross-Origin-Resource-Policy:
  same-origin`, et `Strict-Transport-Security` (2 ans) quand
  `APP_HTTPS=true`.
- **Contenus utilisateur isolés** : la route `content` ne sert inline que
  des types sûrs (vidéo, audio, images matricielles, PDF), le texte en
  `text/plain`, le reste en téléchargement, toujours sous une CSP
  `sandbox` dédiée (un `.html` / `.svg` piégé ne s'exécute pas).
- **2FA TOTP** compatible Google Authenticator (`src/lib/totp.ts`,
  `src/lib/two-factor.ts`) : enrôlement depuis la page Sécurité, codes de
  récupération, anti-rejeu, secret chiffré au repos (voir plus bas).
- `SESSION_SECRET` n'est vérifié qu'à l'exécution : `next build` ne
  l'exige pas.

### Ajouter un format de prévisualisation

Tout est centralisé dans `src/components/preview/registry.tsx` : écrire un
composant qui reçoit `{ node, src }` (où `src` est l'URL de la route `content`
authentifiée) et l'enregistrer avec un prédicat `match`. Exemple pour les PDF :

```tsx
{ match: (n) => n.mimeType === "application/pdf", Component: PdfPreview }
```

---

## 2. Installation et lancement en local

Prérequis : **Node.js 20+**.

```bash
# 1. Dépendances
npm install

# 2. Variables d'environnement
cp .env.example .env
# Puis générer un secret de session (>= 32 caractères) :
#   openssl rand -hex 32
# et le coller dans SESSION_SECRET du fichier .env
```

Variables du `.env` :

| Variable | Rôle |
|---|---|
| `DATABASE_URL` | chemin SQLite (défaut `file:./dev.db`) |
| `SESSION_SECRET` | secret de chiffrement des cookies (**obligatoire, ≥ 32 car.**) |
| `STORAGE_DIR` | dossier de stockage des fichiers (défaut `./storage`) |
| `MAX_UPLOAD_SIZE_BYTES` | taille max d'un fichier (défaut 4 Go) |
| `APP_HTTPS` | `true` si l'app est servie en HTTPS (cookie `secure`, HSTS…) |
| `TRUST_PROXY` | `true` **uniquement** derrière un reverse-proxy de confiance (voir ci-dessous) |
| `TOTP_ENCRYPTION_KEY` | clé de chiffrement des secrets 2FA (optionnelle, ≥ 32 car.) |
| `LISTEN_HOST` | interface d'écoute (`127.0.0.1` derrière un reverse-proxy local) |

```bash
# 3. Base de données (crée le schéma)
npx prisma migrate dev

# 4. Compte initial (voir section 3)
npm run seed

# 5. Démarrage
npm run dev            # développement  -> http://localhost:3000
# ou
npm run build && npm run start   # production
```

> Le port par défaut est 3000. Pour en changer : `PORT=3300 npm start`
> (ou `PORT=3300 npm run dev`).

`npm start` / `npm run dev` lancent `server.mjs`, un mince serveur HTTP
autour de Next.js : c'est lui qui détermine l'**IP du client** à partir de
la socket (rate-limit, blocage anti brute-force, journal des connexions).
Ne pas lancer `next start` directement : l'IP serait alors inconnue.

- **Accès direct** (`TRUST_PROXY=false`, défaut) : l'adresse de la socket
  est utilisée ; `X-Forwarded-For` / `X-Real-IP` envoyés par le client sont
  ignorés.
- **Derrière un reverse-proxy** (nginx, Caddy…) : mettre `TRUST_PROXY=true`
  ; l'app prend la **dernière** entrée de `X-Forwarded-For`, celle ajoutée
  par le proxy (nginx : `proxy_set_header X-Forwarded-For
  $proxy_add_x_forwarded_for;`). Le port de l'app ne doit alors plus être
  joignable directement.

---

## 3. Compte initial et mot de passe

Aucune inscription publique : le premier compte est créé par script.

```bash
SEED_EMAIL=vous@exemple.fr npm run seed
```

Cela crée le compte **administrateur** `SEED_EMAIL` (défaut :
`admin@example.com`) et affiche **une seule fois** un mot de passe
aléatoire dans la console. Notez-le, puis changez-le :

```bash
npm run set-password -- admin@example.com
```

Le mot de passe est saisi de façon masquée (jamais dans l'historique shell ni
dans les logs). Longueur : 10 caractères minimum, 72 octets maximum
(limite de bcrypt, refusée plutôt que tronquée en silence).

### Activer la 2FA (optionnel)

Chaque utilisateur active la 2FA depuis la page **Sécurité** (menu de
gauche) : QR code à scanner dans une application d'authentification
(Google Authenticator, Aegis, 1Password…), vérification d'un premier code,
puis affichage **unique** de 10 codes de récupération à conserver.

- Un code TOTP ne peut servir qu'une fois (anti-rejeu, RFC 6238 §5.2).
- Le secret est chiffré en base (AES-256-GCM). Clé dérivée de
  `TOTP_ENCRYPTION_KEY` si défini (recommandé : permet de changer
  `SESSION_SECRET` sans casser les 2FA), sinon de `SESSION_SECRET`.
  ⚠️ La clé doit rester stable : la définir **avant** que des comptes
  activent la 2FA (la changer ensuite rend leurs secrets illisibles ; il
  faudrait alors réinitialiser leur 2FA depuis l'admin).
  Après une mise à jour depuis une version antérieure :
  `npm run encrypt-totp` chiffre les secrets encore stockés en clair.
- À la connexion, l'étape 2FA est tenue côté serveur (5 min, 5 essais) :
  le mot de passe n'est pas renvoyé avec le code.
- Un admin peut réinitialiser la 2FA d'un compte (page Utilisateurs).

---

## 4. Déploiement en production

`server.mjs` parle **HTTP** (port `PORT`, 3300 avec `ecosystem.config.js`).
Exposé tel quel, les mots de passe et cookies circulent en clair et le
cookie ne peut pas être `secure`. En production, placer l'app derrière un
reverse-proxy TLS (nginx, Caddy…) et régler :

| Variable | Valeur | Effet |
|---|---|---|
| `APP_HTTPS` | `true` | cookie `secure`, HSTS, `upgrade-insecure-requests` |
| `TRUST_PROXY` | `true` | IP client = dernière entrée de `X-Forwarded-For` (ajoutée par le proxy) |
| `LISTEN_HOST` | `127.0.0.1` | le port HTTP n'est joignable que par le proxy local |

Exemple nginx :

```nginx
server {
  listen 443 ssl http2;
  server_name stockage.exemple.fr;
  ssl_certificate     /etc/letsencrypt/live/stockage.exemple.fr/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/stockage.exemple.fr/privkey.pem;

  client_max_body_size 0;          # la taille max est contrôlée par l'app
  proxy_request_buffering off;     # upload streamé jusqu'à l'app
  proxy_buffering off;             # download / zip / vidéo streamés
  proxy_read_timeout 1h;
  proxy_send_timeout 1h;

  location / {
    proxy_pass http://127.0.0.1:3300;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
  }
}
server { listen 80; server_name stockage.exemple.fr; return 301 https://$host$request_uri; }
```

Mise à jour d'une instance existante :

```bash
npm ci && npm run build
npm run db:deploy          # migrations
npm run encrypt-totp       # chiffre les secrets 2FA encore en clair
pm2 startOrReload ecosystem.config.js
```

---

## 5. Tests et intégration continue

```bash
npm run test:unit          # fonctions pures : validation, TOTP (vecteurs RFC 6238), MIME…
npm run build && npm test  # + intégration : serveur réel sur base/stockage temporaires
```

Les tests d'intégration (`tests/integration/`) démarrent `server.mjs` sur le
build de production avec une base SQLite et un `STORAGE_DIR` **temporaires**
(jamais les données réelles) et couvrent notamment : upload > 10 Mo (taille
et contenu exacts, y compris en chunked), taille max et quota pendant le
transfert, isolation entre utilisateurs (IDOR), unicité des noms et cycles,
suppression récursive + quota + disque, révocation des sessions, cookie
invalide sans boucle de redirection, XSS stockée, zip avec fichier
manquant, et la politique anti brute-force.

La CI GitHub Actions (`.github/workflows/ci.yml`) enchaîne à chaque push et
pull request : `npm ci`, lint, `tsc --noEmit`, build, tests, et
`npm audit --omit=dev --audit-level=high`. Dependabot propose les mises à
jour npm et GitHub Actions.
