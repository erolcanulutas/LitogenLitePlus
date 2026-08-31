/**
 * The Sign in with Google button.
 *
 * Google's own script draws it, and the token it gets back is posted straight
 * to the server rather than handed to this page — the browser is navigated to
 * Google and Google navigates it back, so nothing running here ever sees the
 * token or could be made to send it somewhere else.
 */

const CLIENT_ID =
  "461486745524-tbkp26t5rf2r16ttsdmvbpo7ctschkm4.apps.googleusercontent.com";

const SCRIPT = "https://accounts.google.com/gsi/client";

type Gsi = {
  accounts: {
    id: {
      initialize: (o: Record<string, unknown>) => void;
      renderButton: (el: HTMLElement, o: Record<string, unknown>) => void;
    };
  };
};

let loading: Promise<Gsi | null> | null = null;

function load(): Promise<Gsi | null> {
  if (loading) return loading;

  loading = new Promise((resolve) => {
    const ready = (window as unknown as { google?: Gsi }).google;
    if (ready?.accounts?.id) {
      resolve(ready);
      return;
    }

    const tag = document.createElement("script");
    tag.src = SCRIPT;
    tag.async = true;
    tag.onload = () => resolve((window as unknown as { google?: Gsi }).google ?? null);
    // Blocked by an extension, or offline. The password form is still there.
    tag.onerror = () => resolve(null);
    document.head.appendChild(tag);
  });

  return loading;
}

/** Draws the button into `host`. Quietly does nothing if Google cannot load. */
export async function drawGoogleButton(host: HTMLElement): Promise<boolean> {
  const gsi = await load();
  if (!gsi?.accounts?.id) return false;

  gsi.accounts.id.initialize({
    client_id: CLIENT_ID,
    login_uri: `${window.location.origin}/api/oauth-google.php`,
    ux_mode: "redirect",
  });

  host.replaceChildren();
  gsi.accounts.id.renderButton(host, {
    type: "standard",
    theme: "filled_black",
    size: "large",
    shape: "pill",
    text: "continue_with",
    width: 320,
  });

  return true;
}

/**
 * What the server said about a sign-in it just handled, if this load is the
 * browser coming back from Google. Taken out of the address afterwards, so a
 * refresh does not read it again.
 */
export function signInOutcome(): "ok" | "failed" | null {
  const at = new URL(window.location.href);
  const said = at.searchParams.get("signin");
  if (said !== "ok" && said !== "failed") return null;

  at.searchParams.delete("signin");
  window.history.replaceState({}, "", at.pathname + at.search + at.hash);
  return said;
}
