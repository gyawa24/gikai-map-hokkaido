"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Props = {
  href: string;
  children: React.ReactNode;
};

export default function NavLink({ href, children }: Props) {
  const pathname = usePathname();
  const isActive = pathname === href;

  return (
    <Link
      href={href}
      className={`text-sm px-3 py-1 rounded-md transition-colors ${
        isActive
          ? "bg-white/20 text-white font-semibold"
          : "text-blue-100 hover:bg-white/10 hover:text-white"
      }`}
    >
      {children}
    </Link>
  );
}
