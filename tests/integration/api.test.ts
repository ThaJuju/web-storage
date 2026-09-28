import { randomBytes } from "node:crypto";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client, USERS, baseUrl } from "./client";

const prisma = new PrismaClient();
const alice = new Client();
const bob = new Client();
const admin = new Client();

// Nombre de fichiers presents sur le disque de test (toutes arborescences).
async function diskFiles(): Promise<number> {
  const root = process.env.STORAGE_DIR!;
  const entries = await readdir(root, { recursive: true, withFileTypes: true }).catch(() => []);
  return entries.filter((e) => e.isFile()).length;
}

async function setQuota(email: string, bytes: bigint) {
  await prisma.user.update({ where: { email }, data: { quotaBytes: bytes } });
}

beforeAll(async () => {
  // Une seule connexion par compte (le login est limite a 10/min par IP).
  await alice.login(USERS.alice);
  await bob.login(USERS.bob);
  await admin.login(USERS.admin);
});

afterAll(() => prisma.$disconnect());

describe("upload", () => {
  it("stocke un fichier > 10 Mo sans troncature (taille et contenu exacts)", async () => {
    const data = randomBytes(20_000_000);
    const { res, node } = await alice.upload("root", "gros.bin", data);
    expect(res.status).toBe(201);
    expect(node.size).toBe("20000000");
    const back = Buffer.from(await (await alice.req(`/api/nodes/${node.id}/content`)).arrayBuffer());
    expect(back.equals(data)).toBe(true);
  });

  it("accepte un upload chunked (sans Content-Length) de taille exacte", async () => {
    const data = randomBytes(12_000_000);
    const stream = new ReadableStream({
      start(c) {
        for (let i = 0; i < data.length; i += 1_000_000) c.enqueue(data.subarray(i, i + 1_000_000));
        c.close();
      },
    });
    const { res, node } = await alice.upload("root", "chunked.bin", stream);
    expect(res.status).toBe(201);
    expect(node.size).toBe("12000000");
  });

  it("refuse au-dela de MAX_UPLOAD_SIZE_BYTES, meme en chunked, sans residu disque", async () => {
    const before = await diskFiles();
    const big = randomBytes(31_000_000);
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(big);
        c.close();
      },
    });
    const { res } = await alice.upload("root", "trop.bin", stream);
    expect(res.status).toBe(413);
    expect(await diskFiles()).toBe(before);
  });

  it("respecte le quota (pre-controle et pendant le transfert)", async () => {
    const used = await bob.usage();
    await setQuota(USERS.bob.email, used + 1_000_000n);
    try {
      const before = await diskFiles();
      const r1 = await bob.upload("root", "q1.bin", randomBytes(2_000_000));
      expect(r1.res.status).toBe(413);
      expect(r1.error).toMatch(/Quota/);
      const r2 = await bob.upload("root", "q2.bin", randomBytes(600_000));
      expect(r2.res.status).toBe(201);
      const r3 = await bob.upload("root", "q3.bin", randomBytes(600_000));
      expect(r3.res.status).toBe(413);
      expect(await bob.usage()).toBe(used + 600_000n);
      expect(await diskFiles()).toBe(before + 1);
    } finally {
      await setQuota(USERS.bob.email, 50_000_000_000n);
    }
  });

  it("ne sert jamais un fichier HTML comme HTML (XSS stockee)", async () => {
    const { node } = await alice.upload("root", "x.html", "<script>alert(1)</script>", {
      "Content-Type": "text/html",
    });
    const res = await alice.req(`/api/nodes/${node.id}/content`);
    expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(res.headers.get("content-security-policy")).toMatch(/sandbox/);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });
});

describe("isolation entre utilisateurs (IDOR)", () => {
  it("bob ne peut ni lire, ni lister, ni modifier, ni supprimer un element d'alice", async () => {
    const { node: folder } = await alice.mkdir("root", "Prive");
    const { node: file } = await alice.upload(folder.id, "secret.txt", "confidentiel");

    expect((await bob.req(`/api/nodes/${file.id}/content`)).status).toBe(404);
    expect((await bob.req(`/api/nodes/${folder.id}/zip`)).status).toBe(404);
    expect((await bob.req(`/api/nodes?folder=${folder.id}`)).status).toBe(404);
    expect(
      (await bob.req(`/api/nodes/${file.id}`, { method: "PATCH", json: { name: "x" } })).status
    ).toBe(404);
    expect((await bob.req(`/api/nodes/${folder.id}`, { method: "DELETE" })).status).toBe(404);
    expect((await bob.upload(folder.id, "intrus.txt", "x")).res.status).toBe(404);
    // Bob ne peut pas non plus deplacer ses fichiers dans le dossier d'alice.
    const { node: own } = await bob.upload("root", "a-moi.txt", "x");
    expect(
      (await bob.req(`/api/nodes/${own.id}`, { method: "PATCH", json: { parentId: folder.id } }))
        .status
    ).toBe(404);
    // Recherche : seulement ses propres fichiers.
    const search = await (await bob.req("/api/nodes?q=secret")).json();
    expect(search.results).toEqual([]);
  });

  it("un non-admin n'accede pas a l'administration", async () => {
    expect((await bob.req("/api/admin/users")).status).toBe(403);
    expect((await bob.req("/api/admin/logins")).status).toBe(403);
  });
});

