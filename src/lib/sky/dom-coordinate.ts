/**
 * Presentation-only, injective ASCII coordinate for an exact JavaScript string.
 * Fixed-width UTF-16 code units preserve NUL, lone surrogates and normalization
 * distinctions through HTML parsing and CSS selectors. Never use this as a canon ID.
 */
export function domCoordinate(id: string): string {
  let coordinate = "sky-";
  for (let i = 0; i < id.length; i++) {
    coordinate += id.charCodeAt(i).toString(16).padStart(4, "0");
  }
  return coordinate;
}
