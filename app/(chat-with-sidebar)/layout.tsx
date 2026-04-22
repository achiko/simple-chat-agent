import { Suspense } from "react";
import { ChatSidebar } from "@/components/chat-sidebar";
import { FloatingSidebarTrigger } from "@/components/chat-sidebar/floating-trigger";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

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
      <SidebarInset className="relative">
        <FloatingSidebarTrigger className="absolute top-3 left-3 z-20 bg-background/80 shadow-sm backdrop-blur" />
        {children}
      </SidebarInset>
    </SidebarProvider>
  );
}
