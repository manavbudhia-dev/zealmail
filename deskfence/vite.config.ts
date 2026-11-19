import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// main.js loads dist/renderer/index.html with loadFile(), so asset paths must be relative.
export default defineConfig({
  plugins: [react()],
  base: './',
  server: { port: 5173, strictPort: true },
  build: {
    outDir: 'dist/renderer',
    emptyOutDir: true,
  },
});
