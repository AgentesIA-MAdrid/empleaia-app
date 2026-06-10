/**
 * Chat — ruta compartida por todos los roles (OWNER, MANAGER, EMPLEADO).
 *
 * Va sin prefijo de rol a propósito: el proxy solo gatea /admin y
 * /manager, así que /chat es accesible por cualquier usuario con sesión.
 * Antes el enlace del sidebar apuntaba a /admin/chat y el proxy rebotaba
 * a empleados y managers a su home (el reloj).
 */

import { ChatApp } from "@/components/chat/chat-app";

export default function ChatPage() {
  return <ChatApp />;
}
