import { lazy, Suspense, useEffect, useState } from "react";
import { LANGUAGES, setLang, t, useLang, type Lang } from "../i18n";
import { CONTACT_EMAIL, HERO_IMAGES, MAKERWORLD_URL, MODELS, SHOWCASE_MODELS, type Showcase } from "./homeContent";

const ModelViewer = lazy(() => import("./ModelViewer"));

type Props = {
  onSignIn: () => void;
  onSignUp: () => void;
  /** Go on to the studio without an account: looking is free. */
  onStudio: () => void;
  /** Open a ready-made model's picture in the editor. */
  onOpenModel: (file: string) => void;
};

const STYLE = `
.home {
  --h-bg: #0b1220;
  --h-bg2: #111a2e;
  --h-ink: #e8eefc;
  --h-dim: rgba(232, 238, 252, 0.7);
  --h-line: rgba(255, 255, 255, 0.12);
  --h-card: rgba(255, 255, 255, 0.05);
  --h-accent: #22d3ee;
  --h-accent-ink: #04222a;
  position: fixed;
  inset: 0;
  z-index: 60;
  overflow-y: auto;
  background: radial-gradient(1200px 600px at 70% -10%, rgba(34, 211, 238, 0.16), transparent 60%), var(--h-bg);
  color: var(--h-ink);
  font-family: 'Outfit', system-ui, sans-serif;
  scroll-behavior: smooth;
}
:root[data-theme="light"] .home {
  --h-bg: #f6f8fc;
  --h-bg2: #ffffff;
  --h-ink: #0f172a;
  --h-dim: rgba(15, 23, 42, 0.68);
  --h-line: rgba(15, 23, 42, 0.12);
  --h-card: rgba(15, 23, 42, 0.04);
  --h-accent: #0e7490;
  --h-accent-ink: #ffffff;
  background: radial-gradient(1200px 600px at 70% -10%, rgba(14, 116, 144, 0.14), transparent 60%), var(--h-bg);
}
.home * { box-sizing: border-box; }
.home a { color: inherit; }
.homeWrap { max-width: 1100px; margin: 0 auto; padding: 0 20px; }
.homeNav { display: flex; align-items: center; gap: 10px; padding: 16px 0; }
.homeBrand { font-size: 1.5rem; font-weight: 700; letter-spacing: 0.02em; margin-right: auto; }
.homeBtn {
  font: inherit; font-weight: 600; cursor: pointer; border-radius: 10px;
  padding: 9px 16px; border: 1px solid var(--h-line); background: var(--h-card); color: var(--h-ink);
}
.homeBtn { white-space: nowrap; }
.homeBtn.primary { background: var(--h-accent); color: var(--h-accent-ink); border-color: transparent; }
.homeBtn.big { padding: 13px 22px; font-size: 1.02rem; }
.homeLang {
  font: inherit; font-size: 0.8rem; color: inherit; background: transparent;
  border: 1px solid var(--h-line); border-radius: 8px; padding: 6px 8px; cursor: pointer;
}
.homeLang { width: auto; flex: none; }
.homeLang option { color: #111; }
.homeHero { display: grid; grid-template-columns: 1.05fr 1fr; gap: 36px; align-items: center; padding: 36px 0 56px; }
.homeHero h1 { font-size: clamp(2rem, 4.6vw, 3.4rem); line-height: 1.08; margin: 0 0 16px; font-weight: 700; }
.homeHero p { font-size: 1.1rem; line-height: 1.55; color: var(--h-dim); margin: 0 0 24px; max-width: 34em; }
.homeCtas { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
.homeSmall { font-size: 0.82rem; color: var(--h-dim); margin-top: 10px; }
.homePic {
  position: relative; overflow: hidden; border-radius: 16px; border: 1px solid var(--h-line);
  background: linear-gradient(135deg, rgba(34, 211, 238, 0.18), rgba(167, 139, 250, 0.16)), var(--h-bg2);
}
.homePic img { display: block; width: 100%; height: 100%; object-fit: cover; }
.homePic .hole {
  position: absolute; inset: 0; display: grid; place-items: center; text-align: center;
  font-size: 0.82rem; color: var(--h-dim); padding: 12px; pointer-events: none;
}
.homeHero .homePic { aspect-ratio: 16 / 11; }
.homeSection { padding: 44px 0; border-top: 1px solid var(--h-line); }
.homeSection h2 { font-size: 1.8rem; margin: 0 0 6px; font-weight: 700; }
.homeSection .sub { color: var(--h-dim); margin: 0 0 26px; max-width: 40em; line-height: 1.5; }
.homeSteps { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
.homeCard { background: var(--h-card); border: 1px solid var(--h-line); border-radius: 14px; padding: 18px; }
.homeCard b { display: block; font-size: 1.05rem; margin-bottom: 6px; }
.homeCard span { color: var(--h-dim); line-height: 1.5; font-size: 0.95rem; }
.homeNum {
  width: 30px; height: 30px; border-radius: 50%; display: grid; place-items: center; margin-bottom: 10px;
  background: var(--h-accent); color: var(--h-accent-ink); font-weight: 700;
}
.homeFeatures { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
.homeGallery { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.homeGallery .homePic { aspect-ratio: 4 / 3; }
.homeGallery.four { grid-template-columns: repeat(4, 1fr); }
.homeCap { font-size: 0.85rem; color: var(--h-dim); margin-top: 6px; }
.homePrice { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
.homePrice .homeCard .big { font-size: 1.9rem; font-weight: 700; display: block; margin-bottom: 4px; color: var(--h-accent); }
.homeFoot { border-top: 1px solid var(--h-line); padding: 26px 0 40px; display: flex; flex-wrap: wrap; gap: 16px; color: var(--h-dim); font-size: 0.9rem; }
.homeFoot a { text-decoration: none; }
.homeFoot a:hover { text-decoration: underline; }
.homeSlides { position: relative; aspect-ratio: 16 / 11; }
.homeSlides .slide { position: absolute; inset: 0; opacity: 0; transition: opacity 0.9s ease; }
.homeSlides .slide.on { opacity: 1; }
.homeDots { position: absolute; left: 0; right: 0; bottom: 10px; display: flex; gap: 7px; justify-content: center; }
.homeDots button {
  width: 9px; height: 9px; border-radius: 50%; border: 0; padding: 0; cursor: pointer;
  background: rgba(255, 255, 255, 0.45);
}
.homeDots button.on { background: #fff; }
.homeStory { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; counter-reset: step; }
.homeStory .homeCard { position: relative; }
.homeStory .homeCard::before {
  counter-increment: step; content: counter(step); display: block; font-size: 0.8rem; font-weight: 700;
  color: var(--h-accent); margin-bottom: 6px; letter-spacing: 0.08em;
}
.homeModelBtn { all: unset; display: block; cursor: pointer; width: 100%; }
.homeModelBtn:focus-visible .homePic { outline: 2px solid var(--h-accent); }
.homeModelBtn .homePic { transition: transform 0.2s ease, border-color 0.2s ease; aspect-ratio: 4 / 3; }
.homeModelBtn:hover .homePic { transform: translateY(-3px); border-color: var(--h-accent); }
.homePlans { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; align-items: stretch; }
.homePlans .homeCard { display: flex; flex-direction: column; gap: 8px; }
.homePlans h3 { margin: 0; font-size: 1.1rem; }
.homePlans .price { font-size: 1.7rem; font-weight: 700; color: var(--h-accent); line-height: 1.1; }
.homePlans .price small { font-size: 0.85rem; font-weight: 500; color: var(--h-dim); }
.homePlans ul { margin: 0; padding-left: 18px; color: var(--h-dim); font-size: 0.92rem; line-height: 1.55; }
.homePack { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; padding: 8px 0; border-top: 1px solid var(--h-line); }
.homePack:first-of-type { border-top: 0; }
.homePack.best b::after { content: attr(data-best); margin-left: 8px; font-size: 0.7rem; padding: 2px 7px; border-radius: 99px; background: var(--h-accent); color: var(--h-accent-ink); vertical-align: middle; }
@media (max-width: 1000px) {
  .homePlans, .homeStory { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 820px) {
  .homeHero { grid-template-columns: 1fr; padding-top: 12px; }
  .homeSteps, .homeFeatures, .homePrice, .homePlans, .homeStory { grid-template-columns: 1fr; }
  .homeGallery, .homeGallery.four { grid-template-columns: repeat(2, 1fr); }
}
`;

