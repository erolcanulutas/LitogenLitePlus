/**
 * The filaments a person owns, and which of them a print is to be made in.
 *
 * Owning one and using one are two things. A colour stays in the list however
 * it is used from one print to the next; ticking it says "print with this
 * one", and leaving it unticked says "I have it, not now". Nothing is used
 * unless it is ticked.
 */
export type Filament = {
  /** #rrggbb. */
  c: string;
  /** Print with it. */
  on: boolean;
};

export const MAX_FILAMENTS = 12;

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * A list as it may have been kept: objects, or, before ticking existed, bare
 * colours, which come back unticked so that nothing starts being used by itself.
 */
export function parseFilaments(raw: unknown): Filament[] {
  if (!Array.isArray(raw)) return [];
  const out: Filament[] = [];
  for (const item of raw) {
    if (typeof item === "string" && HEX.test(item)) {
      out.push({ c: item.toLowerCase(), on: false });
    } else if (item && typeof item === "object") {
      const { c, on } = item as { c?: unknown; on?: unknown };
      if (typeof c === "string" && HEX.test(c)) out.push({ c: c.toLowerCase(), on: on === true });
    }
    if (out.length >= MAX_FILAMENTS) break;
  }
  return out;
}

/** The colours to print in: the ticked ones. */
export const activeColours = (list: readonly Filament[]): string[] =>
  list.filter((f) => f.on).map((f) => f.c);
