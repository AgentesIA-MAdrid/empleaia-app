/**
 * Cliente mínimo de la API de GitHub para revisar y mergear PRs desde el bot
 * de Telegram. Token en env `GITHUB_MERGE_TOKEN` (PAT fine-grained con
 * Contents R/W + Pull requests R/W sobre el repo; NO es el del runner, que no
 * tiene permiso de merge por diseño).
 *
 * Best-effort: si falta el token o la API falla, devuelve error legible.
 */

const API = "https://api.github.com";

function token(): string | null {
  return process.env.GITHUB_MERGE_TOKEN ?? null;
}

/** Extrae {owner, repo, number} de una URL de PR de GitHub. */
export function parsePrUrl(url: string | null | undefined): { owner: string; repo: string; number: number } | null {
  if (!url) return null;
  const m = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(url);
  if (!m) return null;
  return { owner: m[1], repo: m[2], number: Number(m[3]) };
}

async function gh(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; json: unknown }> {
  const t = token();
  if (!t) return { ok: false, status: 0, json: { message: "GITHUB_MERGE_TOKEN no definido" } };
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${t}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

export interface PrInfo {
  title: string;
  state: string;
  draft: boolean;
  merged: boolean;
  mergeable: boolean | null;
  additions: number;
  deletions: number;
  changedFiles: number;
  files: { filename: string; additions: number; deletions: number; status: string }[];
  headRef: string;
}

/** Lee estado + estadísticas + lista de archivos del PR. */
export async function getPrInfo(prUrl: string): Promise<{ ok: true; info: PrInfo } | { ok: false; error: string }> {
  const p = parsePrUrl(prUrl);
  if (!p) return { ok: false, error: "URL de PR no válida" };
  const pr = await gh(`/repos/${p.owner}/${p.repo}/pulls/${p.number}`);
  if (!pr.ok) return { ok: false, error: `No se pudo leer el PR (HTTP ${pr.status})` };
  const d = pr.json as Record<string, unknown>;
  const filesRes = await gh(`/repos/${p.owner}/${p.repo}/pulls/${p.number}/files?per_page=100`);
  const files = (filesRes.ok && Array.isArray(filesRes.json) ? filesRes.json : []) as Record<string, unknown>[];
  return {
    ok: true,
    info: {
      title: String(d.title ?? ""),
      state: String(d.state ?? ""),
      draft: Boolean(d.draft),
      merged: Boolean(d.merged),
      mergeable: typeof d.mergeable === "boolean" ? d.mergeable : null,
      additions: Number(d.additions ?? 0),
      deletions: Number(d.deletions ?? 0),
      changedFiles: Number(d.changed_files ?? 0),
      headRef: String((d.head as Record<string, unknown> | undefined)?.ref ?? ""),
      files: files.map((f) => ({
        filename: String(f.filename ?? ""),
        additions: Number(f.additions ?? 0),
        deletions: Number(f.deletions ?? 0),
        status: String(f.status ?? ""),
      })),
    },
  };
}

/** Mergea el PR (squash) y borra la rama. */
export async function mergePr(prUrl: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const p = parsePrUrl(prUrl);
  if (!p) return { ok: false, error: "URL de PR no válida" };
  const res = await gh(`/repos/${p.owner}/${p.repo}/pulls/${p.number}/merge`, {
    method: "PUT",
    body: JSON.stringify({ merge_method: "squash" }),
  });
  if (!res.ok) {
    const msg = (res.json as Record<string, unknown>)?.message;
    const detalle =
      res.status === 405 ? "el PR no es mergeable (¿conflictos o checks pendientes?)" :
      res.status === 409 ? "la rama cambió; recarga y reintenta" :
      res.status === 401 || res.status === 403 ? "el token no tiene permiso de merge" :
      String(msg ?? `HTTP ${res.status}`);
    return { ok: false, error: detalle };
  }
  // Borrar la rama (best-effort; si falla, no es crítico).
  const info = await gh(`/repos/${p.owner}/${p.repo}/pulls/${p.number}`);
  const headRef = (info.json as Record<string, unknown>)?.head as Record<string, unknown> | undefined;
  const ref = headRef?.ref ? String(headRef.ref) : null;
  if (ref) await gh(`/repos/${p.owner}/${p.repo}/git/refs/heads/${ref}`, { method: "DELETE" }).catch(() => {});
  return { ok: true };
}
