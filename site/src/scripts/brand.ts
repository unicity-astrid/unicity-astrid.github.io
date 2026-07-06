/**
 * brand — the skin toggle. Astrid's own colours by default; one click wears
 * Unicity's brand (dark field, orange accent, Anton + Geist) instead. Pure token swap:
 * an attribute on <html> and a lazily loaded font bundle, persisted in
 * localStorage. An inline head script applies the attribute before first
 * paint so a returning visitor never sees the wrong colours flash.
 */

const KEY = 'site-brand';

let fontsLoaded = false;

async function loadUnicityFonts(): Promise<void> {
  if (fontsLoaded) return;
  fontsLoaded = true;
  // The fonts only ever download for visitors who flip the switch.
  await Promise.all([
    import('@fontsource/anton/400.css'),
    import('@fontsource/geist-sans/400.css'),
    import('@fontsource/geist-sans/600.css'),
    import('@fontsource/geist-mono/400.css'),
  ]);
}

export function currentBrand(): 'astrid' | 'unicity' {
  return document.documentElement.dataset.brand === 'unicity' ? 'unicity' : 'astrid';
}

export function setBrand(brand: 'astrid' | 'unicity'): void {
  if (brand === 'unicity') {
    document.documentElement.dataset.brand = 'unicity';
    void loadUnicityFonts();
  } else {
    delete document.documentElement.dataset.brand;
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
  // A persisted choice was already applied pre-paint by the head script;
  // it still owes the fonts.
  if (currentBrand() === 'unicity') void loadUnicityFonts();
  label();
  btn.addEventListener('click', () => {
    setBrand(currentBrand() === 'unicity' ? 'astrid' : 'unicity');
    label();
  });
}
