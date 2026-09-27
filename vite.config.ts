import { defineConfig } from 'vite';

export default defineConfig(() => ({
  // Relative asset URLs, so the same build works wherever it is hosted:
  // GitHub Pages (www.vitormach.dev/antivirus-95/), any other sub-path, or a
  // desktop wrapper.
  base: './',
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsInlineLimit: 0,
  },
  server: {
    port: 5173,
    host: true,
    // Never pop a browser tab on the host: the owner runs the game and any
    // automated check connects to the printed URL itself.
    open: false,
  },
  preview: {
    port: 4173,
  },
}));
