/**
 * TrustBadgeRow — row of technical-trust indicators (inline SVG icons only).
 * Deliberately not customer/social-proof logos: Vouch has no case studies to
 * show yet, and fabricating them would be exactly the kind of sock-puppet
 * "trust" signal the product itself is built to detect. These are factual,
 * verifiable claims about the system.
 */

type TrustBadge = {
  label: string;
  icon: "shield" | "link" | "bolt" | "repeat";
};

const BADGES: TrustBadge[] = [
  { label: "ERC-8004 native", icon: "shield" },
  { label: "On-chain verifiable (Base)", icon: "link" },
  { label: "Cached, sub-100ms reads", icon: "bolt" },
  { label: "Idempotent x402 settlement", icon: "repeat" },
];

export function TrustBadgeRow() {
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-4">
      {BADGES.map((badge) => (
        <div key={badge.label} className="flex items-center gap-2 text-sm text-zinc-600">
          <Icon name={badge.icon} />
          <span>{badge.label}</span>
        </div>
      ))}
    </div>
  );
}

function Icon({ name }: { name: TrustBadge["icon"] }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className: "shrink-0 text-zinc-400",
  };

  switch (name) {
    case "shield":
      return (
        <svg {...common}>
          <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" />
          <path d="M9 12l2 2 4-4" />
        </svg>
      );
    case "link":
      return (
        <svg {...common}>
          <path d="M9 15l6-6" />
          <path d="M10 6l1-1a4 4 0 015.7 5.7l-1.4 1.4" />
          <path d="M14 18l-1 1a4 4 0 01-5.7-5.7l1.4-1.4" />
        </svg>
      );
    case "bolt":
      return (
        <svg {...common}>
          <path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z" />
        </svg>
      );
    case "repeat":
      return (
        <svg {...common}>
          <path d="M4 9a8 8 0 0113.9-5.3L20 6" />
          <path d="M20 4v4h-4" />
          <path d="M20 15a8 8 0 01-13.9 5.3L4 18" />
          <path d="M4 20v-4h4" />
        </svg>
      );
  }
}
