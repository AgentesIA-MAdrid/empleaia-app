import { z } from "zod";

// Payload de creación de un ticket de feedback (cliente). `screenshot_paths`
// aquí son ids de FeedbackAdjunto ya subidos (ver screenshot-storage.ts).
export const feedbackSubmitSchema = z.object({
  tipo: z.enum(["bug", "mejora", "pregunta"]),
  descripcion: z.string().min(1, "La descripción es requerida").max(2000),
  pagina: z.string().max(500),
  screenshot_paths: z.array(z.string()).max(5).optional(),
});

export type FeedbackSubmitInput = z.infer<typeof feedbackSubmitSchema>;
