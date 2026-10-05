/**
 * JSON for the inside of a <script> element (a data block or JSON-LD). Plain
 * JSON.stringify leaves "<" alone, so a value holding "</script><script>..."
 * (an album title from Spotify, say) would close the element and start an
 * executable script. Escaping "<", ">" and "&" as \u sequences keeps the JSON
 * identical when parsed and makes a breakout impossible; U+2028 and U+2029
 * are escaped for older JavaScript parsers.
 */
export function scriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}
