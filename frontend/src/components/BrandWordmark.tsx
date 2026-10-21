import "./BrandWordmark.css";

type BrandWordmarkProps = {
  compact?: boolean;
  className?: string;
};

/** Original vector lettering: a sound-wave A, a signal I and drawn Chinese strokes. */
export function BrandWordmark({
  compact = false,
  className = "",
}: BrandWordmarkProps) {
  return (
    <svg
      className={`brand-wordmark${compact ? " brand-wordmark--compact" : ""}${className ? ` ${className}` : ""}`}
      viewBox={compact ? "0 0 48 48" : "0 0 224 48"}
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      {compact ? (
        <>
          <rect className="brand-wordmark-tile" width="48" height="48" rx="14" />
          <g className="brand-wordmark-symbol" transform="translate(5 4) scale(.82)">
            <path d="M4 38 17.8 8.4a2.4 2.4 0 0 1 4.4 0L36 38" />
            <path d="M10 27c3.2-5.5 6.3-5.5 9.5 0s6.3 5.5 9.5 0" />
            <path d="M44 20v18" />
            <path className="brand-wordmark-signal" d="M44 8v3" />
          </g>
        </>
      ) : (
        <>
          <g className="brand-wordmark-ai">
            <path d="M4 38 17.8 8.4a2.4 2.4 0 0 1 4.4 0L36 38" />
            <path d="M10 27c3.2-5.5 6.3-5.5 9.5 0s6.3 5.5 9.5 0" />
            <path d="M44 20v18" />
            <path className="brand-wordmark-signal" d="M44 8v3" />
          </g>
          <g className="brand-wordmark-letters">
            {/* 乐: the lifted first stroke and wave-like dot strokes echo the A. */}
            <path d="M93 6c-7 3-14 4.8-23 6.4" />
            <path d="m70 13-3 13h33" />
            <path d="M84 10v29c0 3-1.4 4-6.8 2.9" />
            <path d="M75 32c-3.4 4.4-7.1 7.5-11 9.3" />
            <path d="M93 32c3.1 2.4 6.4 5.6 9 9" />
            {/* 之: a compact, continuous last stroke. */}
            <path d="m126 5 5.1 4.5" />
            <path d="M114 16h29c-6.9 7.5-14.1 13.8-24.5 20" />
            <path d="m113.5 36 6.5-5c6.4 9 14.5 11.2 28 9.1" />
            {/* 城: deliberately separated strokes stay legible in the narrow sidebar. */}
            <path d="M158 19h14M165 9v28m-9 4 18-6" />
            <path d="M179 16h39M180 16v12c0 6-1.8 10.5-5.6 15" />
            <path d="M180 27h10v11c0 4-1.2 4.8-6.2 3.3" />
            <path d="M199 6c.4 15.7 3.6 31 12.3 36 2.6 1.4 4.4-.2 5.6-7" />
            <path d="M213 23c-4.4 9.2-10.7 15.3-18.7 19" />
            <path d="m208 5 5.1 5" />
          </g>
        </>
      )}
    </svg>
  );
}
