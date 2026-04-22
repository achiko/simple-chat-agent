import { Suspense } from "react";
import { ChatSidebar } from "@/components/chat-sidebar";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";

export default function ChatWithSidebarLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SidebarProvider>
      <Suspense fallback={null}>
        <ChatSidebar />
      </Suspense>
      <SidebarInset>
        <div className="flex items-center gap-2 border-b bg-background px-3 py-1.5">
          <SidebarTrigger />
          <span className="text-xs text-muted-foreground">Chat history</span>
        </div>
        <div className="flex-1">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
