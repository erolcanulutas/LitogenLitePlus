import { useState } from "react";
import { closeAccount, unlimited, type Account } from "../core/account";

/**
 * The account: what is left, what can be bought, and how to leave.
 *
 * Buying happens on Payhip rather than here, so there is no card form and no
 * card details ever reach this site. The one thing that has to travel with the
 * buyer is the address they signed in with — the purchase is matched to the
 * account by it — so it is said plainly and shown next to every button rather
 * than left to be guessed at.
 */

type Props = {
  account: Account;
  theme: "dark" | "light";
  onTheme: (t: "dark" | "light") => void;
  onClose: () => void;
  onClosedAccount: () => void;
};

const PACKS = [
  { tokens: 50, price: "$0.99", url: "https://payhip.com/b/oZuMi" },
  { tokens: 250, price: "$4.49", url: "https://payhip.com/b/53tiU", best: true },
  { tokens: 600, price: "$9.99", url: "https://payhip.com/b/Qb6iP" },
];

const PLANS = [
  { every: "month", price: "$1.99", url: "https://payhip.com/b/9eIkh" },
  { every: "year", price: "$9.99", url: "https://payhip.com/b/Gyghc", best: true },
];

export default function AccountPanel({
  account,
  theme,
  onTheme,
  onClose,
  onClosedAccount,
}: Props) {
  const [closing, setClosing] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sub = unlimited(account);

  return (
    <div className="modalBackdrop" onClick={onClose}>
      <div className="modalCard accountCard" onClick={(e) => e.stopPropagation()}>
        <div className="modalTitle">Account</div>

        <div className="acctWho">
          <span className="acctEmail">{account.email}</span>
          <span className={`balance ${sub ? "unlimited" : ""}`}>
            {sub ? "Unlimited" : `${account.tokens} tokens`}
          </span>
        </div>

        {sub && account.planUntil && (
          <p className="acctNote">
            Unlimited exports until {account.planUntil.slice(0, 10)}.
          </p>
        )}

        <h3 className="acctHeading">Tokens</h3>
        <p className="acctNote">
          One token for each model you export. Looking at a model in 3D is free
          and always will be.
        </p>

        <div className="acctGrid">
          {PACKS.map((p) => (
            <a
              key={p.tokens}
              className={`acctBuy ${p.best ? "best" : ""}`}
              href={p.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span className="acctBuyTop">{p.tokens}</span>
              <span className="acctBuyLabel">tokens</span>
              <span className="acctBuyPrice">{p.price}</span>
            </a>
          ))}
        </div>

        <h3 className="acctHeading">Unlimited</h3>
        <p className="acctNote">Export as much as you like, no tokens spent.</p>

        <div className="acctGrid two">
          {PLANS.map((p) => (
            <a
              key={p.every}
              className={`acctBuy ${p.best ? "best" : ""}`}
              href={p.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span className="acctBuyTop">{p.price}</span>
              <span className="acctBuyLabel">a {p.every}</span>
              <span className="acctBuyPrice">{p.every === "year" ? "save 58%" : ""}</span>
            </a>
          ))}
        </div>

        <div className="acctFlag">
          Buy with <strong>{account.email}</strong> — that is how a purchase finds
          this account. A different address is not lost: sign in with it and
          whatever it bought comes across.
        </div>

        <h3 className="acctHeading">Settings</h3>

        <div className="acctRow">
          <span>Appearance</span>
          <div className="segmented acctSeg">
            <button
              className={`segment ${theme === "dark" ? "active" : ""}`}
              onClick={() => onTheme("dark")}
            >
              Dark
            </button>
            <button
              className={`segment ${theme === "light" ? "active" : ""}`}
              onClick={() => onTheme("light")}
            >
              Light
            </button>
          </div>
        </div>

        <h3 className="acctHeading danger">Close account</h3>

        {!closing ? (
          <>
            <p className="acctNote">
              Removes the account and everything on it, tokens included. There is
              no way back.
            </p>
            <button className="btn" onClick={() => setClosing(true)}>
              Close my account
            </button>
          </>
        ) : (
          <>
            <p className="acctNote">
              Type <strong>{account.email}</strong> to confirm.
            </p>
            <input
              className="spinInput"
              value={typed}
              placeholder={account.email}
              onChange={(e) => setTyped(e.target.value)}
            />
            {error && <div className="accountError">{error}</div>}
            <div className="modalActions" style={{ marginTop: 12 }}>
              <button
                className="btn danger"
                disabled={busy || typed.trim().toLowerCase() !== account.email}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    await closeAccount(typed.trim());
                    onClosedAccount();
                  } catch (e) {
                    setError(e instanceof Error ? e.message : "Could not close it");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? "…" : "Close it for good"}
              </button>
              <button className="btn" onClick={() => setClosing(false)}>
                Keep it
              </button>
            </div>
          </>
        )}

        <button className="linkBtn" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}
