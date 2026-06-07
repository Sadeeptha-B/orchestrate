import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
    // Served at the domain root on Cloudflare Pages (was '/orchestrate/' on GitHub Pages).
    base: '/',
    plugins: [react(), tailwindcss()],
    server: {
        proxy: {
            '/api/todoist': {
                target: 'https://api.todoist.com',
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/api\/todoist/, ''),
            },
        },
    },
})
