/**
 * brand — the skin toggle. The Unicity brand (dark field, orange accent,
 * Anton + Inter) is the default; one click wears Astrid's original colours
 * (teal/violet, Space Grotesk + Inter) instead. Pure token swap: an
 * attribute on <html> and a lazily loaded font bundle, persisted in
 * localStorage. An inline head script applies the attribute before first
 * paint so nobody ever sees the wrong colours flash.
 */

const KEY = 'site-brand';

let fontsLoaded = false;

async function loadAstridFonts(): Promise<void> {
  if (fontsLoaded) return;
  fontsLoaded = true;
  // The alternative skin's fonts only ever download for whoever flips the
  // switch — default visitors get Anton/Inter/Geist Mono statically from
  // the layout (Inter is shared: it's the body face of both skins).
  await Promise.all([
    import('@fontsource-variable/space-grotesk/index.css'),
    import('@fontsource/ibm-plex-mono/400.css'),
    import('@fontsource/ibm-plex-mono/500.css'),
  ]);
}

export function currentBrand(): 'astrid' | 'unicity' {
  return document.documentElement.dataset.brand === 'unicity' ? 'unicity' : 'astrid';
}

export function setBrand(brand: 'astrid' | 'unicity'): void {
  if (brand === 'unicity') {
    document.documentElement.dataset.brand = 'unicity';
  } else {
    delete document.documentElement.dataset.brand;
    void loadAstridFonts();
  }
  try {
    localStorage.setItem(KEY, brand);
  } catch {
    /* private mode — the choice just won't persist */
  }
  document.dispatchEvent(new CustomEvent('brandchange', { detail: brand }));
}

/** Wire the toggle button (it lives in the HUD drawer, which persists across pages). */
export function initBrandToggle(btn: HTMLButtonElement): void {
  const label = () => {
    btn.textContent = currentBrand() === 'unicity' ? '⇄ astrid' : '⇄ unicity';
  };
  // A persisted opt-out was already applied pre-paint by the head script;
  // it still owes the fonts.
  if (currentBrand() === 'astrid') void loadAstridFonts();
  label();
  btn.addEventListener('click', () => {
    setBrand(currentBrand() === 'unicity' ? 'astrid' : 'unicity');
    label();
  });
}
