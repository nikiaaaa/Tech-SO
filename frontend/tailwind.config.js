/** White Factory design tokens (from the TechSO spec). */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: '#F7F8FA',
        surface: '#FFFFFF',
        line: '#E5E7EB',
        ink: '#172033',
        muted: '#667085',
        primary: { DEFAULT: '#2563EB', 50: '#EFF4FF', 100: '#DBE6FE', 600: '#2563EB', 700: '#1D4ED8' },
        ok: { DEFAULT: '#16A34A', 50: '#ECFDF3', 100: '#D3F8E0' },
        warn: { DEFAULT: '#D97706', 50: '#FFF7E6', 100: '#FDEBC8' },
        crit: { DEFAULT: '#DC2626', 50: '#FEF0F0', 100: '#FBD5D5' },
      },
      fontFamily: { sans: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'] },
      borderRadius: { DEFAULT: '4px', md: '6px', lg: '8px' },
      boxShadow: { card: '0 1px 2px rgba(16,24,40,.05)', pop: '0 8px 24px rgba(16,24,40,.12)' },
    },
  },
  plugins: [],
}
