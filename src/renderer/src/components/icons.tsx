// Small line icons (24 × 24, drawn with currentColor) for compact toolbar buttons.

type IconProps = { size?: number }

function Svg({ size = 18, children }: IconProps & { children: React.ReactNode }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="icon-svg"
    >
      {children}
    </svg>
  )
}

export const HomeIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M3 11 12 4l9 7" />
    <path d="M5 10v10h5v-6h4v6h5V10" />
  </Svg>
)

export const PlayIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M7 4.5v15l12-7.5z" fill="currentColor" />
  </Svg>
)

export const StopIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" />
  </Svg>
)

export const LoopIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M17 2l3 3-3 3" />
    <path d="M4 11V9a4 4 0 0 1 4-4h12" />
    <path d="M7 22l-3-3 3-3" />
    <path d="M20 13v2a4 4 0 0 1-4 4H4" />
  </Svg>
)

export const MetronomeIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M9 3h6l4 18H5z" />
    <path d="M7.5 15h9" />
    <path d="M12 15 17 6" />
  </Svg>
)

export const UndoIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h11a5 5 0 0 1 0 10h-3" />
  </Svg>
)

export const RedoIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="m15 14 5-5-5-5" />
    <path d="M20 9H9a5 5 0 0 0 0 10h3" />
  </Svg>
)

export const RecordIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="6" fill="currentColor" stroke="none" />
  </Svg>
)

export const ExportIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M12 3v12" />
    <path d="m7 10 5 5 5-5" />
    <path d="M4 17v3h16v-3" />
  </Svg>
)

export const MenuIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M4 6h16M4 12h16M4 18h16" />
  </Svg>
)

export const ChevronDownIcon = (p: IconProps): React.JSX.Element => (
  <Svg size={14} {...p}>
    <path d="m6 9 6 6 6-6" />
  </Svg>
)

export const PencilIcon = (p: IconProps): React.JSX.Element => (
  <Svg {...p}>
    <path d="M4 20h4L19 9l-4-4L4 16z" />
    <path d="m13.5 6.5 4 4" />
  </Svg>
)
