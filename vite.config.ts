import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: process.env.NODE_ENV === 'production' ? '/streaming/avatar/' : '/', // Adjusted base path
  server: {
    host: '0.0.0.0',
  },
});