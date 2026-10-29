import { useSyncExternalStore } from "react";
import { de } from "./locales/de";
import { es } from "./locales/es";
import { fr } from "./locales/fr";
import { tr } from "./locales/tr";

export type Lang = "en" | "tr" | "de" | "es" | "fr";

export const LANGUAGES: { id: Lang; name: string }[] = [
  { id: "en", name: "English" },
  { id: "tr", name: "Türkçe" },
  { id: "de", name: "Deutsch" },
  { id: "es", name: "Español" },
  { id: "fr", name: "Français" },
];

/** The English text is the key; a language that lacks a line shows the English. */
const DICTIONARIES: Record<Exclude<Lang, "en">, Record<string, string>> = { tr, de, es, fr };

const STORAGE_KEY = "litogen.lang";

function detect(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && LANGUAGES.some((l) => l.id === saved)) return saved as Lang;
  } catch {
    /* storage may be blocked */
  }
  const wanted = (typeof navigator !== "undefined" ? navigator.language : "en").slice(0, 2).toLowerCase();
  return LANGUAGES.find((l) => l.id === wanted)?.id ?? "en";
}

let current: Lang = detect();
const listeners = new Set<() => void>();
if (typeof document !== "undefined") document.documentElement.lang = current;

export function getLang(): Lang {
  return current;
}

export function setLang(lang: Lang) {
  if (lang === current) return;
  current = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* storage may be blocked */
  }
  if (typeof document !== "undefined") document.documentElement.lang = lang;
  listeners.forEach((fn) => fn());
}

/** Re-renders the component when the language changes. */
export function useLang(): Lang {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => current,
  );
}

/** Turns English source text into the language in use; `{name}` is filled from `vars`. */
export function t(source: string, vars?: Record<string, string | number>): string {
  const text = (current === "en" ? undefined : DICTIONARIES[current][source]) ?? source;
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}
