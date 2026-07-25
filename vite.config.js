import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
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
