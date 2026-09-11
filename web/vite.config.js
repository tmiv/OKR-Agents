import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  // Dev-only: the browser talks to /api and Vite forwards it to the service,
  // so the API key never leaves service/.env and there is no CORS to fight.
  server: {
    host: '0.0.0.0', // reachable from outside the container / on the LAN
    proxy: { '/api': 'http://localhost:8787' }
  }
});
