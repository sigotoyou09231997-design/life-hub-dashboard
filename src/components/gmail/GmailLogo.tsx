interface Props {
  size?: number;
  className?: string;
}

/** Gmail's own multicolor envelope mark, used only to indicate "this connects
 * to Gmail" next to the page title and in the bottom QuickActionBar — never
 * as a generic mail/notification glyph, which is what the plain lucide
 * `Mail` icon is for elsewhere in the app. */
export function GmailLogo({ size = 20, className = "" }: Props) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 36" fill="none" className={className} aria-hidden="true">
      <rect x="1" y="1" width="46" height="34" rx="5" fill="white" stroke="#E5E7EB" strokeWidth="1.5" />
      <path d="M5.5 7L24 21.5 42.5 7V10.5L24 25 5.5 10.5V7Z" fill="#EA4335" />
      <path d="M5.5 7C5.5 5.6 6.6 4.5 8 4.5H11V21L5.5 16.7V7Z" fill="#4285F4" />
      <path d="M42.5 7C42.5 5.6 41.4 4.5 40 4.5H37V21L42.5 16.7V7Z" fill="#EA4335" />
      <path d="M5.5 16.7L11 21V31.5H8C6.6 31.5 5.5 30.4 5.5 29V16.7Z" fill="#34A853" />
      <path d="M42.5 16.7L37 21V31.5H40C41.4 31.5 42.5 30.4 42.5 29V16.7Z" fill="#FBBC05" />
    </svg>
  );
}
