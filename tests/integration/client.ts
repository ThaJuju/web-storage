import { inject } from "vitest";
import { USERS } from "./fixtures";

export { USERS };
export const baseUrl = () => inject("baseUrl");

/** Client HTTP minimal avec cookies (comme un navigateur) et Origin. */
export class Client {
  cookies = new Map<string, string>();

  async req(path: string, init: RequestInit & { json?: unknown } = {}) {
    const headers = new Headers(init.headers);
    headers.set("Origin", baseUrl());
    if (this.cookies.size) {
      headers.set(
        "Cookie",
        [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ")
      );
    }
    let body = init.body;
    if (init.json !== undefined) {
      headers.set("Content-Type", "application/json");
      body = JSON.stringify(init.json);
    }
    const doFetch = () =>
      fetch(baseUrl() + path, {
        ...init,
        headers,
        body,
        redirect: "manual",
        // Corps en flux (upload chunked).
        ...(body instanceof ReadableStream ? { duplex: "half" } : {}),
      } as RequestInit);
    let res: Response;
    try {
      res = await doFetch();
    } catch (e) {
      // Connexion keep-alive fermee par le serveur (ex. upload interrompu
      // en 413) : comme un navigateur, on rejoue UNE fois une requete GET.
      const code = (e as { cause?: { code?: string } }).cause?.code;
      if ((init.method ?? "GET") !== "GET" || code !== "ECONNRESET") throw e;
      res = await doFetch();
    }
    for (const c of res.headers.getSetCookie()) {
      const [pair, ...attrs] = c.split(";");
      const i = pair.indexOf("=");
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1).trim();
      const expired = attrs.some((a) => /max-age=0/i.test(a.trim()));
      if (!value || expired) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    return res;
  }

  async login(user: { email: string; password: string }) {
    const res = await this.req("/api/auth/login", {
      method: "POST",
      json: { email: user.email, password: user.password },
    });
    if (res.status !== 200) throw new Error(`login ${user.email} : ${res.status}`);
    return this;
  }

  async mkdir(parentId: string, name: string) {
    const res = await this.req("/api/nodes", {
      method: "POST",
      json: { parentId, name },
    });
    return { res, node: res.ok ? (await res.json()).node : null };
  }

  async upload(
    folderId: string,
    name: string,
    body: BodyInit,
    headers: Record<string, string> = {}
  ) {
    const res = await this.req(`/api/nodes/${folderId}/upload`, {
      method: "POST",
      headers: { "x-file-name": encodeURIComponent(name), ...headers },
      body,
    });
    const data = await res.json().catch(() => ({}));
    return { res, node: data.node, error: data.error as string | undefined };
  }

  async usage(): Promise<bigint> {
    const d = await (await this.req("/api/usage")).json();
    return BigInt(d.usedBytes);
  }
}
