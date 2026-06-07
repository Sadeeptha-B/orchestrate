import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
    // Served at the domain root on Cloudflare Pages (was '/orchestrate/' on GitHub Pages).
    base: '/',
    plugins: [react(), tailwindcss()],
    // No dev proxy: Todoist traffic now goes through the Cloudflare Pages Function at /api/todoist/*
    // (which injects the server-held token). Run `wrangler pages dev` for the full stack in dev;
    // plain `npm run dev` doesn't serve Functions. See docs/deployment.md Part D.
})
