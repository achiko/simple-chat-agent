"use client";

import { formatDistanceToNow } from "date-fns";
import Link from "next/link";
import { usePathname } from "next/navigation";
import useSWR from "swr";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import type { ChatSession } from "@/lib/db/schema";
import { cn } from "@/lib/utils";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

type Payload = { sessions: ChatSession[] };

const PRIMARY_NAV = [
  { href: "/", label: "Chat" },
  { href: "/history", label: "History" },
  { href: "/gallery", label: "Gallery" },
  { href: "/system", label: "System" },
];

function isPrimaryActive(pathname: string, href: string) {
  if (href === "/") {
    return pathname === "/" || pathname.startsWith("/chat/");
  }
  return pathname.startsWith(href);
}

export function ChatSidebar() {
  const pathname = usePathname();
  const { data, isLoading } = useSWR<Payload>("/api/sessions", fetcher, {
    refreshInterval: 5000,
  });

  return (
    <Sidebar>
      <SidebarHeader>
        <div className="flex items-center justify-between gap-2 px-1 pt-1 pb-2">
          <span className="text-sm font-semibold">Chat AI Agent</span>
          <SidebarTrigger className="-mr-1" />
        </div>
        <Link
          className={cn(
            "flex items-center justify-center rounded-md border border-sidebar-border bg-sidebar-accent px-3 py-2 text-sm font-medium text-sidebar-accent-foreground transition-colors hover:bg-sidebar-primary hover:text-sidebar-primary-foreground",
            pathname === "/" &&
              "bg-sidebar-primary text-sidebar-primary-foreground"
          )}
          href="/"
        >
          + New chat
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            {PRIMARY_NAV.map((item) => {
              const active = isPrimaryActive(pathname, item.href);
              return (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    asChild
                    isActive={active}
                    className={cn(
                      active &&
                        "bg-sidebar-primary font-semibold text-sidebar-primary-foreground hover:bg-sidebar-primary hover:text-sidebar-primary-foreground data-[active=true]:text-sidebar-primary-foreground"
                    )}
                  >
                    <Link href={item.href}>
                      <span className="text-sm">{item.label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
        <SidebarGroup>
          <SidebarGroupLabel>Recent</SidebarGroupLabel>
          <SidebarMenu>
            {isLoading && !data ? (
              <div className="px-2 py-1 text-xs text-muted-foreground">
                Loading…
              </div>
            ) : null}
            {data && data.sessions.length === 0 ? (
              <div className="px-2 py-1 text-xs text-muted-foreground">
                No chats yet. Start typing below.
              </div>
            ) : null}
            {data?.sessions.map((s) => {
              const href = `/chat/${s.id}`;
              const active = pathname === href;
              return (
                <SidebarMenuItem key={s.id}>
                  <SidebarMenuButton asChild isActive={active}>
                    <Link href={href} title={s.title}>
                      <span className="flex w-full flex-col overflow-hidden">
                        <span className="truncate text-sm">{s.title}</span>
                        <span className="truncate text-[10px] text-muted-foreground">
                          {formatDistanceToNow(new Date(s.updatedAt), {
                            addSuffix: true,
                          })}
                        </span>
                      </span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
