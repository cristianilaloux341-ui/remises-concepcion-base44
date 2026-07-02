import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import base44 from '@base44/vite-plugin'

export default defineConfig({
  plugins: [react(), base44()],
  base: './', // CRUCIAL para Capacitor: permite que los assets se carguen correctamente desde el sistema de archivos local de Android (file:///)
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true, // Habilitar sourcemaps para depurar en Android
    minify: false,   // Desactivar minificación temporalmente para ver el código real en lugar de "Q.find"
  }
})