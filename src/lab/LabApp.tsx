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

const SLOTS = 8;
const HEADERS = { "Content-Type": "application/json", "X-Litogen": "1" };

type Shape = "rectangle" | OutlineShape;
type Settings = {
  shape: Shape;
  widthMm: number;
  heightMm: number;
  curveDeg: number;
  border: number;
  angle: number;
  caption: string;
};
const DEFAULTS: Settings = { shape: "rectangle", widthMm: 90, heightMm: 70, curveDeg: 0, border: 10, angle: 85, caption: "" };

type ModelEntry = { slot: number; file: string; caption: string; updated: string };
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
  const [decorations, setDecorations] = useState<Decoration[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [templateName, setTemplateName] = useState("");
  const [busy, setBusy] = useState(false);

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
      fit: 0.2,
      pocketPlay: 0.05,
      tiltDeg: 90 - settings.angle,
      corner: 0,
      outline,
      bend: frameRadius,
    };
    let lean = b.tiltDeg;
    if (frameRadius > 0) while (lean > 0 && !holderLayout({ ...b, tiltDeg: lean }).shearOk) lean -= 1;
    return { ...b, tiltDeg: lean };
  }, [settings.widthMm, settings.border, settings.angle, height, outline, frameRadius, pictureRadius]);

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
      makeDecor(decorations, geom, 1, { mode: "flat", colours: 0, palette: [] }, 0)
        .then((d) => live && setDecor(d))
        .catch(() => live && setDecor(null));
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [decorations, geom]);

  const built = useMemo(() => {
    const a = assembleHolder(params, decor?.cuts ?? [], decor?.recess ?? null, decor?.relief ?? null);
    const placed = holderInPlace(a.mesh, params.tiltDeg, L.socketDepth, L.W / 2);
    const stand = buildStand({ tealight: 38, prongSpacing: spacing });
    const positions = new Float32Array(placed.positions.length + stand.positions.length);
    positions.set(placed.positions, 0);
    positions.set(stand.positions, placed.positions.length);
    const tilt = (params.tiltDeg * Math.PI) / 180;
    const mesh: PreviewMesh = {
      positions,
      triangleCount: placed.triangleCount + stand.triangleCount,
      bandStarts: [0, placed.triangleCount],
      colors: ["#d9b77a", "#9fb4c8"],
      faceAxis: [0, Math.cos(tilt), Math.sin(tilt)],
    };
    return mesh;
  }, [params, decor, L.socketDepth, L.W, spacing]);

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
        setDecorations(d?.decorations ?? []);
      } catch {
        setDecorations([]);
      }
    } else if (next.kind === "templates") {
      setSettings(DEFAULTS);
      setDecorations([]);
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
              <label style={cell}>Panel angle
                <input className="spinInput" type="number" min={45} max={90} step={5} value={settings.angle} onChange={(e) => setSettings({ ...settings, angle: +e.target.value || 85 })} />
              </label>
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
                    <div style={{ display: "flex", gap: 8 }}>
                      <button className="btn" disabled={busy} onClick={saveModel} style={{ fontWeight: 700 }}>
                        {busy ? "Saving…" : "Save to the home page"}
                      </button>
                      <button className="btn" onClick={removeModel}>Back to built-in</button>
                    </div>
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
        hero-1 … hero-5 slide across the top of the home page; model-1 … model-4 are the ready-made models, and open in the editor when clicked.
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
            <button className="btn" onClick={() => { target.current = name; input.current?.click(); }}>{name} — choose…</button>
          </div>
        ))}
      </div>
      {note && <div style={{ fontSize: 13, color: "#86efac" }}>{note}</div>}
    </div>
  );
}
