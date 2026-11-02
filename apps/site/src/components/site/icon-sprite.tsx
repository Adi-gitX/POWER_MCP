const SPRITE = `<svg class="icon-sprite" aria-hidden="true" focusable="false">
  <symbol id="i-arrow-right" viewBox="0 0 24 24"><path d="M4 12h15M13 6l6 6-6 6"/></symbol>
  <symbol id="i-arrow-left" viewBox="0 0 24 24"><path d="M20 12H5M11 6l-6 6 6 6"/></symbol>
  <symbol id="i-arrow-up" viewBox="0 0 24 24"><path d="M12 19V5M6 11l6-6 6 6"/></symbol>
  <symbol id="i-chevron-down" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></symbol>
  <symbol id="i-chevron-left" viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></symbol>
  <symbol id="i-chevron-right" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></symbol>
  <symbol id="i-menu" viewBox="0 0 24 24"><path d="M4 8h16M4 15h16"/></symbol>
  <symbol id="i-close" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></symbol>
  <symbol id="i-check" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7"/></symbol>
  <symbol id="i-x" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></symbol>
  <symbol id="i-plus" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></symbol>
  <symbol id="i-sparkle" viewBox="0 0 24 24"><path d="M12 2v20M2 12h20M5 5l14 14M19 5L5 19"/></symbol>
  <symbol id="i-clock" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></symbol>
  <symbol id="i-target" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h18"/></symbol>
  <symbol id="i-arrow-up-circle" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M8 14l4-4 4 4"/></symbol>
  <symbol id="i-plug" viewBox="0 0 24 24"><path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0V8zM12 17v4"/></symbol>
  <symbol id="i-bolt" viewBox="0 0 24 24"><path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"/></symbol>
  <symbol id="i-shield" viewBox="0 0 24 24"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z"/><path d="M8.5 12l2.5 2.5 4.5-5"/></symbol>
  <symbol id="i-window" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 6.5h.01M11 6.5h.01"/></symbol>
  <symbol id="i-paperclip" viewBox="0 0 24 24"><path d="M20 11.5l-8.5 8.5a5 5 0 0 1-7-7L14 3.5a3.5 3.5 0 0 1 5 5L9.5 18a2 2 0 0 1-3-3l8-8"/></symbol>
  <symbol id="i-mic" viewBox="0 0 24 24"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v4"/></symbol>
  <symbol id="i-sliders" viewBox="0 0 24 24"><path d="M4 8h9M17 8h3M4 16h3M11 16h9"/><circle cx="15" cy="8" r="2"/><circle cx="9" cy="16" r="2"/></symbol>
  <symbol id="i-command" viewBox="0 0 24 24"><path d="M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6z"/></symbol>
  <symbol id="i-check-circle" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M8 12.2l2.6 2.6L16 9.4"/></symbol>
</svg>
`;

export function IconSprite() {
  return (
    <div
      aria-hidden="true"
      style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}
      dangerouslySetInnerHTML={{ __html: SPRITE }}
    />
  );
}
