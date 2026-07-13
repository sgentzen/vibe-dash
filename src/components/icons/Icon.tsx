export type IconName = "palette" | "sun" | "moon" | "chevronLeft" | "alert";

// Minimal, recognizable 24x24 line outlines. Each entry is a list of subpaths so
// multi-stroke glyphs (e.g. the palette dots) render cleanly with round caps.
const PATHS: Record<IconName, string[]> = {
  palette: [
    "M12 3a9 9 0 1 0 0 18 2 2 0 0 0 2-2 2 2 0 0 1 2-2h1a4 4 0 0 0 4-4 8 8 0 0 0-9-8Z",
    "M7.5 10.5h.01",
    "M10.5 7.5h.01",
    "M14.5 7.5h.01",
  ],
  sun: [
    "M12 4V2 M12 22v-2 M4 12H2 M22 12h-2 M5.6 5.6 4.2 4.2 M19.8 19.8l-1.4-1.4 M18.4 5.6l1.4-1.4 M4.2 19.8l1.4-1.4",
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z",
  ],
  moon: ["M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"],
  chevronLeft: ["M15 18l-6-6 6-6"],
  alert: [
    "M12 9v4",
    "M12 17h.01",
    "M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z",
  ],
};

interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  title?: string;
}

/**
 * Inline-SVG icon set — no dependency. Decorative uses omit `title` and get
 * `aria-hidden`; meaningful uses pass `title` → `role="img"` + `<title>`.
 * `stroke` inherits `currentColor` by default so icons follow theme/accent.
 */
export function Icon({ name, size = 16, color = "currentColor", title }: Readonly<IconProps>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
    >
      {title && <title>{title}</title>}
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
