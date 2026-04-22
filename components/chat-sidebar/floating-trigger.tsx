"use client";

import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar";

export function FloatingSidebarTrigger({ className }: { className?: string }) {
  const { state, isMobile } = useSidebar();
  if (state === "expanded" && !isMobile) return null;
  return <SidebarTrigger className={className} />;
}
