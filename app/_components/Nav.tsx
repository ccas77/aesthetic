"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS: Array<{ href: string; label: string; match: RegExp }> = [
  { href: "/", label: "Create", match: /^\/$/ },
  { href: "/books", label: "Books", match: /^\/books/ },
  { href: "/library", label: "Library", match: /^\/library/ },
  { href: "/automation", label: "Automation", match: /^\/automation/ },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <nav className="border-b border-line2 bg-bg">
      <ul className="max-w-5xl mx-auto px-6 md:px-12 flex items-center gap-1 md:gap-2">
        {ITEMS.map((item) => {
          const active = item.match.test(pathname);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={
                  active
                    ? "inline-block px-4 py-3 text-sm font-medium text-ink border-b-2 border-ink -mb-px"
                    : "inline-block px-4 py-3 text-sm text-muted hover:text-ink transition-colors"
                }
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
