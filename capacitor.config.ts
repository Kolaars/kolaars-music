import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'app.kolaars.music',
  appName: 'Kolaars Music',
  webDir: 'out/mobile',
  android: {
    backgroundColor: '#0b0b10',
    allowMixedContent: false,
    webContentsDebuggingEnabled: true
  },
  server: {
    androidScheme: 'https'
  }
}

export default config
