/**
 * Renderer de Markdown ligero y SIN dependencias (evita añadir react-markdown
 * y su árbol, que engorda el build del contenedor).
 *
 * Seguro por construcción: produce nodos React (el texto se escapa solo, no
 * hay `dangerouslySetInnerHTML`), así que sirve para contenido de cualquier
 * autor (Claude, equipo y también el cliente). Los enlaces se validan a
 * http/https/mailto; cualquier otro protocolo (javascript:, data:) se pinta
 * como texto plano.
 *
 * Subconjunto soportado: encabezados (#..######), **negrita**, *cursiva* / _cursiva_,
 * `código inline`, bloques ```código```, listas (-, *, 1.), citas (>),
 * enlaces [texto](url), párrafos y saltos de línea.
 */
import { Fragment, type ReactNode } from "react";

const SAFE_LINK = /^(https?:\/\/|mailto:)/i;

// ---- Inline: **negrita**, *cursiva*, `code`, [texto](url) ------------------
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  // Orden importa: code primero (no se re-parsea su interior), luego enlaces,
  // luego negrita, luego cursiva.
  const re =
    /(`[^`]+`)|(\[[^\]]+\]\([^)]+\))|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(_[^_]+_)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const tok = m[0];
    const key = `${keyPrefix}-${i++}`;
    if (tok.startsWith("`")) {
      nodes.push(
        <code key={key} className="rounded bg-slate-200/70 px-1 py-0.5 font-mono text-[0.85em]">
          {tok.slice(1, -1)}
        </code>,
      );
    } else if (tok.startsWith("[")) {
      const mm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok)!;
      const label = mm[1];
      const href = mm[2].trim();
      if (SAFE_LINK.test(href)) {
        nodes.push(
          <a key={key} href={href} target="_blank" rel="noopener noreferrer" className="text-[var(--primary,#4f46e5)] underline underline-offset-2">
            {label}
          </a>,
        );
      } else {
        nodes.push(label);
      }
    } else if (tok.startsWith("**")) {
      nodes.push(<strong key={key} className="font-semibold">{tok.slice(2, -2)}</strong>);
    } else {
      // *cursiva* o _cursiva_
      nodes.push(<em key={key}>{tok.slice(1, -1)}</em>);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

const HEADING_SIZE = ["text-lg", "text-base", "text-sm", "text-sm", "text-sm", "text-sm"];

export function Markdown({ children, className }: { children: string; className?: string }) {
  const src = (children ?? "").replace(/\r\n/g, "\n");
  const lines = src.split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Bloque de código ```…```
    if (/^```/.test(line.trim())) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        buf.push(lines[i]);
        i++;
      }
      i++; // cierre ```
      blocks.push(
        <pre key={key++} className="my-1.5 overflow-x-auto rounded-md bg-slate-800 p-2.5 text-xs text-slate-100">
          <code className="font-mono">{buf.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    // Línea en blanco → separador
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Encabezado
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      blocks.push(
        <p key={key++} className={`mt-2 mb-0.5 font-semibold ${HEADING_SIZE[level - 1]}`}>
          {renderInline(h[2], `h${key}`)}
        </p>,
      );
      i++;
      continue;
    }

    // Cita >
    if (/^>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      blocks.push(
        <blockquote key={key++} className="my-1.5 border-l-2 border-[var(--border-strong)] pl-3 text-[var(--text-muted)]">
          {renderInline(buf.join(" "), `q${key}`)}
        </blockquote>,
      );
      continue;
    }

    // Lista (viñetas u ordenada)
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items: ReactNode[] = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        const content = lines[i].replace(/^\s*([-*]|\d+\.)\s+/, "");
        items.push(<li key={items.length}>{renderInline(content, `li${key}-${items.length}`)}</li>);
        i++;
      }
      const cls = "my-1.5 space-y-0.5 pl-5 " + (ordered ? "list-decimal" : "list-disc");
      blocks.push(
        ordered
          ? <ol key={key++} className={cls}>{items}</ol>
          : <ul key={key++} className={cls}>{items}</ul>,
      );
      continue;
    }

    // Párrafo: junta líneas consecutivas hasta blanco / bloque especial
    const buf: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^```/.test(lines[i].trim()) &&
      !/^(#{1,6})\s+/.test(lines[i]) &&
      !/^>\s?/.test(lines[i]) &&
      !/^\s*([-*]|\d+\.)\s+/.test(lines[i])
    ) {
      buf.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={key++} className="my-1 leading-relaxed">
        {buf.map((l, idx) => (
          <Fragment key={idx}>
            {idx > 0 && <br />}
            {renderInline(l, `p${key}-${idx}`)}
          </Fragment>
        ))}
      </p>,
    );
  }

  return <div className={className}>{blocks}</div>;
}
