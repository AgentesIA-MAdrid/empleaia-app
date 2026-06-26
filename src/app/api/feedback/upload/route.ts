import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { withTenant } from "@/lib/tenant/with-tenant";
import { uploadScreenshot, FeedbackScreenshotError } from "@/lib/feedback/screenshot-storage";

// POST /api/feedback/upload — sube una captura (multipart). Devuelve { path },
// que es el id del FeedbackAdjunto a referenciar al crear el ticket.
export const POST = withTenant(async (req: NextRequest) => {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Se esperaba multipart/form-data" }, { status: 400 });
  }
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: 'Falta el archivo (campo "file")' }, { status: 400 });

  try {
    const { path } = await uploadScreenshot(file);
    return NextResponse.json({ path }, { status: 201 });
  } catch (err) {
    if (err instanceof FeedbackScreenshotError) {
      const status = err.code === "too_large" ? 413 : err.code === "mime_not_allowed" ? 415 : 500;
      return NextResponse.json({ error: err.message }, { status });
    }
    throw err;
  }
});