/** A photograph that may not be there yet: the box stays, with a note. */
function Photo({ file, caption, className }: Showcase & { className?: string }) {
  const [missing, setMissing] = useState(false);
  return (
    <figure style={{ margin: 0 }}>
      <div className={`homePic ${className ?? ""}`}>
        {!missing && (
          <img
            src={`${import.meta.env.BASE_URL}home/${file}`}
            alt={t(caption)}
            loading="lazy"
            onError={() => setMissing(true)}
          />
        )}
        {missing && <div className="hole">{t("Photo coming soon")}</div>}
      </div>
      {caption && <figcaption className="homeCap">{t(caption)}</figcaption>}
    </figure>
  );
}

/** The photographs at the top, one after another; they wait while the pointer is on them. */
function HeroSlides() {
  const [at, setAt] = useState(0);
  const [gone, setGone] = useState<Record<number, boolean>>({});
  const [paused, setPaused] = useState(false);
  const shown = HERO_IMAGES.map((_, i) => i).filter((i) => !gone[i]);

  useEffect(() => {
    if (paused || shown.length < 2) return;
    const timer = setInterval(() => setAt((a) => a + 1), 4500);
    return () => clearInterval(timer);
  }, [paused, shown.length]);

  const current = shown.length > 0 ? shown[at % shown.length] : -1;
  return (
    <div
      className="homePic homeSlides"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {HERO_IMAGES.map((h, i) => (
        <div key={h.file} className={`slide ${i === current ? "on" : ""}`}>
          {!gone[i] && (
            <img
              src={`${import.meta.env.BASE_URL}home/${h.file}`}
              alt={h.caption ? t(h.caption) : ""}
              onError={() => setGone((g) => ({ ...g, [i]: true }))}
            />
          )}
        </div>
      ))}
      {shown.length === 0 && <div className="hole">{t("Photo coming soon")}</div>}
      {shown.length > 1 && (
        <div className="homeDots">
          {shown.map((i, k) => (
            <button
              key={i}
              aria-label={`${k + 1}`}
              className={i === current ? "on" : ""}
              onClick={() => setAt(k)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The front page for someone who is not signed in. Signing in, or making an
 * account, goes on to the studio; so does choosing to look around without one,
 * or opening a ready-made model.
 */
export default function Landing({ onSignIn, onSignUp, onStudio, onOpenModel }: Props) {
  const lang = useLang();
  // The models on show: the built-in ones, with any that were made in the lab
  // standing in for the slot of the same number.
  const [models, setModels] = useState(SHOWCASE_MODELS.map((m) => ({ ...m, v: "" })));
  useEffect(() => {
    let live = true;
    fetch(`${import.meta.env.BASE_URL}home/models/manifest.json?${Date.now()}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((list: { slot: number; file: string; caption: string; updated: string }[]) => {
        if (!live || !Array.isArray(list) || list.length === 0) return;
        const bySlot = new Map(list.map((m) => [m.slot, m]));
        const merged = SHOWCASE_MODELS.map((d, i) => {
          const m = bySlot.get(i + 1);
          return m ? { file: m.file, caption: m.caption, v: m.updated } : { ...d, v: "" };
        });
        for (const m of list) {
          if (m.slot > SHOWCASE_MODELS.length) merged.push({ file: m.file, caption: m.caption, v: m.updated });
        }
        setModels(merged);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return (
    <div className="home">
      <style>{STYLE}</style>
      <div className="homeWrap">
        <nav className="homeNav">
          <div className="homeBrand">{t("Litogen")}</div>
          <select
            className="homeLang"
            value={lang}
            aria-label={t("Language")}
            onChange={(e) => setLang(e.target.value as Lang)}
          >
            {LANGUAGES.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          <button className="homeBtn" onClick={onSignIn}>{t("Sign in")}</button>
          <button className="homeBtn primary" onClick={onStudio}>{t("Open the studio")}</button>
        </nav>

        <header className="homeHero">
          <div>
            <h1>{t("Turn a photo into a lithophane that glows")}</h1>
            <p>
              {t("Upload a picture and get a print-ready 3D model in minutes — with a frame, a stand and decorations made to fit it.")}
            </p>
            <div className="homeCtas">
              <button className="homeBtn primary big" onClick={onSignUp}>{t("Start free")}</button>
              <button className="homeBtn big" onClick={onStudio}>{t("Try the studio without an account")}</button>
            </div>
            <div className="homeSmall">{t("New accounts start with 5 tokens. Looking at a model in 3D is always free.")}</div>
          </div>
          <HeroSlides />
        </header>

        <section className="homeSection">
          <h2>{t("How it works")}</h2>
          <p className="sub">{t("From a picture to a print in three steps.")}</p>
          <div className="homeSteps">
            <div className="homeCard">
              <div className="homeNum">1</div>
              <b>{t("Upload")}</b>
              <span>{t("Drop in a photo or a logo, crop it and set the size.")}</span>
            </div>
            <div className="homeCard">
              <div className="homeNum">2</div>
              <b>{t("Preview in 3D")}</b>
              <span>{t("See the model, the colours and the frame before anything is spent. Looking is always free.")}</span>
            </div>
            <div className="homeCard">
              <div className="homeNum">3</div>
              <b>{t("Download and print")}</b>
              <span>{t("Get an STL, or a 3MF with one body per colour for multi-colour printing.")}</span>
            </div>
          </div>
        </section>

        <section className="homeSection">
          <h2>{t("What you can make")}</h2>
          <p className="sub">{t("One studio for the picture, the frame it sits in and the stand that holds it.")}</p>
          <div className="homeFeatures">
            <div className="homeCard">
              <b>{t("Lithophanes")}</b>
              <span>{t("Photographs as a continuous surface, thick where it is dark, glowing when lit from behind.")}</span>
            </div>
            <div className="homeCard">
              <b>{t("Layered")}</b>
              <span>{t("Logos, text and line art in clean tones, each standing at its own height.")}</span>
            </div>
            <div className="homeCard">
              <b>{t("Inlay")}</b>
              <span>{t("Colours set side by side in one flat slab, for coasters and signs.")}</span>
            </div>
            <div className="homeCard">
              <b>{t("Frames and stands")}</b>
              <span>{t("A frame the print slides into and a stand for a tealight, in any shape, curved or flat.")}</span>
            </div>
            <div className="homeCard">
              <b>{t("Decorations")}</b>
              <span>{t("Icons, flags and your own words raised, cut out or set flush, in their own colours.")}</span>
            </div>
            <div className="homeCard">
              <b>{t("Curved lamps")}</b>
              <span>{t("Wrap the picture round a cylinder, with a frame that follows the curve.")}</span>
            </div>
          </div>
        </section>

        <section className="homeSection">
          <h2>{t("How it all started")}</h2>
          <p className="sub">{t("A short story, from one print to a whole studio.")}</p>
          <div className="homeStory">
            <div className="homeCard">
              <b>{t("A simple lithophane")}</b>
              <span>{t("It began with one photograph turned into a lithophane: a single print, held up to the light.")}</span>
            </div>
            <div className="homeCard">
              <b>{t("IcosaLume and DodecaLume")}</b>
              <span>{t("That grew into the Lume series: faceted lithophane lamps shaped as an icosahedron and a dodecahedron, shared on MakerWorld.")}</span>
            </div>
            <div className="homeCard">
              <b>{t("Litogen Lite")}</b>
              <span>{t("Then it became much more: a free web app that turns any picture into a model, with frames, stands, decorations and colours.")}</span>
            </div>
            <div className="homeCard">
              <b>{t("Litogen")}</b>
              <span>{t("And now Litogen, the paid version, for makers and small shops that need more.")}</span>
            </div>
          </div>
          <div className="homeCtas" style={{ marginTop: 18 }}>
            <a className="homeBtn" href={MAKERWORLD_URL} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}>
              {t("See the Lume series on MakerWorld")} ↗
            </a>
          </div>
        </section>

        <section className="homeSection">
          <h2>{t("Made with Litogen")}</h2>
          <p className="sub">{t("Models from the studio. Drag to turn them; click one, then scroll to zoom.")}</p>
          <div className={`homeGallery ${models.length === 4 ? "four" : ""}`}>
            {models.map((m) => (
              <figure key={m.file} style={{ margin: 0 }}>
                <Suspense fallback={<div className="homePic" style={{ aspectRatio: "4 / 3" }} />}>
                  <ModelViewer src={`${import.meta.env.BASE_URL}home/${m.file}${m.v ? `?v=${encodeURIComponent(m.v)}` : ""}`} color={"color" in m ? (m as { color?: string }).color : undefined} />
                </Suspense>
                <figcaption className="homeCap">{t(m.caption)}</figcaption>
              </figure>
            ))}
          </div>
        </section>

        <section className="homeSection">
          <h2>{t("Ready-made models")}</h2>
          <p className="sub">{t("Pick one to open it in the editor, then make it yours.")}</p>
          <div className={`homeGallery ${MODELS.length === 4 ? "four" : ""}`}>
            {MODELS.map((m) => (
              <button key={m.file} className="homeModelBtn" onClick={() => onOpenModel(m.file)}>
                <Photo {...m} />
              </button>
            ))}
          </div>
        </section>

        <section className="homeSection">
          <h2>{t("Pricing")}</h2>
          <p className="sub">{t("Start free, and pay only for what you download. Tokens never expire.")}</p>
          <div className="homePlans">
            <div className="homeCard">
              <h3>{t("Free")}</h3>
              <div className="price">$0</div>
              <ul>
                <li>{t("5 tokens when you sign up")}</li>
                <li>{t("Preview any model in 3D, always")}</li>
                <li>{t("Stands are always free")}</li>
                <li>{t("Downloading the same frame design again is free")}</li>
              </ul>
            </div>
            <div className="homeCard">
              <h3>{t("Tokens")}</h3>
              <div>
                <div className="homePack"><b>40 {t("tokens")}</b><span>$2.99</span></div>
                <div className="homePack"><b>80 {t("tokens")}</b><span>$4.99</span></div>
                <div className="homePack best"><b data-best={t("Best value")}>200 {t("tokens")}</b><span>$9.99</span></div>
              </div>
              <span className="homeSmall">{t("Each lithophane or new frame you download takes 1 token. Tokens never expire.")}</span>
            </div>
            <div className="homeCard">
              <h3>Pro</h3>
              <div className="price">$3.99 <small>{t("a month")}</small></div>
              <div className="homeSmall" style={{ marginTop: 0 }}>{t("or")} $29.99 {t("a year")}</div>
              <ul>
                <li>{t("Unlimited output")}</li>
                <li>{t("Commercial use")}</li>
                <li>{t("Batch production")}</li>
                <li>{t("High resolution")}</li>
                <li>{t("Custom shapes")}</li>
              </ul>
            </div>
            <div className="homeCard">
              <h3>{t("Lifetime")}</h3>
              <div className="price">$39.99</div>
              <div className="homeSmall" style={{ marginTop: 0 }}>{t("One payment, once")}</div>
              <ul>
                <li>{t("Everything in Pro")}</li>
                <li>{t("No monthly or yearly charge, ever")}</li>
              </ul>
            </div>
          </div>
          {CONTACT_EMAIL && (
            <p className="homeSmall" style={{ marginTop: 14 }}>
              {t("Need more tokens?")} <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
            </p>
          )}
          <div className="homeCtas" style={{ marginTop: 22 }}>
            <button className="homeBtn primary big" onClick={onSignUp}>{t("Start free")}</button>
            <button className="homeBtn big" onClick={onStudio}>{t("Open the studio")}</button>
          </div>
        </section>

        <footer className="homeFoot">
          <span>Litogen</span>
          <a href={MAKERWORLD_URL} target="_blank" rel="noopener noreferrer">MakerWorld</a>
          <a href="/privacy/">{t("Privacy")}</a>
          <a href="/terms/">{t("Terms")}</a>
        </footer>
      </div>
    </div>
  );
}
