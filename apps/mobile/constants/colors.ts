/**
 * SmartBin visual tokens, mirrored from apps/web/src/App.css (Modern Industrial IoT Dashboard).
 * Existing key names are kept so screens migrate without API changes.
 */
export const Colors = {
  // Backgrounds (web: --bg-deep / --bg-main / --bg-raised)
  bgDeep: '#07111F',
  background: '#0B1728',
  surface: '#101D2E',
  // Surfaces (web: --surface / --surface-raised / --surface-hover)
  surfaceCard: '#142235',
  surfaceCardElevated: '#182A3D',
  surfaceHover: '#1D3045',

  // Borders (web: --border / --border-strong)
  border: '#26394D',
  borderLight: '#203246',
  borderStrong: '#355069',
  borderFocus: '#38BDF8',

  // Text (web: --text-main / --text-soft / --text-muted)
  textPrimary: '#F2F7FB',
  textSecondary: '#C2D0DC',
  textMuted: '#8FA2B5',
  textInverse: '#05261F',

  // Status colors
  success: '#10B981',
  successLight: 'rgba(16, 185, 129, 0.15)',
  successBorder: '#1C5947',

  error: '#EF4444',
  errorLight: 'rgba(239, 68, 68, 0.15)',
  errorBorder: '#713840',

  warning: '#F59E0B',
  warningLight: 'rgba(245, 158, 11, 0.15)',
  warningBorder: '#68522B',

  info: '#38BDF8',
  infoLight: 'rgba(56, 189, 248, 0.15)',
  infoBorder: '#28526B',

  // Brand
  brandPrimary: '#10B981',
  brandPrimaryActive: '#0CA77B',
  brandAccent: '#14B8A6',
  brandHighlight: '#47DBA8',
  cyan: '#38BDF8',

  // Buttons (web: gradient #27D5A0 -> #10B981 with dark text)
  buttonPrimaryBg: '#10B981',
  buttonPrimaryBgPressed: '#0CA77B',
  buttonPrimaryText: '#05261F',
  buttonSecondaryBg: '#17283A',
  buttonSecondaryBorder: '#334B60',
  buttonDisabledBg: '#26394D',
  buttonDisabledText: '#8FA2B5',

  overlay: 'rgba(3, 9, 18, 0.74)',
};

/** Badge palettes copied from web status classes (.badge-normal, .badge-monitor, ...). */
export const Tones = {
  normal: { text: '#75E7BB', bg: '#12382F', border: '#1C5947', solid: '#10B981' },
  monitor: { text: '#FFD07A', bg: '#3A301E', border: '#68522B', solid: '#F59E0B' },
  nearlyFull: { text: '#FFB185', bg: '#3E2A20', border: '#70452E', solid: '#F97316' },
  critical: { text: '#FF9B9B', bg: '#3C252B', border: '#713840', solid: '#EF4444' },
  info: { text: '#87D9FA', bg: '#153247', border: '#28526B', solid: '#38BDF8' },
  neutral: { text: '#A8C4D7', bg: '#1D3040', border: '#39566B', solid: '#8FA2B5' },
} as const;

export type ToneName = keyof typeof Tones;
