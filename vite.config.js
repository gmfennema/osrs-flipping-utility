import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
    // Served from https://gmfennema.github.io/osrs-flipping-utility/, so assets
    // must be requested relative to that subpath rather than the domain root.
    base: '/osrs-flipping-utility/',
    plugins: [tailwindcss()],
    build: {
        target: 'es2022',
        sourcemap: true
    },
    test: {
        environment: 'node',
        include: ['test/**/*.test.js']
    }
});
