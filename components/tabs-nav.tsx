"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/", label: "Chat" },
  { href: "/history", label: "History" },
  { href: "/gallery", label: "Gallery" },
  { href: "/system", label: "System" },
];

export function TabsNav() {
  const pathname = usePathname();
  return (
    <nav className="sticky top-0 z-10 flex items-center gap-1 border-b bg-background/90 px-4 py-2 backdrop-blur">
      <div className="mr-4 font-semibold">Chat AI Agent</div>
      {TABS.map((tab) => {
        const active =
          tab.href === "/"
            ? pathname === "/" || pathname.startsWith("/chat/")
            : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm transition-colors",
              active
                ? "bg-muted font-medium text-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
