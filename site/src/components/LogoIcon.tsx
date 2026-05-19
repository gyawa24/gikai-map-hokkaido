import type { SVGProps } from "react";

type LogoIconProps = SVGProps<SVGSVGElement> & {
  decorative?: boolean;
  title?: string;
};

export default function LogoIcon({
  decorative = false,
  title = "地方議会ドットコム アイコン",
  className,
  ...props
}: LogoIconProps) {
  const accessibilityProps = decorative
    ? { "aria-hidden": true }
    : { role: "img", "aria-label": title };

  return (
    <svg
      viewBox="0 0 64 64"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      fill="none"
      {...accessibilityProps}
      {...props}
    >
      <path d="M22 10 10 2m32 8L54 2" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round" />
      <rect x="10" y="14" width="44" height="34" rx="5" stroke="currentColor" strokeWidth="4.5" />
      <path d="M23 56h18M27 48v8m10-8v8" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round" />
      <circle cx="24" cy="29" r="3.5" fill="currentColor" />
      <circle cx="40" cy="29" r="3.5" fill="currentColor" />
      <path d="M23 37c2.5 2.5 5.5 3.5 9 3.5s6.5-1 9-3.5" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round" />
    </svg>
  );
}
