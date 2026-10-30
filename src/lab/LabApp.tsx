import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BRAND_STYLE } from "../App";
import { signIn, signOut, whoAmI, type Account } from "../core/account";
import { bendRadius } from "../core/bend";
import type { DecorGeom, Decoration } from "../core/decor";
import { PICTURE_SEAT_MM, assembleHolder, holderInPlace, holderLayout, legSpacingFor } from "../core/holder";
import { shapeOutline, type OutlineShape } from "../core/outline";
import { buildStand } from "../core/stand";
import { writeBinarySTL } from "../core/stl_writer";
import { captureTemplate, layTemplate, type TemplateItem } from "../core/templates";
import DecorProps from "../ui/DecorProps";
import HolderDesigner from "../ui/HolderDesigner";
import IconPalette from "../ui/IconPalette";
import { makeDecor } from "../ui/decorIcons";
import { SHOWCASE_MODELS } from "../ui/homeContent";
import type { PreviewMesh } from "../ui/MeshPreview";

const MeshPreview = React.lazy(() => import("../ui/MeshPreview"));

/** The temporary home page lab: models, pictures and templates for the front page. */

const SLOTS = 12;
const HEADERS = { "Content-Type": "application/json", "X-Litogen": "1" };

type Shape = "rectangle" | OutlineShape;
type Settings = {
  shape: Shape;
  widthMm: number;
  heightMm: number;
  curveDeg: number;
  border: number;
  angle: number;
  /** Radius of the outer corners, in mm; only a rectangle has any. */
  corner: number;
  /** The frame's colour, as #rrggbb. */
  color: string;
  /** Print the decorations in their own colours, up to this many; 0 prints them in the frame's. */
  iconColours: number;
  /** The tealight the stand takes, in mm. */
  tealight: number;
  /** How far the icons stand out, in mm. */
  relief: number;
  /** Room between the stand and the legs, in mm. */
  fit: number;
  /** Room round the picture in its pocket, each side, in mm. */
  play: number;
  /** Room round a flush icon in its recess, in mm. */
  flushClear: number;
  /** Whether the model turns by itself on the home page. */
  rotate: boolean;
  /** Left off the home page without being deleted. */
  hidden: boolean;
  caption: string;
};
const DEFAULTS: Settings = { shape: "rectangle", widthMm: 90, heightMm: 70, curveDeg: 0, border: 10, angle: 85, corner: 0, color: "#d9b77a", iconColours: 0, tealight: 38, relief: 1, fit: 0.2, play: 0.05, flushClear: 0, rotate: true, hidden: false, caption: "" };

type ModelEntry = { slot: number; file: string; caption: string; updated: string; color?: string };
type TemplateEntry = { id: string; name: string; items: TemplateItem[]; updated: string };

type Area = { kind: "slot"; n: number } | { kind: "templates" } | { kind: "photos" };

