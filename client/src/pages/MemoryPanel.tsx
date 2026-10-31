import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Link } from "wouter";
import { ArrowLeft, Brain, Trash2, Save, Sparkles, BookmarkCheck, SlidersHorizontal } from "lucide-react";

type Fact = { id: string; text: string; createdAt?: string | null };
type Field = { key: string; label: string; hint: string };
type ProfileRes = { prefs: Record<string, string>; fields: Field[]; preview: string };

const when = (iso?: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
};

function SavedMemory() {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<{ facts: Fact[] }>({
    queryKey: ["/api/memory/facts"],
    queryFn: async () => (await apiRequest("GET", "/api/memory/facts")).json(),
  });
  const del = useMutation({
    mutationFn: async (id: string) => { const r = await apiRequest("DELETE", `/api/memory/facts/${id}`); if (!r.ok) throw new Error("failed"); },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/memory/facts"] }),
    onError: () => toast({ title: "Could not delete", description: "Try again in a moment.", variant: "destructive" }),
  });
  const facts = data?.facts || [];
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Everything LENORY has saved about you while chatting, and what it reads before it answers. Ask in chat, e.g. "remember that I study Computing", and it appears here. You can delete anything.
      </p>
      {isLoading ? (
        <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-14 rounded-lg" />)}</div>
      ) : facts.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted-foreground" data-testid="memory-empty">
          <BookmarkCheck className="w-8 h-8 mx-auto mb-2 text-primary/60" />
          Nothing saved yet. Tell LENORY "remember that..." in Chat or Live AI.
        </Card>
      ) : (
        <ul className="space-y-2" data-testid="memory-list">
          {facts.map((f) => (
            <li key={f.id} className="flex items-start gap-3 rounded-xl border border-border/60 bg-card px-4 py-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm leading-relaxed break-words">{f.text}</p>
                {when(f.createdAt) && <p className="text-xs text-muted-foreground mt-1">Saved {when(f.createdAt)}</p>}
              </div>
              <Button size="icon" variant="ghost" className="shrink-0" onClick={() => del.mutate(f.id)} disabled={del.isPending} aria-label="Delete memory" data-testid={`delete-memory-${f.id}`}>
                <Trash2 className="w-4 h-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MemoryPreferences() {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<ProfileRes>({
    queryKey: ["/api/memory/profile"],
    queryFn: async () => (await apiRequest("GET", "/api/memory/profile")).json(),
  });
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  useEffect(() => { if (data && !dirty) setDraft(data.prefs); }, [data, dirty]);
  const save = useMutation({
    mutationFn: async () => { const r = await apiRequest("PUT", "/api/memory/profile", { prefs: draft }); if (!r.ok) throw new Error("failed"); return r.json(); },
    onSuccess: () => { setDirty(false); queryClient.invalidateQueries({ queryKey: ["/api/memory/profile"] }); toast({ title: "Preferences saved", description: "Chat and Live AI will follow them from your next message." }); },
    onError: () => toast({ title: "Could not save", description: "Check your connection and try again.", variant: "destructive" }),
  });
  if (isLoading || !data) return <div className="space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 rounded-lg" />)}</div>;
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        Fill in what you want. LENORY reads this as extra instructions before every reply, in Chat and in Live AI, so it teaches and writes the way you need. Leave a box empty to skip it.
      </p>
      {data.fields.map((f) => (
        <div key={f.key} className="space-y-1.5">
          <label htmlFor={`pref-${f.key}`} className="text-sm font-medium">{f.label}</label>
          <Textarea
            id={`pref-${f.key}`}
            value={draft[f.key] || ""}
            onChange={(e) => { setDraft((d) => ({ ...d, [f.key]: e.target.value.slice(0, 1500) })); setDirty(true); }}
            placeholder={f.hint}
            rows={3}
            className="resize-none"
            data-testid={`pref-${f.key}`}
          />
          <p className="text-[11px] text-muted-foreground text-right">{(draft[f.key] || "").length}/1500</p>
        </div>
      ))}
      <Button onClick={() => save.mutate()} disabled={save.isPending || !dirty} className="w-full sm:w-auto" data-testid="save-preferences">
        <Save className="w-4 h-4 mr-2" />{save.isPending ? "Saving..." : "Save preferences"}
      </Button>
      <Card className="p-4 bg-muted/40">
        <div className="flex items-center gap-2 text-sm font-medium mb-2"><Sparkles className="w-4 h-4 text-primary" />What LENORY reads before every answer</div>
        {data.preview ? <pre className="text-xs whitespace-pre-wrap text-muted-foreground font-sans leading-relaxed">{data.preview}</pre> : <p className="text-xs text-muted-foreground">Nothing yet. Save at least one preference.</p>}
      </Card>
    </div>
  );
}

export default function MemoryPanel() {
  const { user, isLoading: authLoading } = useAuth();
  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5">
      <header className="sticky top-0 z-50 backdrop-blur-xl bg-background/80 border-b border-primary/10">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <Link href="/dashboard">
                <Button variant="ghost" size="icon" aria-label="Back" data-testid="button-back"><ArrowLeft className="h-5 w-5" /></Button>
              </Link>
              <Brain className="h-6 w-6 text-primary" />
              <h1 className="text-xl font-bold">Memory</h1>
            </div>
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
        {authLoading || !user ? (
          <Skeleton className="h-40 rounded-lg" />
        ) : (
          <Tabs defaultValue="saved" className="w-full">
            <TabsList className="grid grid-cols-2 w-full mb-5">
              <TabsTrigger value="saved" data-testid="tab-saved-memory"><BookmarkCheck className="w-4 h-4 mr-1.5" />Saved Memory</TabsTrigger>
              <TabsTrigger value="prefs" data-testid="tab-memory-preference"><SlidersHorizontal className="w-4 h-4 mr-1.5" />Memory Preference</TabsTrigger>
            </TabsList>
            <TabsContent value="saved"><SavedMemory /></TabsContent>
            <TabsContent value="prefs"><MemoryPreferences /></TabsContent>
          </Tabs>
        )}
      </main>
    </div>
  );
}
