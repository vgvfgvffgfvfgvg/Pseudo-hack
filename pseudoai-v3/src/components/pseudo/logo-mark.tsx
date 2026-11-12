interface LogoMarkProps {
  size?: number;
  className?: string;
}

/** Pseudo brand mark: terminal chevron + cursor on a mint-glow chip. */
export function LogoMark({ size = 32, className }: LogoMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={className}
      role="img"
      aria-label="Pseudo logo"
    >
      <defs>
        <linearGradient id="pseudo-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#12241c" />
          <stop offset="1" stopColor="#070c0a" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="14" fill="url(#pseudo-bg)" />
      <rect
        x="1"
        y="1"
        width="62"
        height="62"
        rx="13"
        fill="none"
        stroke="var(--primary)"
        strokeOpacity="0.45"
        strokeWidth="1.5"
      />
      <path
        d="M17 21 L31 32 L17 43"
        fill="none"
        stroke="var(--primary)"
        strokeWidth="5.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="35" y="39.5" width="13" height="5.5" rx="2.75" fill="var(--primary)" />
    </svg>
  );
}