async function api(body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch("/api/lab.php", {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify(body),
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({ ok: false, error: "The server did not answer properly" }));
  if (!data.ok) throw new Error(String(data.error ?? "Something went wrong"));
  return data;
}

function heightFor(shape: Shape, w: number, h: number): number {
  if (shape === "rectangle") return h;
  if (shape === "circle") return w;
  if (shape === "hexagon" || shape === "triangle") return (w * Math.sqrt(3)) / 2;
  return (w * (1 + Math.cos(Math.PI / 5))) / (2 * Math.cos(Math.PI / 10));
}

function toBase64(buf: ArrayBuffer): string {
  let s = "";
  const u = new Uint8Array(buf);
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}

const cell: React.CSSProperties = { display: "grid", gap: 4, fontSize: 12 };

export default function LabApp() {
  const [account, setAccount] = useState<Account | null>(null);
  const [known, setKnown] = useState(false);
  const [admin, setAdmin] = useState<boolean | null>(null);
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [authError, setAuthError] = useState("");

  const [area, setArea] = useState<Area>({ kind: "slot", n: 1 });
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [templates, setTemplates] = useState<TemplateEntry[]>([]);
  const [note, setNote] = useState("");

  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [decorations, setDecorationsRaw] = useState<Decoration[]>([]);
  const current = useRef<Decoration[]>([]);
  current.current = decorations;
  const past = useRef<Decoration[][]>([]);
  const future = useRef<Decoration[][]>([]);
  const [historyTick, setHistoryTick] = useState(0);
  /** Every change goes through here, so it can be undone. */
  const setDecorations = useCallback((next: Decoration[] | ((cur: Decoration[]) => Decoration[])) => {
    const value = typeof next === "function" ? next(current.current) : next;
    past.current = [...past.current.slice(-99), current.current];
    future.current = [];
    setDecorationsRaw(value);
    setHistoryTick((n) => n + 1);
  }, []);
  /** A different set altogether, such as a card being opened: no step back into the last one. */
  const replaceDecorations = useCallback((value: Decoration[]) => {
    past.current = [];
    future.current = [];
    setDecorationsRaw(value);
    setHistoryTick((n) => n + 1);
  }, []);
  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev) return;
    future.current.push(current.current);
    setDecorationsRaw(prev);
    setHistoryTick((n) => n + 1);
  }, []);
  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(current.current);
    setDecorationsRaw(next);
    setHistoryTick((n) => n + 1);
  }, []);
  const [selected, setSelected] = useState<number | null>(null);
  const [templateName, setTemplateName] = useState("");
  const [busy, setBusy] = useState(false);
  const [pasteText, setPasteText] = useState("");

  useEffect(() => {
    document.title = "Litogen lab";
    document.documentElement.dataset.theme = "dark";
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex";
    document.head.appendChild(meta);
    whoAmI().then((a) => {
      setAccount(a);
      setKnown(true);
    });
    return () => meta.remove();
  }, []);

  const refresh = useCallback(async () => {
    try {
      const d = await api({ action: "list" });
      setModels((d.models as ModelEntry[]) ?? []);
      setTemplates((d.templates as TemplateEntry[]) ?? []);
      setAdmin(true);
    } catch (e) {
      setAdmin(false);
      setNote(e instanceof Error ? e.message : "");
    }
  }, []);

  useEffect(() => {
    if (account) void refresh();
  }, [account, refresh]);

  // -- the frame, built the way the studio builds it --------------------------
  const height = heightFor(settings.shape, settings.widthMm, settings.heightMm);
  const outline = useMemo(
    () => (settings.shape === "rectangle" ? null : shapeOutline(settings.shape, settings.widthMm, height)),
    [settings.shape, settings.widthMm, height],
  );
  const pictureRadius = settings.curveDeg > 0 ? bendRadius(settings.widthMm, settings.curveDeg) : 0;
  const frameRadius = pictureRadius > PICTURE_SEAT_MM + 5 ? pictureRadius - PICTURE_SEAT_MM : 0;

  const base = useMemo(() => {
    const b = {
      pictureW: frameRadius > 0 ? settings.widthMm * (frameRadius / pictureRadius) : settings.widthMm,
      pictureH: height,
      pictureT: 3,
      border: settings.border,
      lip: Math.min(4, Math.max(2, +(settings.border * 0.3).toFixed(1))),
      fit: settings.fit,
      pocketPlay: settings.play,
      tiltDeg: 90 - settings.angle,
      corner: settings.corner,
      outline,
      bend: frameRadius,
    };
    let lean = b.tiltDeg;
    if (frameRadius > 0) while (lean > 0 && !holderLayout({ ...b, tiltDeg: lean }).shearOk) lean -= 1;
    return { ...b, tiltDeg: lean };
  }, [settings.widthMm, settings.border, settings.angle, settings.corner, settings.fit, settings.play, height, outline, frameRadius, pictureRadius]);

  const spacing = useMemo(() => legSpacingFor(outline, base), [outline, base]);
  const params = useMemo(() => ({ ...base, prongSpacing: spacing }), [base, spacing]);
  const L = useMemo(() => holderLayout(params), [params]);

  const geom = useMemo<DecorGeom>(
    () => ({
      W: L.W, H: L.H, corner: L.corner, window: L.window, pocket: L.pocket, rail: L.rail,
      frontZ: L.T, lip: L.T - L.pocketDepth, poly: L.poly,
      squeeze: L.bend > 0 ? L.bend / (L.bend + L.T) : 1,
    }),
    [L],
  );

  const [decor, setDecor] = useState<Awaited<ReturnType<typeof makeDecor>> | null>(null);
  useEffect(() => {
    let live = true;
    if (decorations.length === 0) {
      setDecor(null);
      return;
    }
    const timer = setTimeout(() => {
      makeDecor(decorations, geom, settings.relief, { mode: "flat", colours: settings.iconColours, palette: [] }, settings.flushClear)
        .then((d) => live && setDecor(d))
        .catch(() => live && setDecor(null));
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [decorations, geom, settings.iconColours, settings.relief, settings.flushClear]);

  const built = useMemo(() => {
    const a = assembleHolder(params, decor?.cuts ?? [], decor?.recess ?? null, decor?.relief ?? null);
    // The frame, then each colour of the decorations, then the stand.
    const starts = [0, ...a.bodies.map((b) => b.start), a.mesh.triangleCount];
    const colours = [settings.color, ...a.bodies.map((b) => b.color || settings.color), settings.color];
    const placed = holderInPlace(a.mesh, params.tiltDeg, L.socketDepth, L.W / 2);
    const stand = buildStand({ tealight: settings.tealight, prongSpacing: spacing });
    const positions = new Float32Array(placed.positions.length + stand.positions.length);
    positions.set(placed.positions, 0);
    positions.set(stand.positions, placed.positions.length);
    const tilt = (params.tiltDeg * Math.PI) / 180;
    const mesh: PreviewMesh = {
      positions,
      triangleCount: placed.triangleCount + stand.triangleCount,
      bandStarts: starts,
      colors: colours,
      faceAxis: [0, Math.cos(tilt), Math.sin(tilt)],
    };
    return mesh;
  }, [params, decor, L.socketDepth, L.W, spacing, settings.color, settings.tealight]);

  // -- decorations ------------------------------------------------------------
  const add = (d: Decoration) => {
    setDecorations((cur) => [...cur, d]);
    setSelected(decorations.length);
  };
  const topY = (L.window.y1 + L.H) / 2;
  const addIcon = (icon: string) =>
    add({ icon, x: L.W / 2, y: topY, size: Math.max(8, Math.min(20, (L.H - L.window.y1) * 1.6)), rotation: 0 });
  const addText = () =>
    add({ icon: "", text: "Text", font: "sans", bold: true, color: "#1f2937", x: L.W / 2, y: topY, size: 7, rotation: 0 });
  const patch = (change: Partial<Decoration>) => {
    if (selected === null) return;
    setDecorations((cur) => cur.map((d, i) => (i === selected ? { ...d, ...change } : d)));
  };
  const align = (to: "centreX" | "centreY" | "top" | "bottom") =>
    patch(
      to === "centreX" ? { x: L.W / 2 } : to === "centreY" ? { y: L.H / 2 } : to === "top" ? { y: topY } : { y: L.rail / 2 + 0.5 },
    );
  const order = (by: 1 | -1) => {
    if (selected === null) return;
    const to = selected + by;
    if (to < 0 || to >= decorations.length) return;
    const next = decorations.slice();
    [next[selected], next[to]] = [next[to], next[selected]];
    setDecorations(next);
    setSelected(to);
  };

  // -- opening an area -------------------------------------------------------
  const openArea = async (next: Area) => {
    setArea(next);
    setNote("");
    setSelected(null);
    if (next.kind === "slot") {
      try {
        const d = (await api({ action: "design", slot: next.n })).design as { settings?: Settings; decorations?: Decoration[] } | null;
        if (d?.settings) setSettings({ ...DEFAULTS, ...d.settings });
        else setSettings({ ...DEFAULTS, caption: models.find((m) => m.slot === next.n)?.caption || SHOWCASE_MODELS[next.n - 1]?.caption || "" });
        replaceDecorations(d?.decorations ?? []);
      } catch {
        replaceDecorations([]);
      }
    } else if (next.kind === "templates") {
      setSettings(DEFAULTS);
      replaceDecorations([]);
    }
  };

  const saveModel = async () => {
    if (area.kind !== "slot") return;
    setBusy(true);
    setNote("");
    try {
      const stl = writeBinarySTL({ positions: built.positions, triangleCount: built.triangleCount });
      const d = await api({
        action: "save_model",
        slot: area.n,
        caption: settings.caption,
        color: settings.color,
        rotate: settings.rotate,
        hidden: settings.hidden,
        bands: built.bandStarts.map((start, i) => ({ start, color: built.colors[i] })),
        stl: toBase64(stl),
        design: { settings, decorations },
      });
      setModels(d.models as ModelEntry[]);
      setNote(`Saved to slot ${area.n}. The home page shows it now.`);
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Could not save");
    }
    setBusy(false);
  };

  const removeModel = async () => {
    if (area.kind !== "slot") return;
    try {
      const d = await api({ action: "delete_model", slot: area.n });
      setModels(d.models as ModelEntry[]);
      setNote(`Slot ${area.n} is back to the built-in model.`);
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Could not delete");
    }
  };

  const saveTemplate = async () => {
    if (decorations.length === 0 || !templateName.trim()) return;
    try {
      const d = await api({ action: "save_template", name: templateName.trim(), items: captureTemplate(decorations, L) });
      setTemplates(d.templates as TemplateEntry[]);
      setTemplateName("");
      setNote("Template saved.");
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Could not save");
    }
  };

  const removeTemplate = async (id: string) => {
    const d = await api({ action: "delete_template", id });
    setTemplates(d.templates as TemplateEntry[]);
  };

  // -- keys, copies and downloads ---------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      } else if (selected !== null && decorations[selected]) {
        const step = e.shiftKey ? 2 : 0.5;
        const move = (dx: number, dy: number) => {
          e.preventDefault();
          setDecorations((cur) => cur.map((d, i) => (i === selected ? { ...d, x: d.x + dx, y: d.y + dy } : d)));
        };
        if (e.key === "ArrowLeft") move(-step, 0);
        else if (e.key === "ArrowRight") move(step, 0);
        else if (e.key === "ArrowUp") move(0, step);
        else if (e.key === "ArrowDown") move(0, -step);
        else if (e.key === "Delete" || e.key === "Backspace") {
          e.preventDefault();
          setDecorations((cur) => cur.filter((_, i) => i !== selected));
          setSelected(null);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, decorations, undo, redo, setDecorations]);

  const downloadStl = () => {
    const stl = writeBinarySTL({ positions: built.positions, triangleCount: built.triangleCount });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([stl], { type: "model/stl" }));
    a.download = `${(settings.caption || "model").replace(/[^\w-]+/g, "-")}.stl`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  const copyDesign = async () => {
    const text = JSON.stringify({ settings, decorations });
    try {
      await navigator.clipboard.writeText(text);
      setNote("Design copied.");
    } catch {
      setPasteText(text);
      setNote("Copying was blocked, so it is in the box: select it and copy.");
    }
  };

  const pasteDesign = () => {
    try {
      const d = JSON.parse(pasteText) as { settings?: Settings; decorations?: Decoration[] };
      if (d.settings) setSettings({ ...DEFAULTS, ...d.settings });
      if (Array.isArray(d.decorations)) setDecorations(d.decorations);
      setNote("Design pasted in.");
    } catch {
      setNote("That is not a design.");
    }
  };

  const copyFrom = async (n: number) => {
    try {
      const d = (await api({ action: "design", slot: n })).design as { settings?: Settings; decorations?: Decoration[] } | null;
      if (!d) {
        setNote(`${cardName(n)} has no saved design to copy.`);
        return;
      }
      if (d.settings) setSettings({ ...DEFAULTS, ...d.settings, caption: settings.caption });
      setDecorations(d.decorations ?? []);
      setNote(`Copied from ${cardName(n)}.`);
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Could not copy");
    }
  };

  // -- sign in ----------------------------------------------------------------
  if (!known) return <div style={{ padding: 24, color: "#ddd" }}>…</div>;

  if (!account) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#0b1220", color: "#e8eefc" }}>
        <style>{BRAND_STYLE}</style>
        <form
          style={{ display: "grid", gap: 10, width: 320 }}
          onSubmit={async (e) => {
            e.preventDefault();
            setAuthError("");
            try {
              setAccount(await signIn(email, pass));
            } catch (err) {
              setAuthError(err instanceof Error ? err.message : "Could not sign in");
            }
          }}
        >
          <div style={{ fontSize: 22, fontWeight: 700 }}>Litogen lab</div>
          <input className="spinInput" type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input className="spinInput" type="password" placeholder="Password" value={pass} onChange={(e) => setPass(e.target.value)} />
          <button className="btn" type="submit" style={{ justifyContent: "center" }}>Sign in</button>
          {authError && <div style={{ color: "#fca5a5", fontSize: 13 }}>{authError}</div>}
        </form>
      </div>
    );
  }

  if (admin === false) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#0b1220", color: "#e8eefc", textAlign: "center" }}>
        <div>
          <div style={{ fontSize: 20, marginBottom: 8 }}>This account cannot use the lab.</div>
          <div style={{ opacity: 0.7, marginBottom: 14 }}>{account.email}</div>
          <button className="btn" onClick={async () => { await signOut(); setAccount(null); setAdmin(null); }}>Sign out</button>
        </div>
      </div>
    );
  }

  const slotInfo = (n: number) => models.find((m) => m.slot === n);
  /** What the card is called on the home page: its saved caption, else the built-in one. */
  const cardName = (n: number) => slotInfo(n)?.caption || SHOWCASE_MODELS[n - 1]?.caption || `New card ${n}`;
  const isSlot = area.kind === "slot";

  return (
    <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", height: "100vh", background: "#0b1220", color: "#e8eefc", fontFamily: "Outfit, system-ui, sans-serif" }}>
      <style>{BRAND_STYLE}</style>

      <aside style={{ borderRight: "1px solid rgba(255,255,255,0.12)", padding: 14, overflowY: "auto", display: "grid", gap: 6, alignContent: "start" }}>
        <div style={{ fontSize: 20, fontWeight: 700 }}>Litogen lab</div>
        <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>
          {account.email} ·{" "}
          <a href="#" style={{ color: "inherit" }} onClick={async (e) => { e.preventDefault(); await signOut(); setAccount(null); setAdmin(null); }}>
            sign out
          </a>
        </div>

        <div style={{ fontSize: 11, opacity: 0.6, textTransform: "uppercase", letterSpacing: "0.08em", marginTop: 8 }}>3D models on the home page</div>
        {Array.from({ length: SLOTS }, (_, k) => k + 1).map((n) => {
          const m = slotInfo(n);
          const on = area.kind === "slot" && area.n === n;
          return (
            <button key={n} className={`segment ${on ? "active" : ""}`} style={{ textAlign: "left", display: "grid", gap: 1 }} onClick={() => openArea({ kind: "slot", n })}>
              <span>{cardName(n)}</span>
              <span style={{ fontSize: 11, opacity: 0.7 }}>{m ? "saved" : n <= 4 ? "built-in model" : "empty"}</span>
            </button>
          );
        })}

        <div style={{ fontSize: 11, opacity: 0.6, textTransform: "uppercase", letterSpacing: "0.08em", marginTop: 12 }}>Also</div>
        <button className={`segment ${area.kind === "templates" ? "active" : ""}`} style={{ textAlign: "left" }} onClick={() => openArea({ kind: "templates" })}>
          Templates ({templates.length})
        </button>
        <button className={`segment ${area.kind === "photos" ? "active" : ""}`} style={{ textAlign: "left" }} onClick={() => openArea({ kind: "photos" })}>
          Photos
        </button>
      </aside>

      <main style={{ overflowY: "auto", padding: 16, display: "grid", gap: 12, alignContent: "start" }}>
        {area.kind === "photos" ? (
          <Photos />
        ) : (
          <>
            <div style={{ fontSize: 18, fontWeight: 600 }}>
              {isSlot ? cardName(area.n) : "Templates"}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10 }}>
              <label style={cell}>Shape
                <select className="spinInput" value={settings.shape} onChange={(e) => setSettings({ ...settings, shape: e.target.value as Shape })}>
                  <option value="rectangle">Rectangle</option>
                  <option value="circle">Circle</option>
                  <option value="hexagon">Hexagon</option>
                  <option value="pentagon">Pentagon</option>
                  <option value="triangle">Triangle</option>
                </select>
              </label>
              <label style={cell}>Width (mm)
                <input className="spinInput" type="number" min={40} max={200} value={settings.widthMm} onChange={(e) => setSettings({ ...settings, widthMm: +e.target.value || 90 })} />
              </label>
              {settings.shape === "rectangle" && (
                <label style={cell}>Height (mm)
                  <input className="spinInput" type="number" min={30} max={200} value={settings.heightMm} onChange={(e) => setSettings({ ...settings, heightMm: +e.target.value || 70 })} />
                </label>
              )}
              <label style={cell}>Curve (degrees, 0 = flat)
                <input className="spinInput" type="number" min={0} max={180} value={settings.curveDeg} onChange={(e) => setSettings({ ...settings, curveDeg: +e.target.value || 0 })} />
              </label>
              <label style={cell}>Frame width (mm)
                <input className="spinInput" type="number" min={5} max={30} value={settings.border} onChange={(e) => setSettings({ ...settings, border: +e.target.value || 10 })} />
              </label>
              <label style={cell}>Corner radius (mm){settings.shape !== "rectangle" ? " — rectangle only" : ""}
                <input className="spinInput" type="number" min={0} max={30} value={settings.corner} disabled={settings.shape !== "rectangle"} onChange={(e) => setSettings({ ...settings, corner: Math.max(0, Math.min(30, +e.target.value || 0)) })} />
              </label>
              <label style={cell}>Frame colour
                <input type="color" value={settings.color} onChange={(e) => setSettings({ ...settings, color: e.target.value })} style={{ width: "100%", height: 38, padding: 0, background: "transparent", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 8 }} />
              </label>
              <label style={cell}>Icons in their own colours
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    type="checkbox"
                    checked={settings.iconColours > 0}
                    onChange={(e) => setSettings({ ...settings, iconColours: e.target.checked ? 4 : 0 })}
                  />
                  {settings.iconColours > 0 && (
                    <>
                      <span>up to</span>
                      <input className="spinInput" type="number" min={2} max={8} style={{ width: 70 }} value={settings.iconColours} onChange={(e) => setSettings({ ...settings, iconColours: Math.max(2, Math.min(8, +e.target.value || 4)) })} />
                    </>
                  )}
                </div>
              </label>
              <label style={cell}>Panel angle
                <input className="spinInput" type="number" min={45} max={90} step={5} value={settings.angle} onChange={(e) => setSettings({ ...settings, angle: +e.target.value || 85 })} />
              </label>
            </div>

            <details>
              <summary style={{ cursor: "pointer", fontSize: 13, opacity: 0.85 }}>More settings</summary>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10, marginTop: 8 }}>
                <label style={cell}>Tealight diameter (mm)
                  <input className="spinInput" type="number" min={30} max={80} value={settings.tealight} onChange={(e) => setSettings({ ...settings, tealight: +e.target.value || 38 })} />
                </label>
                <label style={cell}>Icon height (mm)
                  <input className="spinInput" type="number" min={0.4} max={3} step={0.1} value={settings.relief} onChange={(e) => setSettings({ ...settings, relief: +e.target.value || 1 })} />
                </label>
                <label style={cell}>Leg fit (mm)
                  <input className="spinInput" type="number" min={0} max={0.6} step={0.05} value={settings.fit} onChange={(e) => setSettings({ ...settings, fit: +e.target.value })} />
                </label>
                <label style={cell}>Picture play (mm)
                  <input className="spinInput" type="number" min={0} max={0.5} step={0.01} value={settings.play} onChange={(e) => setSettings({ ...settings, play: +e.target.value })} />
                </label>
                <label style={cell}>Flush clearance (mm)
                  <input className="spinInput" type="number" min={0} max={0.2} step={0.05} value={settings.flushClear} onChange={(e) => setSettings({ ...settings, flushClear: +e.target.value })} />
                </label>
              </div>
            </details>

            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <button className="btn" disabled={past.current.length === 0} onClick={undo} data-tick={historyTick}>↶ Undo</button>
              <button className="btn" disabled={future.current.length === 0} onClick={redo}>↷ Redo</button>
              <span style={{ fontSize: 12, opacity: 0.6 }}>Ctrl+Z / Ctrl+Y · arrows nudge the selected icon (Shift: more) · Delete removes it</span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 12 }}>
              <div style={{ height: 460, position: "relative", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, overflow: "hidden" }}>
                <HolderDesigner
                  width={L.W}
                  height={L.H}
                  corner={L.corner}
                  rail={L.rail}
                  window={L.window}
                  pocket={L.pocket}
                  poly={L.poly}
                  decorations={decorations}
                  onChange={setDecorations}
                  selected={selected}
                  onSelect={setSelected}
                />
              </div>
              <div style={{ height: 460, position: "relative", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 10, overflow: "hidden" }}>
                <React.Suspense fallback={null}>
                  <MeshPreview mesh={built} flatShading={false} lightBackground={false} showGrid={false} />
                </React.Suspense>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 12 }}>
              <div>
                {selected !== null && decorations[selected] ? (
                  <DecorProps
                    decoration={decorations[selected]}
                    onPatch={patch}
                    onDuplicate={() => {
                      const d = decorations[selected];
                      setDecorations([...decorations, { ...d, x: d.x + 5, y: d.y - 5 }]);
                      setSelected(decorations.length);
                    }}
                    onRemove={() => {
                      setDecorations(decorations.filter((_, i) => i !== selected));
                      setSelected(null);
                    }}
                    onAlign={align}
                    onOrder={order}
                    canForward={selected < decorations.length - 1}
                    canBack={selected > 0}
                  />
                ) : (
                  <div style={{ fontSize: 12, opacity: 0.7 }}>Pick an icon below, then drag it into place.</div>
                )}
                <div style={{ height: 10 }} />
                <IconPalette onAdd={addIcon} onAddText={addText} />
              </div>

              <div style={{ display: "grid", gap: 10, alignContent: "start" }}>
                {isSlot ? (
                  <>
                    <label style={cell}>Caption under the model
                      <input className="spinInput" value={settings.caption} maxLength={60} onChange={(e) => setSettings({ ...settings, caption: e.target.value })} placeholder="Frame with decorations" />
                    </label>
                    <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 13 }}>
                      <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <input type="checkbox" checked={settings.rotate} onChange={(e) => setSettings({ ...settings, rotate: e.target.checked })} />
                        Turns by itself
                      </label>
                      <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <input type="checkbox" checked={settings.hidden} onChange={(e) => setSettings({ ...settings, hidden: e.target.checked })} />
                        Hide from the home page
                      </label>
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button className="btn" disabled={busy} onClick={saveModel} style={{ fontWeight: 700 }}>
                        {busy ? "Saving…" : "Save to the home page"}
                      </button>
                      <button className="btn" onClick={removeModel}>Back to built-in</button>
                      <button className="btn" onClick={downloadStl}>Download STL</button>
                    </div>
                    <label style={cell}>Copy the design of another card into this one
                      <select className="spinInput" value="" onChange={(e) => e.target.value && copyFrom(+e.target.value)}>
                        <option value="">Choose a card…</option>
                        {Array.from({ length: SLOTS }, (_, k) => k + 1).filter((n) => !isSlot || n !== (area as { n: number }).n).map((n) => (
                          <option key={n} value={n}>{cardName(n)}</option>
                        ))}
                      </select>
                    </label>
                  </>
                ) : null}

                <div style={{ fontSize: 13, fontWeight: 600, marginTop: 6 }}>Templates</div>
                <div style={{ display: "flex", gap: 6 }}>
                  <input className="spinInput" value={templateName} maxLength={60} placeholder="Template name" onChange={(e) => setTemplateName(e.target.value)} />
                  <button className="btn" disabled={decorations.length === 0 || !templateName.trim()} onClick={saveTemplate}>Save</button>
                </div>
                {templates.length === 0 && <div style={{ fontSize: 12, opacity: 0.65 }}>No templates yet.</div>}
                {templates.map((tpl) => (
                  <div key={tpl.id} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tpl.name}</span>
                    <button className="btn" style={{ padding: "2px 8px" }} onClick={() => { setDecorations(layTemplate(tpl.items, L)); setSelected(null); }}>Use</button>
                    <button className="btn" style={{ padding: "2px 8px" }} onClick={() => navigator.clipboard?.writeText(JSON.stringify({ name: tpl.name, items: tpl.items }))}>Copy</button>
                    <button className="btn" style={{ padding: "2px 8px" }} onClick={() => removeTemplate(tpl.id)}>✕</button>
                  </div>
                ))}
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                  <button className="btn" style={{ padding: "2px 8px" }} onClick={copyDesign}>Copy this design</button>
                  <button className="btn" style={{ padding: "2px 8px" }} disabled={!pasteText.trim()} onClick={pasteDesign}>Paste a design from the box</button>
                </div>
                <textarea className="spinInput" rows={2} value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder="A copied design goes here" style={{ fontFamily: "monospace", fontSize: 11 }} />
                {note && <div style={{ fontSize: 13, color: "#86efac" }}>{note}</div>}
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}

