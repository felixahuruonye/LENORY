import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useAiStatus, fmtCountdown } from "@/hooks/useAiStatus";
import { Globe, FileText, FolderOpen, PenLine, Brain, Briefcase, ChevronRight } from "lucide-react";

type Caps = { webSearch: boolean; fileCreation: boolean; knowledgeBase: boolean; kbWrite: boolean; memory: boolean; projects: boolean };
const ROWS: { key: keyof Caps; title: string; desc: string; icon: any }[] = [
  { key: "webSearch", title: "Web search", desc: "Look things up online when it needs current facts", icon: Globe },
  { key: "fileCreation", title: "File creation", desc: "Make real PDF, Word, PowerPoint, Excel and more", icon: FileText },
  { key: "knowledgeBase", title: "Read Knowledge Base", desc: "Use your saved notes and folders", icon: FolderOpen },
  { key: "kbWrite", title: "Write to Knowledge Base", desc: "Create folders and save notes for you", icon: PenLine },
  { key: "memory", title: "Memory", desc: "Remember things you ask it to remember", icon: Brain },
  { key: "projects", title: "Projects", desc: "Read and add to your Project Workspace", icon: Briefcase },
];

export default function ToolsMiniPage({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const ai = useAiStatus();
  const { data } = useQuery<{ capabilities: Caps }>({
    queryKey: ["/api/capabilities"],
    queryFn: async () => (await apiRequest("GET", "/api/capabilities")).json(),
    enabled: open,
  });
  const caps = data?.capabilities;
  const toggle = async (key: keyof Caps, on: boolean) => {
    qc.setQueryData(["/api/capabilities"], (old: any) => (old ? { ...old, capabilities: { ...old.capabilities, [key]: on } } : old));
    try {
      const r = await apiRequest("PUT", "/api/capabilities", { [key]: on });
      if (!r.ok) throw new Error("failed");
    } catch {
      toast({ title: "Could not save", description: "Try again.", variant: "destructive" });
    }
    qc.invalidateQueries({ queryKey: ["/api/capabilities"] });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm rounded-2xl p-0 overflow-hidden" data-testid="tools-mini-page">
        <DialogHeader className="px-5 pt-5 pb-2">
          <DialogTitle>LENORY Tools</DialogTitle>
          <DialogDescription>Choose what LENORY is allowed to do for you.</DialogDescription>
        </DialogHeader>
        <div className="divide-y divide-border/50">
          {ROWS.map(({ key, title, desc, icon: Icon }) => {
            const locked = key === "webSearch" && ai.webExhausted;
            return (
              <div key={key} className="flex items-center gap-3 px-5 py-3">
                <Icon className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{title}</div>
                  <div className="text-xs text-muted-foreground">{locked ? `Resting - back in ${fmtCountdown(ai.webLeft)}` : desc}</div>
                </div>
                <Switch checked={!!caps?.[key] && !locked} disabled={!caps || locked} onCheckedChange={(v) => toggle(key, v)} data-testid={`tools-switch-${key}`} />
              </div>
            );
          })}
        </div>
        <Link href="/capabilities" onClick={() => onOpenChange(false)}>
          <div className="flex items-center justify-between px-5 py-3 text-sm text-primary border-t border-border/50 cursor-pointer hover:bg-muted/40">
            <span>All tool settings</span><ChevronRight className="w-4 h-4" />
          </div>
        </Link>
      </DialogContent>
    </Dialog>
  );
}
