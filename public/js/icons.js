// ---------------------------------------------------------------------------
// Line icons for the navigation.
//
// The sidebar used to lean on whatever glyphs the font happened to have —
// ⌂ ▤ ◇ ⛁ — which came out tiny, grey, and different on every machine.
// These are drawn: one 24-unit grid, one stroke weight, round joins, sized by
// the CSS around them rather than by a font.
// ---------------------------------------------------------------------------

const PATHS = {
  home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10.3V20h13v-9.7"/><path d="M10 20v-5.5h4V20"/>',
  bolt: '<path d="M13.2 2.5 4.8 13.5h6.2l-1.2 8 8.4-11h-6.2z"/>',
  invoice: '<path d="M14 3H7.5A1.5 1.5 0 0 0 6 4.5v15A1.5 1.5 0 0 0 7.5 21h9a1.5 1.5 0 0 0 1.5-1.5V7z"/><path d="M14 3v4h4"/><path d="M9 12h6M9 15.5h6M9 19h3"/>',
  tag: '<path d="M3.5 12.3V4.5a1 1 0 0 1 1-1h7.8l8.2 8.2-8.8 8.8z"/><circle cx="8" cy="8" r="1.3"/>',
  cart: '<path d="M2.5 3.5h2.6l2.2 11.2a1.5 1.5 0 0 0 1.5 1.2h8.6a1.5 1.5 0 0 0 1.5-1.2l1.6-7.2H6.2"/><circle cx="9.6" cy="20" r="1.3"/><circle cx="17.4" cy="20" r="1.3"/>',
  banknote: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.8"/><circle cx="6.3" cy="12" r=".9" fill="currentColor" stroke="none"/><circle cx="17.7" cy="12" r=".9" fill="currentColor" stroke="none"/>',
  refresh: '<path d="M20 12a8 8 0 0 1-13.6 5.7"/><path d="M4 12a8 8 0 0 1 13.6-5.7"/><path d="M17.5 2.8v4h-4"/><path d="M6.5 21.2v-4h4"/>',
  users: '<circle cx="9.5" cy="8" r="3.5"/><path d="M2.5 20a7 7 0 0 1 14 0"/><path d="M15.5 4.7a3.5 3.5 0 0 1 0 6.6"/><path d="M17.5 13.6a7 7 0 0 1 4 6.4"/>',
  box: '<path d="M12 2.6 21 7v10l-9 4.4L3 17V7z"/><path d="M3 7l9 4.5L21 7"/><path d="M12 11.5v10"/><path d="M7.5 4.8l9 4.5"/>',
  receipt: '<path d="M5.5 3h13v18l-2.6-1.6-2.6 1.6-2.6-1.6L8.1 21 5.5 19.4z"/><path d="M9 8h6M9 11.5h6M9 15h3.5"/>',
  chart: '<path d="M4 20h16"/><rect x="5.5" y="11" width="3.6" height="7" rx=".6"/><rect x="10.2" y="5.5" width="3.6" height="12.5" rx=".6"/><rect x="14.9" y="8.5" width="3.6" height="9.5" rx=".6"/>',
  download: '<path d="M12 3.5v11"/><path d="M8 10.5l4 4 4-4"/><path d="M3.5 15v3.5a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2V15"/>',
  gear: '<circle cx="12" cy="12" r="3.1"/><path d="M12 2.8v2.5M12 18.7v2.5M21.2 12h-2.5M5.3 12H2.8M18.5 5.5l-1.8 1.8M7.3 16.7l-1.8 1.8M18.5 18.5l-1.8-1.8M7.3 7.3 5.5 5.5"/><circle cx="12" cy="12" r="7"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6.2 9.6h.1M9.8 9.6h.1M13.4 9.6h.1M17 9.6h.1M6.2 12.6h.1M9.8 12.6h.1M13.4 12.6h.1M17 12.6h.1M8 15.5h8"/>',
};

/** An inline SVG for `name`; unknown names come back as an empty string. */
export function icon(name) {
  const body = PATHS[name];
  if (!body) return '';
  return `<svg class="ico ico-${name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
}

export const ICON_NAMES = Object.keys(PATHS);
