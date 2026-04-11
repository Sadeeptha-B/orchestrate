import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
    base: '/orchestrate/',
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
