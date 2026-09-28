"use client";

import { useCallback, useState } from "react";

export interface UploadItem {
  id: string;
  name: string;
  progress: number; // 0..100
  status: "uploading" | "done" | "error";
  error?: string;
}

interface UploadInput {
  file: File;
  // Chemin relatif pour l'upload de dossier (webkitRelativePath), sinon undefined.
  relPath?: string;
}

/**
 * Gere une file d'uploads sequentiels avec progression. Chaque fichier est
 * envoye en corps brut (streaming serveur) via XHR pour recuperer les
 * evenements de progression.
 */
export function useUploader(onEachDone: () => void) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [active, setActive] = useState(false);

  const update = useCallback((id: string, patch: Partial<UploadItem>) => {
    setItems((prev) =>
      prev.map((it) => (it.id === id ? { ...it, ...patch } : it))
    );
  }, []);

  const uploadOne = useCallback(
    (folderId: string, input: UploadInput, id: string) =>
      new Promise<void>((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `/api/nodes/${folderId}/upload`);
        xhr.setRequestHeader(
          "x-file-name",
          encodeURIComponent(input.file.name)
        );
        if (input.relPath) {
          xhr.setRequestHeader("x-rel-path", encodeURIComponent(input.relPath));
        }
        if (input.file.type) {
          xhr.setRequestHeader("Content-Type", input.file.type);
        }
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            update(id, { progress: Math.round((e.loaded / e.total) * 100) });
          }
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            update(id, { status: "done", progress: 100 });
            onEachDone();
          } else {
            let msg = "Echec de l'envoi";
            try {
              msg = JSON.parse(xhr.responseText).error ?? msg;
            } catch {}
            update(id, { status: "error", error: msg });
          }
          resolve();
        };
        xhr.onerror = () => {
          update(id, { status: "error", error: "Erreur réseau" });
          resolve();
        };
        xhr.send(input.file);
      }),
    [update, onEachDone]
  );

  const upload = useCallback(
    async (folderId: string, inputs: UploadInput[]) => {
      if (inputs.length === 0) return;
      const newItems: UploadItem[] = inputs.map((inp, i) => ({
        id: `${Date.now()}-${i}-${Math.random().toString(36).slice(2)}`,
        name: inp.relPath ?? inp.file.name,
        progress: 0,
        status: "uploading",
      }));
      setItems((prev) => [...prev, ...newItems]);
      setActive(true);

      // Envois sequentiels (evite de saturer la bande passante / le disque).
      for (let i = 0; i < inputs.length; i++) {
        await uploadOne(folderId, inputs[i], newItems[i].id);
      }
      setActive(false);
    },
    [uploadOne]
  );

  const clearDone = useCallback(() => {
    setItems((prev) => prev.filter((it) => it.status === "uploading"));
  }, []);

  return { items, active, upload, clearDone };
}

/** Extrait la liste de fichiers d'un drop (avec structure de dossiers si dispo). */
export async function filesFromDataTransfer(
  dt: DataTransfer
): Promise<UploadInput[]> {
  const items = Array.from(dt.items);
  const entries = items
    .map((it) => it.webkitGetAsEntry?.())
    .filter(Boolean) as FileSystemEntry[];

  if (entries.length === 0) {
    // Fallback : pas d'API entry -> fichiers a plat.
    return Array.from(dt.files).map((file) => ({ file }));
  }

  const out: UploadInput[] = [];
  async function walk(entry: FileSystemEntry, prefix: string) {
    if (entry.isFile) {
      const file = await new Promise<File>((res, rej) =>
        (entry as FileSystemFileEntry).file(res, rej)
      );
      const relPath = prefix ? `${prefix}/${file.name}` : undefined;
      out.push({ file, relPath });
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      const children = await new Promise<FileSystemEntry[]>((res) => {
        const acc: FileSystemEntry[] = [];
        const read = () =>
          reader.readEntries((batch) => {
            if (batch.length === 0) return res(acc);
            acc.push(...batch);
            read();
          }, () => res(acc));
        read();
      });
      const newPrefix = prefix ? `${prefix}/${entry.name}` : entry.name;
      for (const child of children) await walk(child, newPrefix);
    }
  }
  for (const entry of entries) await walk(entry, "");
  return out;
}
