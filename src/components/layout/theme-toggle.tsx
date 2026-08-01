"use client";

import { useSyncExternalStore } from "react";

type Theme = "light" | "dark";

/** Misma clave que lee el layout del servidor. Va en COOKIE, no en
 *  localStorage: así el servidor puede pintar el tema en el <html> desde el
 *  primer byte y no hace falta ningún script que lo corrija después. */
const COOKIE = "empleaia-theme";

/**
 * El tema vive en el atributo data-theme del <html>: ese atributo ES la fuente
 * de verdad, no un estado de React. Por eso se lee con useSyncExternalStore en
 * vez de copiarlo a un useState desde un efecto — así no hay estado duplicado,
 * ni setState dentro de un efecto, y el servidor puede renderizar "light" sin
 * provocar un desajuste de hidratación.
 */
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  return () => observer.disconnect();
}

function getSnapshot(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

/** En el servidor no hay DOM: se asume claro y el script del <head> corrige
 *  antes del primer pintado. */
function getServerSnapshot(): Theme {
  return "light";
}

/**
 * Conmutador claro/oscuro.
 *
 * El color de marca NO cambia con el tema: lo pone cada empresa cliente
 * (colorPrimario del tenant). Aquí solo cambian superficies y texto.
 */
export function ThemeToggle({ collapsed = false }: { collapsed?: boolean }) {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const isDark = theme === "dark";

  function toggle() {
    const next: Theme = isDark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    // Un año, para todo el sitio. samesite=lax basta: no es un dato sensible
    // y así viaja en la navegación normal.
    document.cookie = `${COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? "Cambiar a tema claro" : "Cambiar a tema oscuro"}
      title={collapsed ? (isDark ? "Tema claro" : "Tema oscuro") : undefined}
      className="group flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-[var(--text-body)] transition-colors hover:bg-[var(--sidebar-hover-bg)]"
    >
      {isDark ? (
        <svg className="size-[18px] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
          />
        </svg>
      ) : (
        <svg className="size-[18px] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
          />
        </svg>
      )}
      {!collapsed && <span className="flex-1 text-left">{isDark ? "Tema claro" : "Tema oscuro"}</span>}
    </button>
  );
}
