import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.repass.app',
  appName: 'Re-Pass',
  webDir: 'build',
  server: {
    url: 'https://viniferous-demeritoriously-leandra.ngrok-free.dev',
    cleartext: true
  }
};

export default config;
