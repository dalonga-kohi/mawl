/**
 * Pip, the placeholder beaver from design/mockup. The final art and the Rive state machine replace
 * this (DESIGN.md §8; PLAN tracks the image request). Animations live in styles.css under `.beaver`
 * and stop under reduced motion.
 */
export const MASCOT_STATES = [
  'idle',
  'listening',
  'thinking',
  'working',
  'waiting',
  'done',
  'sleeping',
  'error',
] as const
export type MascotState = (typeof MASCOT_STATES)[number]

export function Beaver({ size = 40, state = 'idle' }: { size?: number; state?: MascotState }) {
  return (
    <svg
      className="beaver"
      width={size}
      height={size}
      viewBox="0 0 120 120"
      data-state={state}
      aria-hidden="true"
    >
      <g className="tailg">
        <rect
          x="70"
          y="86"
          width="40"
          height="22"
          rx="11"
          transform="rotate(-24 90 97)"
          fill="var(--tail)"
        />
        <path
          d="M80 88 l14 14 M86 84 l14 14 M92 82 l12 12 M78 98 l20 -8 M82 104 l20 -8"
          stroke="var(--fur)"
          strokeWidth="1.6"
          opacity=".55"
          strokeLinecap="round"
        />
      </g>
      <g className="bob">
        <ellipse cx="60" cy="88" rx="29" ry="24" fill="var(--fur)" />
        <ellipse cx="60" cy="93" rx="17" ry="15" fill="var(--fur-light)" />
        <ellipse cx="45" cy="107" rx="8" ry="4.5" fill="var(--tail)" />
        <ellipse cx="75" cy="107" rx="8" ry="4.5" fill="var(--tail)" />
        <g className="head">
          <g className="ears">
            <circle cx="38" cy="31" r="8" fill="var(--fur)" />
            <circle cx="38" cy="31" r="4" fill="var(--fur-light)" />
            <circle cx="82" cy="31" r="8" fill="var(--fur)" />
            <circle cx="82" cy="31" r="4" fill="var(--fur-light)" />
          </g>
          <circle cx="60" cy="50" r="27" fill="var(--fur)" />
          <circle cx="44" cy="58" r="4" fill="var(--blush)" opacity=".55" />
          <circle cx="76" cy="58" r="4" fill="var(--blush)" opacity=".55" />
          <ellipse cx="60" cy="61" rx="14" ry="10.5" fill="var(--fur-light)" />
          <g className="eyes-open">
            <circle cx="49" cy="46" r="3.6" fill="var(--nose)" />
            <circle cx="71" cy="46" r="3.6" fill="var(--nose)" />
            <g className="pupils">
              <circle cx="50.2" cy="44.8" r="1.2" fill="var(--tooth)" />
              <circle cx="72.2" cy="44.8" r="1.2" fill="var(--tooth)" />
            </g>
          </g>
          <g
            className="eyes-closed"
            stroke="var(--nose)"
            strokeWidth="2.2"
            strokeLinecap="round"
            fill="none"
          >
            <path d="M45.5 47 q3.5 2.6 7 0" />
            <path d="M67.5 47 q3.5 2.6 7 0" />
          </g>
          <ellipse cx="60" cy="55" rx="5.2" ry="3.6" fill="var(--nose)" />
          <rect x="55.2" y="62" width="9.6" height="9.5" rx="2.2" fill="var(--tooth)" />
          <path d="M60 62.5v8.5" stroke="var(--fur-light)" strokeWidth="1.2" />
          <g className="logbits">
            <rect x="38" y="70" width="44" height="9" rx="4.5" fill="var(--fur-light)" />
            <ellipse cx="38.5" cy="74.5" rx="3" ry="4.5" fill="var(--tail)" />
            <g fill="var(--fur-light)">
              <rect className="chipbit chip-a" x="48" y="66" width="3" height="3" rx="1" />
              <rect className="chipbit chip-b" x="66" y="66" width="3" height="3" rx="1" />
              <rect className="chipbit chip-c" x="57" y="64" width="3" height="3" rx="1" />
            </g>
          </g>
          <g className="sweat">
            <path d="M84 38 q4 6 0 9 q-4 -3 0 -9z" fill="var(--accent)" opacity=".8" />
          </g>
        </g>
        <g className="sign">
          <rect x="84" y="56" width="3" height="30" rx="1.5" fill="var(--tail)" />
          <rect
            x="78"
            y="40"
            width="26"
            height="20"
            rx="5"
            fill="var(--surface)"
            stroke="var(--warn)"
            strokeWidth="2.2"
          />
          <path d="M91 44.5v6.5" stroke="var(--warn)" strokeWidth="3" strokeLinecap="round" />
          <circle cx="91" cy="55" r="1.7" fill="var(--warn)" />
        </g>
        <g className="think">
          <circle cx="88" cy="22" r="3" fill="var(--accent)" />
          <circle cx="96" cy="13" r="4.4" fill="var(--accent)" opacity=".7" />
        </g>
        <g className="sparkle" fill="var(--warn)">
          <path d="M100 30l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" />
          <path d="M18 26l1.4 3.4 3.4 1.4-3.4 1.4L18 35.6l-1.4-3.4-3.4-1.4 3.4-1.4z" />
        </g>
        <g className="zz" fill="var(--text-3)" fontFamily="var(--ff-display)" fontWeight="650">
          <text x="86" y="26" fontSize="14">
            z
          </text>
          <text x="96" y="14" fontSize="10">
            z
          </text>
        </g>
      </g>
    </svg>
  )
}
