-- Unicite des noms a la racine.
-- En SQLite, les NULL sont distincts dans un index UNIQUE : la contrainte
-- @@unique([ownerId, parentId, name]) ne s'applique donc jamais aux elements
-- de la racine (parentId IS NULL). Prisma ne sait pas exprimer un index
-- partiel dans le schema : il est cree ici, a la main.

-- 1. Dedoublonnage des donnees existantes : on garde le plus ancien et on
--    suffixe les autres avec la fin de leur id (garanti unique).
UPDATE "Node"
SET "name" = "name" || ' (' || substr("id", -6) || ')'
WHERE "id" IN (
  SELECT "id" FROM (
    SELECT "id",
           ROW_NUMBER() OVER (
             PARTITION BY "ownerId", "name"
             ORDER BY "createdAt", "id"
           ) AS rn
    FROM "Node"
    WHERE "parentId" IS NULL
  ) WHERE rn > 1
);

-- 2. Index unique partiel sur la racine.
CREATE UNIQUE INDEX "Node_ownerId_root_name_key"
ON "Node"("ownerId", "name")
WHERE "parentId" IS NULL;
