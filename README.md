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
| Base de données | SQLite via Prisma (métadonnées uniquement) |
| Sessions | `iron-session` — cookie chiffré `httpOnly` / `secure` / `sameSite=strict` |
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
          totpSecret (2FA optionnelle)

Node      id, ownerId, parentId (null = racine), type ("FILE"|"FOLDER"),
          name (affiché), size, mimeType, storageKey (UUID disque, unique)
          @@unique([ownerId, parentId, name])   // pas de doublon dans un dossier

LoginLog  id, userId, email, ip, success, createdAt   // journal des connexions

Session   id (sha256 de l'identifiant du cookie), userId,
          createdAt, lastSeenAt, expiresAt              // sessions serveur
```

Fichiers et dossiers partagent la table `Node` (arbre par `parentId`) : le
renommage, le déplacement, la suppression récursive et le fil d'ariane sont
codés une seule fois. `usedBytes` est mis à jour dans la **même transaction**
que chaque upload/suppression, pour un quota instantané.

### Structure des dossiers

```
src/
├── proxy.ts                      # redirection deny-by-default + CSP à nonce + headers
├── app/
│   ├── login/                    # page de connexion (publique)
│   ├── page.tsx                  # redirige vers /folder/root ou /login
│   ├── (drive)/                  # groupe protégé (auth vérifiée côté serveur)
│   │   ├── layout.tsx            # sidebar + indicateur d'espace + auto-logout
│   │   ├── folder/[id]/          # explorateur (racine = /folder/root)
│   │   └── admin/logins/         # journal des connexions (admin)
│   └── api/
│       ├── auth/login | logout/
│       ├── nodes/                # GET listing/recherche, POST création dossier
│       ├── nodes/[id]/           # PATCH renommer/déplacer, DELETE
│       ├── nodes/[id]/upload/    # upload streamé (corps brut → disque)
│       ├── nodes/[id]/content/   # download + streaming Range (mp4)
│       ├── nodes/[id]/zip/       # zip d'un dossier à la volée
│       ├── usage/                # quota
│       └── admin/logins/
├── lib/
│   ├── db, session, storage, nodes, rate-limit, validation, totp, api, format
└── components/
    ├── DriveShell, Sidebar, StorageMeter, UsageContext, Modal
    ├── explorer/                 # explorateur, upload drag & drop, déplacement
    └── preview/
        ├── registry.tsx          # mime → composant   ← POINT D'EXTENSION previews
        ├── VideoPreview, TextPreview, ImagePreview
prisma/    schema.prisma, seed.ts
scripts/   set-password.ts
storage/   fichiers binaires (gitignored)
```

### Fonctionnalités de sécurité

- Cookies `httpOnly` + `secure` (prod) + `sameSite=strict`.
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
- **Déconnexion automatique** après 30 min d'inactivité (TTL glissant côté
  serveur + minuteur côté client).
- **En-têtes** : CSP à nonce (`default-src 'self'`, `media-src 'self'`…),
  `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy`, `Permissions-Policy`.
- **2FA TOTP** (bonus) compatible Google Authenticator, implémentée sans
  dépendance externe (`src/lib/totp.ts`). Activable par compte via le champ
  `totpSecret` (voir plus bas).

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
dans les logs). Longueur minimale : 10 caractères.

### Activer la 2FA (optionnel)

Générer un secret et l'associer à un compte :

```bash
npx tsx -e "import('./src/lib/totp').then(async m => {
  const { PrismaClient } = require('@prisma/client');
  const p = new PrismaClient();
  const secret = m.generateTotpSecret();
  await p.user.update({ where: { email: 'admin@example.com' }, data: { totpSecret: secret } });
  console.log('Secret (a scanner dans Google Authenticator) :');
  console.log(m.totpAuthUri(secret, 'admin@example.com'));
  await p.\$disconnect();
})"
```

Scanner l'URI `otpauth://` affichée (via un QR code) dans Google
Authenticator. À la prochaine connexion, un code à 6 chiffres sera demandé.

---

## 4. Vérifications effectuées

Le flux complet a été testé de bout en bout : login (+ rejet CSRF, mauvais mot
de passe, session absente), création de dossier, sanitization de
`../../etc/passwd` → `passwd`, upload streamé, upload de dossier avec
arborescence conservée, lecture texte inline, **streaming Range** (`206 Partial
Content` + seek), zip d'un dossier, suppression récursive avec mise à jour du
quota et nettoyage disque, **isolation entre utilisateurs** (accès croisé →
404) et autorisation admin (non-admin → 403).
