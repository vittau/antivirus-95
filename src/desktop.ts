/**
 * Hooks the desktop shell (electron/preload.cjs) exposes to the page. Absent
 * on the web, so anything desktop-only checks for it first.
 */
export interface DesktopBridge {
  quit(): void;
}

export const desktop: DesktopBridge | undefined = (
  window as unknown as { antivirusDesktop?: DesktopBridge }
).antivirusDesktop;
