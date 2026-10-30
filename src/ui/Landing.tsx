import { useState } from "react";
import { LANGUAGES, setLang, t, useLang, type Lang } from "../i18n";
import { CONTACT_EMAIL, GALLERY, HERO_IMAGE, MODELS, type Showcase } from "./homeContent";

type Props = {
  onSignIn: () => void;
  onSignUp: () => void;
  /** Go on to the studio without an account: looking is free. */
  onStudio: () => void;
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
.homeCap { font-size: 0.85rem; color: var(--h-dim); margin-top: 6px; }
.homePrice { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
.homePrice .homeCard .big { font-size: 1.9rem; font-weight: 700; display: block; margin-bottom: 4px; color: var(--h-accent); }
.homeFoot { border-top: 1px solid var(--h-line); padding: 26px 0 40px; display: flex; flex-wrap: wrap; gap: 16px; color: var(--h-dim); font-size: 0.9rem; }
.homeFoot a { text-decoration: none; }
.homeFoot a:hover { text-decoration: underline; }
@media (max-width: 820px) {
  .homeHero { grid-template-columns: 1fr; padding-top: 12px; }
  .homeSteps, .homeFeatures, .homePrice { grid-template-columns: 1fr; }
  .homeGallery { grid-template-columns: repeat(2, 1fr); }
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

/**
 * The front page for someone who is not signed in. Signing in, or making an
 * account, goes on to the studio; so does choosing to look around without one.
 */
export default function Landing({ onSignIn, onSignUp, onStudio }: Props) {
  const lang = useLang();
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
          <Photo file={HERO_IMAGE} caption="" />
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
              <b>{t("Layered and inlay")}</b>
              <span>{t("Logos, text and line art in clean tones, or colours set side by side in one flat slab.")}</span>
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
            <div className="homeCard">
              <b>{t("Your languages")}</b>
              <span>{t("The studio speaks English, Turkish, German, Spanish and French.")}</span>
            </div>
          </div>
        </section>

        <section className="homeSection">
          <h2>{t("Made with Litogen")}</h2>
          <p className="sub">{t("Prints from the studio, lit and unlit.")}</p>
          <div className="homeGallery">
            {GALLERY.map((g) => (
              <Photo key={g.file} {...g} />
            ))}
          </div>
        </section>

        <section className="homeSection">
          <h2>{t("Ready-made models")}</h2>
          <p className="sub">{t("A few models to look at while you decide what to make.")}</p>
          <div className="homeGallery">
            {MODELS.map((g) => (
              <Photo key={g.file} {...g} />
            ))}
          </div>
        </section>

        <section className="homeSection">
          <h2>{t("Simple pricing")}</h2>
          <p className="sub">{t("You pay in tokens, only for what you download.")}</p>
          <div className="homePrice">
            <div className="homeCard">
              <span className="big">{t("Free")}</span>
              <span>{t("Preview any model in 3D, as often as you like. The stand is free to download, always.")}</span>
            </div>
            <div className="homeCard">
              <span className="big">{t("1 token")}</span>
              <span>{t("Each lithophane you download, and each new frame. Downloading the same frame design again is free.")}</span>
            </div>
            <div className="homeCard">
              <span className="big">{t("5 tokens")}</span>
              <span>{t("Every new account starts with five, enough to try it properly.")}</span>
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
          <a href="/privacy/">{t("Privacy")}</a>
          <a href="/terms/">{t("Terms")}</a>
        </footer>
      </div>
    </div>
  );
}
