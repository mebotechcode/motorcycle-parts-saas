import type { Config } from 'tailwindcss'

// Colours sampled from the Naf's Motor Spares logo (see /brand/BRAND.md)
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        charcoal: { DEFAULT: '#111214', 2: '#1A1C1F', 3: '#26292D' },
        brand: { DEFAULT: '#FF5B14', hover: '#E64D0A' },
        offwhite: '#F5F5F2',
        muted: '#9A9A99',
      },
      fontFamily: {
        display: ['"Barlow Condensed"', '"Arial Narrow"', 'sans-serif'],
        body: ['Inter', 'system-ui', '-apple-system', '"Segoe UI"', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
export default config