const PHOTOS = [
  ...Array.from({ length: 5 }, (_, k) => `hero-${k + 1}.jpg`),
  ...Array.from({ length: 4 }, (_, k) => `model-${k + 1}.jpg`),
];

/** Uploads for the pictures on the home page: any image, saved as a JPEG of a sensible size. */
function Photos() {
  const [stamp, setStamp] = useState(Date.now());
  const [note, setNote] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const target = useRef("");
  const [captions, setCaptions] = useState<Record<string, string>>({});
  useEffect(() => {
    api({ action: "photos" })
      .then((d) => setCaptions((d.captions as Record<string, string>) ?? {}))
      .catch(() => {});
  }, []);

  const saveCaption = async (name: string, caption: string) => {
    try {
      const d = await api({ action: "set_caption", name: name.replace(/\.jpg$/, ""), caption });
      setCaptions((d.captions as Record<string, string>) ?? {});
      setNote(`${name} caption saved.`);
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Could not save");
    }
  };

  const remove = async (name: string) => {
    try {
      await api({ action: "delete_picture", name });
      setStamp(Date.now());
      setNote(`${name} deleted.`);
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Could not delete");
    }
  };

  const send = async (file: File) => {
    const img = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), "image/jpeg", 0.88));
    try {
      await api({ action: "upload_picture", name: target.current, data: toBase64(await blob.arrayBuffer()) });
      setStamp(Date.now());
      setNote(`${target.current} saved.`);
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Could not save");
    }
  };

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ fontSize: 18, fontWeight: 600 }}>Photos</div>
      <div style={{ fontSize: 13, opacity: 0.75 }}>
        hero-1 … hero-5 slide across the top of the home page; model-1 … model-4 are the ready-made models, and open in the editor when clicked. The name under a ready-made model is saved when you leave its box.
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void send(f);
        }}
      />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 10 }}>
        {PHOTOS.map((name) => (
          <div key={name} style={{ display: "grid", gap: 6 }}>
            <div style={{ aspectRatio: "4 / 3", background: "rgba(255,255,255,0.06)", borderRadius: 8, overflow: "hidden", display: "grid", placeItems: "center", fontSize: 12, opacity: 0.9 }}>
              <img src={`/home/${name}?t=${stamp}`} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} />
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button className="btn" style={{ flex: 1 }} onClick={() => { target.current = name; input.current?.click(); }}>{name} — choose…</button>
              <button className="btn" style={{ padding: "2px 8px" }} title="Delete this picture" onClick={() => remove(name)}>✕</button>
            </div>
            {name.startsWith("model-") && (
              <input
                className="spinInput"
                placeholder="Name shown under it"
                maxLength={60}
                defaultValue={captions[name.replace(/\.jpg$/, "")] ?? ""}
                key={`${name}-${captions[name.replace(/\.jpg$/, "")] ?? ""}`}
                onBlur={(e) => {
                  if (e.target.value !== (captions[name.replace(/\.jpg$/, "")] ?? "")) void saveCaption(name, e.target.value);
                }}
              />
            )}
          </div>
        ))}
      </div>
      {note && <div style={{ fontSize: 13, color: "#86efac" }}>{note}</div>}
    </div>
  );
}
