/**
 * /admin/chat — se mantiene por compatibilidad con enlaces antiguos.
 * El chat real vive en /chat (compartido por todos los roles). El
 * sidebar ya apunta a /chat; aquí solo redirigimos.
 */

import { redirect } from "next/navigation";

export default function AdminChatRedirect() {
  redirect("/chat");
}
