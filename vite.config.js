import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
    // Served from https://gmfennema.github.io/osrs-flipping-utility/, so assets
    // must be requested relative to that subpath rather than the domain root.
    base: '/osrs-flipping-utility/',
    plugins: [tailwindcss()],
    // Honour PORT so two dev servers can run side by side; Vite does not read it
    // on its own.
    server: { port: Number(process.env.PORT) || 5173 },
    preview: { port: Number(process.env.PORT) || 4173 },
    build: {
        target: 'es2022',
        sourcemap: true
    },
    test: {
        environment: 'node',
        include: ['test/**/*.test.js']
    }
});
