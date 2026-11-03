import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // Must match the GitHub repo name: Pages serves the app from /<repo>/.
  base: '/reverie/',
  plugins: [react(), tailwindcss()],
  build: {
    rolldownOptions: {
      output: {
        // Long-lived vendor code in its own cacheable chunks, so the app chunk
        // stays small and redeploys do not re-download React or motion.
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 3 },
            { name: 'motion', test: /node_modules[\\/](motion|motion-dom|motion-utils|framer-motion)[\\/]/, priority: 2 },
            { name: 'vendor', test: /node_modules[\\/]/, priority: 1 },
          ],
        },
      },
    },
  },
})
