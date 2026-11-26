import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Vercel dùng '/', GitHub Pages dùng '/BMEdu/'
  base: process.env.VITE_BASE || '/',
  plugins: [react()],
});
