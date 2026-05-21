import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  server: {
    host: '0.0.0.0',
    port: Number(process.env.WEB_PORT || 5173),
    proxy: {
      '/api': {
        target: 'http://localhost:4399',
        ws: true,
      },
      '/media': 'http://localhost:4399'
    }
  }
});
