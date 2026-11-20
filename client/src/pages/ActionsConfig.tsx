import { useEffect, useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, Bot, Globe, Shield, History, Loader2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

type Caps = {
  lenoryActions: boolean;
  browserAutomation: boolean;
  requireApprovalForSensitive: boolean;
};

type TaskRow = {
  id: string;
  description: string;
  status: string;
  createdAt: string;
  completedAt: string | null;
  error: string | null;
};

export default function ActionsConfig() {
  const { toast } = useToast();
  const [caps, setCaps] = useState<Caps>({
    lenoryActions: false,
    browserAutomation: false,
    requireApprovalForSensitive: true,
  });
  const [saving, setSaving] = useState(false);
  const [avail, setAvail] = useState<{ browserAutomation?: boolean } | null>(null);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiRequest("GET", "/api/capabilities");
        const data = await res.json();
        if (data?.availability) setAvail(data.availability);
        if (data?.capabilities) {
          setCaps((c) => ({
            ...c,
            lenoryActions: !!data.capabilities.lenoryActions,
            browserAutomation: !!data.capabilities.browserAutomation,
            requireApprovalForSensitive: data.capabilities.requireApprovalForSensitive !== false,
          }));
        }
      } catch {}
      try {
        const res = await apiRequest("GET", "/api/actions/tasks");
        const data = await res.json();
        setTasks(data?.tasks || []);
      } catch {
        setTasks([]);
      } finally {
        setLoadingTasks(false);
      }
    })();
  }, []);

  const save = async (next: Caps) => {
    setCaps(next);
    setSaving(true);
    try {
      await apiRequest("PUT", "/api/capabilities", next);
      toast({ title: "Actions settings saved" });
    } catch {
      toast({ title: "Could not save", description: "Try again in a moment.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground pb-24">
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b px-4 py-3 flex items-center gap-3">
        <Link href="/capabilities">
          <button className="p-2 rounded-full hover:bg-muted" aria-label="Back">
            <ArrowLeft className="w-5 h-5" />
          </button>
        </Link>
        <h1 className="text-lg font-semibold flex-1 flex items-center gap-2">
          <Bot className="w-5 h-5" /> LENORY ACTIONS
        </h1>
        {saving && <span className="text-xs text-muted-foreground">Saving…</span>}
      </div>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-8">
        <section>
          <h2 className="text-sm font-medium text-muted-foreground mb-3">General</h2>
          <Card>
            <CardContent className="p-0 divide-y">
              <Row
                icon={<Bot className="w-5 h-5" />}
                title="Enable LENORY ACTIONS"
                desc="Master switch. When off, chat cannot use browser or action tools."
                on={caps.lenoryActions}
                onToggle={() => {
                  const next = { ...caps, lenoryActions: !caps.lenoryActions };
                  if (!next.lenoryActions) next.browserAutomation = false;
                  save(next);
                }}
              />
              <div className="px-4 py-3 text-sm text-muted-foreground leading-relaxed">
                Ask in normal chat, for example: “Open example.com, summarize the page, and take a screenshot.”
                LENORY creates a task, the worker runs a remote browser, and results appear in the same conversation.
              </div>
            </CardContent>
          </Card>
        </section>

        <section>
          <h2 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
            <Globe className="w-4 h-4" /> Browser automation
          </h2>
          <Card>
            <CardContent className="p-0 divide-y">
              <Row
                icon={<Globe className="w-5 h-5" />}
                title="Browser automation"
                desc={
                  avail && avail.browserAutomation === false
                    ? "Server has not detected Browserbase/Playwright yet. Set BROWSERBASE_API_KEY on Render, enable this toggle, then ask LENORY to open a public URL."
                    : "Open public sites, click, fill forms, read pages, screenshots. Private/internal URLs are blocked."
                }
                on={caps.browserAutomation && caps.lenoryActions}
                onToggle={() => {
                  if (!caps.lenoryActions) {
                    toast({ title: "Enable ACTIONS first", description: "Turn on the master switch above." });
                    return;
                  }
                  save({ ...caps, browserAutomation: !caps.browserAutomation });
                }}
              />
              <div className="px-4 py-3 text-sm text-muted-foreground space-y-1">
                <p>Supported: open session, navigate, click, fill, select, extract, screenshot, human handoff.</p>
                <p>Blocked: localhost, private IPs, cloud metadata, non-http(s) schemes.</p>
                <p>Your phone does not need to stay on — the browser runs on the server worker.</p>
              </div>
            </CardContent>
          </Card>
        </section>

        <section>
          <h2 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
            <Shield className="w-4 h-4" /> Permissions
          </h2>
          <Card>
            <CardContent className="p-0 divide-y">
              <Row
                icon={<Shield className="w-5 h-5" />}
                title="Require approval for sensitive actions"
                desc="Submitting forms, publishing, or sending messages should wait for your confirmation card."
                on={caps.requireApprovalForSensitive}
                onToggle={() => save({ ...caps, requireApprovalForSensitive: !caps.requireApprovalForSensitive })}
              />
            </CardContent>
          </Card>
        </section>

        <section>
          <h2 className="text-sm font-medium text-muted-foreground mb-3">Connected accounts</h2>
          <Card>
            <CardContent className="p-4 text-sm text-muted-foreground">
              No OAuth integrations are live yet. Prefer official APIs when added — passwords will never be stored in plaintext or sent to the model.
            </CardContent>
          </Card>
        </section>

        <section>
          <h2 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
            <History className="w-4 h-4" /> Task history
          </h2>
          <Card>
            <CardContent className="p-0 divide-y">
              {loadingTasks && (
                <div className="px-4 py-6 flex justify-center text-muted-foreground">
                  <Loader2 className="w-5 h-5 animate-spin" />
                </div>
              )}
              {!loadingTasks && tasks.length === 0 && (
                <div className="px-4 py-4 text-sm text-muted-foreground">No action tasks yet.</div>
              )}
              {tasks.map((t) => (
                <div key={t.id} className="px-4 py-3 text-sm">
                  <div className="font-medium truncate">{t.description || t.id}</div>
                  <div className="text-muted-foreground text-xs mt-0.5">
                    {t.status}
                    {t.createdAt ? ` · ${new Date(t.createdAt).toLocaleString()}` : ""}
                    {t.error ? ` · ${t.error.slice(0, 80)}` : ""}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  );
}

function Row({
  icon,
  title,
  desc,
  on,
  onToggle,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <div className="mt-0.5 text-muted-foreground">{icon}</div>
      <div className="flex-1 min-w-0">
        <div className="font-medium">{title}</div>
        <div className="text-sm text-muted-foreground">{desc}</div>
      </div>
      <Switch checked={on} onCheckedChange={onToggle} />
    </div>
  );
}
