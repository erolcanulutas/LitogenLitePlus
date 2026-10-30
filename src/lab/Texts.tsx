import { useEffect, useMemo, useState } from "react";
import { LANGUAGES, translation, type Lang } from "../i18n";
import { HOME_TEXTS } from "./homeTexts";

type Texts = Record<string, Record<string, string>>;

async function api(body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch("/api/lab.php", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Litogen": "1" },
    body: JSON.stringify(body),
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({ ok: false, error: "The server did not answer properly" }));
  if (!data.ok) throw new Error(String(data.error ?? "Something went wrong"));
  return data;
}

/**
 * The home page's words, in every language: each is listed with what it says
 * now, and whatever is typed over it replaces it on the page. Emptying a box
 * puts the built-in text back.
 */
export default function Texts() {
  const [saved, setSaved] = useState<Texts>({});
  const [edited, setEdited] = useState<Texts>({});
  const [query, setQuery] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    api({ action: "texts" })
      .then((d) => {
        const t = (Array.isArray(d.texts) ? {} : d.texts) as Texts;
        setSaved(t);
        setEdited(JSON.parse(JSON.stringify(t)));
      })
      .catch(() => {});
  }, []);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? HOME_TEXTS.filter((k) => k.toLowerCase().includes(q) || Object.values(edited).some((m) => m[k]?.toLowerCase().includes(q))) : HOME_TEXTS;
  }, [query, edited]);

  const value = (lang: Lang, key: string) => edited[lang]?.[key] ?? "";
  const set = (lang: Lang, key: string, v: string) =>
    setEdited((cur) => {
      const next = { ...cur, [lang]: { ...(cur[lang] ?? {}) } };
      if (v === "") delete next[lang][key];
      else next[lang][key] = v;
      return next;
    });

  const changed = JSON.stringify(edited) !== JSON.stringify(saved);

  const save = async () => {
    try {
      const d = await api({ action: "save_texts", texts: edited });
      const t = (Array.isArray(d.texts) ? {} : d.texts) as Texts;
      setSaved(t);
      setEdited(JSON.parse(JSON.stringify(t)));
      setNote("Saved. The home page uses these now.");
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Could not save");
    }
  };

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ fontSize: 18, fontWeight: 600 }}>Home page texts</div>
      <div style={{ fontSize: 13, opacity: 0.75 }}>
        Type over a text to change it, in any language; the grey text is what it says now. Leave a box empty to keep the built-in text.
        Words like {"{n}"} in a text are filled in by the page, so keep them.
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", position: "sticky", top: 0, background: "#0b1220", padding: "6px 0", zIndex: 2 }}>
        <input className="spinInput" placeholder="Search the texts" value={query} onChange={(e) => setQuery(e.target.value)} style={{ maxWidth: 320 }} />
        <button className="btn" style={{ fontWeight: 700 }} disabled={!changed} onClick={save}>Save all</button>
        {note && <span style={{ fontSize: 13, color: "#86efac" }}>{note}</span>}
      </div>

      {shown.map((key) => (
        <div key={key} style={{ border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, padding: 10, display: "grid", gap: 6 }}>
          {LANGUAGES.map((l) => (
            <label key={l.id} style={{ display: "grid", gridTemplateColumns: "70px 1fr", gap: 8, alignItems: "start", fontSize: 12 }}>
              <span style={{ opacity: 0.7, paddingTop: 6 }}>{l.name}</span>
              <textarea
                className="spinInput"
                rows={key.length > 90 ? 3 : 1}
                value={value(l.id, key)}
                placeholder={translation(l.id, key)}
                onChange={(e) => set(l.id, key, e.target.value)}
                style={{ resize: "vertical", fontFamily: "inherit" }}
              />
            </label>
          ))}
        </div>
      ))}
    </div>
  );
}
