// Construye el prompt que se entrega a Claude Code para resolver un ticket.
// Fuente única compartida por el panel admin ("Copiar prompt") y el runner
// headless. Función PURA: no lee BD ni entorno. Portado de TuFacturaIA con el
// ROUTING reescrito a las áreas de empleaIA (lo único específico de cada app).

const TIPO_LABEL: Record<ClaudePromptTicket["tipo"], string> = {
  bug: "Bug",
  mejora: "Mejora",
  pregunta: "Pregunta",
};

export interface ClaudePromptTicket {
  id: string;
  tipo: "bug" | "mejora" | "pregunta";
  descripcion: string;
  pagina: string;
  org_nombre?: string | null;
  user_name?: string | null;
  user_email?: string | null;
  created_at: string;
}

export interface ClaudePromptMessage {
  autor: "admin" | "user";
  cuerpo: string;
  is_ai?: boolean;
}

export interface ClaudePromptInput {
  ticket: ClaudePromptTicket;
  messages?: ClaudePromptMessage[];
  screenshotFilenames?: string[];
  /** Instrucciones extra del administrador (se añaden; no reemplazan el contexto). */
  instruccionesAdmin?: string;
}

/** Nombre de fichero local determinista para cada captura del usuario. En
 *  empleaIA las capturas se guardan como bytes (id sin extensión), así que el
 *  runner las baja siempre como .png. App y runner coinciden en el nombre. */
export function screenshotFilenamesFromPaths(paths: string[]): string[] {
  return paths.map((_p, i) => `feedback-screenshot-${i + 1}.png`);
}

// ── Routing por área → dónde mirar primero (específico de empleaIA) ──────────
interface DocRoute {
  match: RegExp;
  pointer: string;
}
const DOC_ROUTES: DocRoute[] = [
  {
    match: /(grafic|chart|color|paleta|css|dark|modo oscuro|tema|responsive|movil|boton|modal|sidebar|icono|tipograf|fuente|diseno|estetic|consistenc|aline|espaciado|margen|layout|pill|badge|toast)/,
    pointer:
      "UI/visual → componentes en `src/components/ui/*`, sidebar en `src/components/layout/sidebar.tsx`, toasts en `src/components/ui/toast.tsx`. Iconos lucide-react; gating de features con `useFeatures()` / `FeatureGateClient`. Imita el componente vecino, no metas dependencias nuevas.",
  },
  {
    match: /(login|sesion|contrasen|password|permiso|rol |roles|acceso|invitacion|owner|manager|empleado|super.?admin)/,
    pointer:
      "Auth/roles → `src/lib/auth.ts` (NextAuth v5; `authorize` reanida `runWithTenant`). Roles OWNER/MANAGER/EMPLEADO. Panel super-admin en `src/lib/admin/*` (`withSuperAdmin`). Inviolables multi-tenant en `AGENTS.md`.",
  },
  {
    match: /(multi.?tenant|tenant|prisma|schema|withtenant|prismaapp|aislamiento|subdominio|provision)/,
    pointer:
      "Multi-tenant → `AGENTS.md` (reglas inviolables): handlers con `withTenant`, pages con `withTenantPage`, `prismaApp` (Proxy por tenant) vs `prismaMaster`, schema-per-tenant `tenant_<slug>`, regla ESLint `no-legacy-prisma`. NUNCA `fetch` interno entre rutas.",
  },
  {
    match: /(fichaj|fichar|entrada|salida|pausa|geofenc|rd 8|jornada|presencia)/,
    pointer:
      "Fichajes → `src/app/api/fichajes/*`, cálculo de horas en `src/lib/informes/*`. RD 8/2019 (el OWNER siempre puede consultar). Solicitudes/corrección de fichaje en `src/lib/solicitudes-fichaje/*`.",
  },
  {
    match: /(turno|cuadrante|horario|sede|tienda|centro)/,
    pointer:
      "Turnos/sedes → modelo `Turno`/`TipoTurno` y `src/app/api/turnos/*`; horarios de sede en `src/components/admin/sede-horarios-dialog.tsx` + `/api/tiendas/[id]/horarios`. Aviso de olvido de fichaje en `src/lib/worker/jobs/recordatorio-fichaje.ts`.",
  },
  {
    match: /(ausenci|vacacion|baja|permiso retribuido|aprobar ausencia)/,
    pointer: "Ausencias → `src/app/api/ausencias/*` + `src/lib/ausencias/*` (notificaciones).",
  },
  {
    match: /(nomina|prenomina|salario|retencion|cotizac|sage|a3|export)/,
    pointer:
      "Nóminas → `src/app/api/nominas/*` y `/api/prenomina/*`; lógica en `src/lib/prenomina/*` (exporters Sage/A3). Envío de nóminas: modelo `NominaArchivo`.",
  },
  {
    match: /(documento|archivo|carpeta|adjunt|firma|fichero)/,
    pointer:
      "Documentos/Archivos → `src/app/api/documentos/*` (tipos de carpeta gestionables, modelo `TipoDocumento`); firma electrónica en `src/app/api/face|firma`.",
  },
  {
    match: /(stripe|pago|suscripcion|plan|facturacion|checkout|cuota|seat|webhook)/,
    pointer:
      "Billing → `src/lib/stripe/*` + `src/lib/billing/*`; webhook en `src/app/api/webhooks/stripe`. Features/límites por plan en `src/lib/feature-guard/*` y `src/lib/tenant/features.ts`.",
  },
  {
    match: /(informe|reporte|csv|excel|pdf|estadistic|horas por centro)/,
    pointer: "Informes → `src/app/api/informes/*` + `src/lib/informes/*` (queries puras + generators CSV/Excel/PDF).",
  },
  {
    match: /(notificac|email|correo|aviso|recordatorio|push|telegram|whatsapp)/,
    pointer:
      "Notificaciones → `src/lib/notificaciones.ts` (in-app + email + push), email vía `src/lib/email.ts` (`sendSystemEmail`). Crons de plataforma en `src/app/api/cron/*`.",
  },
];

