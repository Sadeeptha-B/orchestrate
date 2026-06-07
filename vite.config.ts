import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
    base: '/orchestrate/',
    plugins: [react(), tailwindcss(), cloudflare()],
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