describe("renommage / deplacement", () => {
  it("unicite des noms, y compris a la racine", async () => {
    expect((await alice.mkdir("root", "Doublon")).res.status).toBe(201);
    expect((await alice.mkdir("root", "Doublon")).res.status).toBe(409);
    const { node: other } = await alice.mkdir("root", "Autre");
    const r = await alice.req(`/api/nodes/${other.id}`, { method: "PATCH", json: { name: "Doublon" } });
    expect(r.status).toBe(409);
  });

  it("empeche les cycles et conserve le fil d'Ariane", async () => {
    const { node: a } = await alice.mkdir("root", "A");
    const { node: b } = await alice.mkdir(a.id, "B");
    const { node: c } = await alice.mkdir(b.id, "C");
    const crumbs = (await (await alice.req(`/api/nodes?folder=${c.id}`)).json()).breadcrumb;
    expect(crumbs.map((x: { name: string }) => x.name)).toEqual(["A", "B", "C"]);
    for (const target of [a.id, c.id]) {
      const r = await alice.req(`/api/nodes/${a.id}`, { method: "PATCH", json: { parentId: target } });
      expect(r.status).toBe(400);
    }
    const ok = await alice.req(`/api/nodes/${c.id}`, { method: "PATCH", json: { parentId: "root" } });
    expect(ok.status).toBe(200);
  });
});

describe("suppression recursive", () => {
  it("supprime l'arbre, libere le quota et efface les fichiers disque", async () => {
    const used = await alice.usage();
    const files = await diskFiles();
    const { node: t } = await alice.mkdir("root", "Arbre");
    const { node: s } = await alice.mkdir(t.id, "sous");
    await alice.upload(t.id, "1.bin", randomBytes(1000));
    await alice.upload(s.id, "2.bin", randomBytes(2000));
    expect(await alice.usage()).toBe(used + 3000n);
    expect(await diskFiles()).toBe(files + 2);

    expect((await alice.req(`/api/nodes/${t.id}`, { method: "DELETE" })).status).toBe(200);
    expect(await alice.usage()).toBe(used);
    expect(await diskFiles()).toBe(files);
    expect((await alice.req(`/api/nodes?folder=${s.id}`)).status).toBe(404);
  });
});

describe("sessions", () => {
  it("un changement de mot de passe par l'admin revoque les sessions du compte", async () => {
    const carol = { email: "carol@test.fr", password: "carolpassword1" };
    const created = await admin.req("/api/admin/users", { method: "POST", json: carol });
    expect(created.status).toBe(201);
    const { user } = await created.json();
    const c = await new Client().login(carol);
    expect((await c.req("/api/usage")).status).toBe(200);

    const patch = await admin.req(`/api/admin/users/${user.id}`, {
      method: "PATCH",
      json: { password: "carolpassword2" },
    });
    expect(patch.status).toBe(200);
    expect((await c.req("/api/usage")).status).toBe(401);
  });

  it("une copie du cookie est invalide apres deconnexion, et un admin retrograde perd ses droits", async () => {
    const dave = { email: "dave@test.fr", password: "davepassword1", isAdmin: true };
    const { user } = await (await admin.req("/api/admin/users", { method: "POST", json: dave })).json();
    const d = await new Client().login(dave);
    expect((await d.req("/api/admin/users")).status).toBe(200);

    await admin.req(`/api/admin/users/${user.id}`, { method: "PATCH", json: { isAdmin: false } });
    expect((await d.req("/api/admin/users")).status).toBe(403);

    const copy = new Client();
    copy.cookies = new Map(d.cookies);
    expect((await d.req("/api/auth/logout", { method: "POST" })).status).toBe(200);
    expect((await copy.req("/api/usage")).status).toBe(401);
  });

  it("un cookie invalide ne provoque pas de boucle de redirection", async () => {
    const c = new Client();
    c.cookies.set("webstorage_session", "garbage");
    const login = await c.req("/login");
    expect(login.status).toBe(200);
    const page = await c.req("/folder/root");
    expect(page.status).toBe(307);
    const clear = await c.req(page.headers.get("location")!);
    expect(new URL(clear.headers.get("location")!, baseUrl()).pathname).toBe("/login");
    expect(c.cookies.has("webstorage_session")).toBe(false);
  });
});

describe("zip", () => {
  it("liste les fichiers manquants dans _ERREURS.txt au lieu de tronquer l'archive", async () => {
    const { node: z } = await alice.mkdir("root", "ZipTest");
    await alice.upload(z.id, "ok.txt", "bonjour");
    const { node: gone } = await alice.upload(z.id, "perdu.txt", "x");
    const row = await prisma.node.findUniqueOrThrow({ where: { id: gone.id } });
    const { unlink } = await import("node:fs/promises");
    await unlink(
      path.join(process.env.STORAGE_DIR!, row.ownerId, row.storageKey!.slice(0, 2), row.storageKey!)
    );
    const res = await alice.req(`/api/nodes/${z.id}/zip`);
    expect(res.status).toBe(200);
    const buf = Buffer.from(await res.arrayBuffer());
    // Fin d'archive (End Of Central Directory) presente : zip complet.
    expect(buf.includes(Buffer.from([0x50, 0x4b, 0x05, 0x06]))).toBe(true);
    expect(buf.includes(Buffer.from("_ERREURS.txt"))).toBe(true);
    expect(buf.includes(Buffer.from("ok.txt"))).toBe(true);
  });
});
