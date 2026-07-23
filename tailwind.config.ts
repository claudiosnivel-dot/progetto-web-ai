import type { Config } from 'tailwindcss';
import { colors, spacing, typography, borderRadius } from './src/ui/theme/tokens';

// La theme di Tailwind DERIVA dai design token (unica sorgente di verità): gli
// stessi oggetti importati sono assegnati a theme.extend, così theme.extend.colors
// è deep-equal a tokens.colors e nessuna palette è riscritta a mano qui.
// Import relativo (non alias @) perché jiti/vitest risolvono dalla radice del repo.
const config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors,
      spacing,
      fontFamily: typography.fontFamily,
      fontSize: typography.fontSize,
      borderRadius,
    },
  },
  plugins: [],
} satisfies Config;

export default config;