function normalize(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

function buildRouting(t: ClaudePromptTicket): string[] {
  const hay = normalize(`${t.pagina} ${t.descripcion}`);
  const pointers: string[] = [];
  for (const r of DOC_ROUTES) {
    if (r.match.test(hay) && !pointers.includes(r.pointer)) pointers.push(r.pointer);
    if (pointers.length >= 4) break;
  }
  return pointers;
}

function taskGuidance(tipo: ClaudePromptTicket["tipo"]): string[] {
  if (tipo === "pregunta") {
    return [
      "- Es una PREGUNTA: normalmente NO requiere cambio de código. Responde con un diagnóstico claro y deja el worktree limpio, sin abrir PR.",
      "- Solo toca código si encuentras un fallo objetivo y reproducible detrás de la pregunta.",
    ];
  }
  if (tipo === "mejora") {
    return [
      "- Es una MEJORA (a menudo UI/UX): respeta los componentes existentes — imita el fichero vecino, no introduzcas dependencias ni patrones nuevos.",
      "- Si la mejora es quirúrgica y de bajo riesgo, aplícala y abre un PR (nunca merges).",
      "- Si es subjetiva o de alcance amplio, NO toques código: explica el enfoque en el bloque [RESUMEN] y termina SIN cambios para que el equipo confirme.",
    ];
  }
  return [
    "- Es un BUG: reproduce o localiza la causa RAÍZ con evidencia (grep + lectura) antes de proponer nada. Arregla el origen, no el síntoma. Si das con el fix, aplícalo y abre un PR (nunca merges).",
  ];
}

export function buildClaudePrompt(input: ClaudePromptInput): string {
  const { ticket: t, messages, screenshotFilenames, instruccionesAdmin } = input;
  const fecha = new Date(t.created_at).toLocaleDateString("es-ES");
  const lines = [
    `Ticket de soporte empleaIA — ${TIPO_LABEL[t.tipo]}`,
    `Empresa: ${t.org_nombre || "—"} · Usuario: ${t.user_name || t.user_email || "—"} · Fecha: ${fecha}`,
    `Página donde ocurrió: ${t.pagina}`,
    `ID: ${t.id}`,
    "",
    "Descripción del usuario:",
    '"""',
    t.descripcion,
    '"""',
  ];
  if (screenshotFilenames && screenshotFilenames.length > 0) {
    lines.push("", `Capturas adjuntas por el usuario (léelas con Read): ${screenshotFilenames.join(", ")}`);
  }
  if (messages && messages.length > 0) {
    lines.push("", "Conversación posterior:");
    for (const m of messages) {
      const quien = m.is_ai ? "Claude (intento previo)" : m.autor === "admin" ? "Equipo" : "Usuario";
      lines.push(`- ${quien}: ${m.cuerpo}`);
    }
  }
  if (instruccionesAdmin?.trim()) {
    lines.push(
      "",
      "Instrucciones del administrador (PRIORITARIAS — tenlas en cuenta sobre el resto):",
      '"""',
      instruccionesAdmin.trim(),
      '"""',
    );
  }

  const routing = buildRouting(t);
  if (routing.length > 0) {
    lines.push("", "Dónde mirar primero (acude a la fuente correcta antes de tocar código):");
    for (const p of routing) lines.push(`- ${p}`);
  }

  lines.push(
    "",
    "Tarea:",
    "- Trabaja en el repositorio del directorio actual (Next.js 16 App Router + Prisma multi-tenant por schema). Lee `CLAUDE.md` y `AGENTS.md`: las reglas inviolables (withTenant/withTenantPage, prismaApp vs prismaMaster, no-legacy-prisma, NO fetch interno entre rutas) son de obligado cumplimiento.",
    ...taskGuidance(t.tipo),
    "- Mantén el cambio quirúrgico: solo lo que pide este ticket, nada de refactors ni features extra.",
    "- AUDITA tu propio trabajo ANTES de entregar: relee el diff completo, confirma que atacas la causa raíz (no el síntoma), que no rompes los inviolables y que `npm run lint && npm run typecheck && npm run build` pasan limpios. Si la auditoría revela un problema, corrígelo antes de abrir el PR.",
    '- Si tu cambio es visible en la interfaz, deja una captura del resultado ("después") en `feedback-after.png` en la raíz del repo: el sistema la adjuntará al resumen del cliente.',
    "",
    "Formato de salida (OBLIGATORIO) — termina SIEMPRE con estos dos bloques, cada etiqueta en su propia línea:",
    "[DIAGNÓSTICO]",
    "Para el equipo (técnico, NO se muestra al cliente): causa raíz, qué cambiaste y por qué, archivos tocados, riesgos y el resultado de tu auditoría.",
    "[RESUMEN]",
    "Para el cliente final: trato de tú, cercano y sin jerga técnica. En 2-4 frases cuenta qué pasaba y cómo queda ahora. Si no hubo cambios de código, explica con claridad la respuesta a su caso.",
    "",
    "- Pre-commit: npm run lint && npm run typecheck && npm run build.",
  );
  return lines.join("\n");
}
