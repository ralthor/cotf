/** Small stroke icons (24×24 grid), coloured by `currentColor`. Decorative: label the button instead. */
const PATHS = {
  first: 'M11 7l-5 5 5 5M18 7l-5 5 5 5',
  prev: 'M15 6l-6 6 6 6',
  next: 'M9 6l6 6-6 6',
  last: 'M6 7l5 5-5 5M13 7l5 5-5 5',
  play: 'M8 5.5v13l10.5-6.5z',
  pause: 'M9 5.5v13M15 5.5v13',
  flip:'M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4',
  up: 'M12 19V5M6 11l6-6 6 6',
  chevronDown: 'M6 9l6 6 6-6',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

/** Spinning ring for "working on it" states. */
export function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}
