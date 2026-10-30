import { useEffect, useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, Globe, FileText, Brain, FolderOpen, Sparkles, Wrench, Terminal, Briefcase } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

type Caps = {
  webSearch: boolean;
  fileCreation: boolean;
  artifacts: boolean;
  memory: boolean;
  knowledgeBase: boolean;
  toolAccess: "auto" | "on_demand" | "always";
  kbWrite: boolean;
  codeExecution: boolean;
  projects: boolean;
};
type Avail = { codeExecution: boolean; imageGeneration: boolean; webSearch: boolean };

const DEFAULTS: Caps = {
  webSearch: true,
  fileCreation: true,
  artifacts: true,
  memory: true,
  knowledgeBase: true,
  toolAccess: "auto",
  kbWrite: true,
  codeExecution: false,
  projects: true,
};

export default function Capabilities() {
  const { toast } = useToast();
  const [caps, setCaps] = useState<Caps>(DEFAULTS);
  const [saving, setSaving] = useState(false);
  const [avail, setAvail] = useState<Avail | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiRequest("GET", "/api/capabilities");
        const data = await res.json();
        if (data?.availability) setAvail(data.availability);
        if (data?.capabilities) {
          setCaps((c) => ({ ...c, ...data.capabilities }));
        }
      } catch {}
    })();
  }, []);

  const save = async (next: Caps) => {
    setCaps(next);
    setSaving(true);
    try {
      await apiRequest("PUT", "/api/capabilities", next);
      toast({ title: "Capabilities updated" });
    } catch {
      toast({ title: "Saved on this device", description: "Server sync failed — will still apply in chat from this device." });
    } finally {
      setSaving(false);
    }
  };

  const toggle = (key: keyof Caps) => {
    const next = { ...caps, [key]: !(caps as any)[key] } as Caps;
    save(next);
  };

  const setMode = (toolAccess: Caps["toolAccess"]) => save({ ...caps, toolAccess });

  return (
    <div className="min-h-screen bg-background text-foreground pb-24">
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b px-4 py-3 flex items-center gap-3">
        <Link href="/settings">
          <button className="p-2 rounded-full hover:bg-muted" aria-label="Back">
            <ArrowLeft className="w-5 h-5" />
          </button>
        </Link>
        <h1 className="text-lg font-semibold flex-1">Capabilities</h1>
        {saving && <span className="text-xs text-muted-foreground">Saving…</span>}
      </div>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-8">
        <section>
          <h2 className="text-sm font-medium text-muted-foreground mb-3">Tools</h2>
          <Card>
            <CardContent className="p-0 divide-y">
              <Row
                icon={<Globe className="w-5 h-5" />}
                title="Web search"
                desc="Search the web when current information is needed"
                on={caps.webSearch}
                onToggle={() => toggle("webSearch")}
              />
              <Row
                icon={<FileText className="w-5 h-5" />}
                title="File creation"
                desc="Create real PDF, DOCX, PPTX, XLSX and other downloadable files"
                on={caps.fileCreation}
                onToggle={() => toggle("fileCreation")}
              />
              <Row
                icon={<Sparkles className="w-5 h-5" />}
                title="Artifacts"
                desc="Show download cards and structured deliverables in chat"
                on={caps.artifacts}
                onToggle={() => toggle("artifacts")}
              />
              <Row
                icon={<FolderOpen className="w-5 h-5" />}
                title="Knowledge Base"
                desc="Read your notebooks and notes during chat"
                on={caps.knowledgeBase}
                onToggle={() => toggle("knowledgeBase")}
              />
              <Row
                icon={<FolderOpen className="w-5 h-5" />}
                title="KB write"
                desc="Allow creating folders and attaching generated files"
                on={caps.kbWrite}
                onToggle={() => toggle("kbWrite")}
              />
              <Row
                icon={<Brain className="w-5 h-5" />}
                title="Memory"
                desc="Use and update memory from chats"
                on={caps.memory}
                onToggle={() => toggle("memory")}
              />
              <Row
                icon={<Briefcase className="w-5 h-5" />}
                title="Projects"
                desc="Let LENORY list your projects and add files and tasks to them"
                on={caps.projects}
                onToggle={() => toggle("projects")}
              />
              <Row
                icon={<Terminal className="w-5 h-5" />}
                title="Code execution"
                desc={avail && !avail.codeExecution ? "Run code in a safe sandbox. Not set up on this server yet (admin: set CODE_SANDBOX_URL), so it cannot run." : "Run code in an isolated sandbox and show the real output"}
                on={caps.codeExecution && (avail ? avail.codeExecution : true)}
                onToggle={() => { if (avail && !avail.codeExecution) { toast({ title: "Sandbox not set up", description: "An admin must set CODE_SANDBOX_URL first." }); return; } toggle("codeExecution"); }}
              />
            </CardContent>
          </Card>
        </section>

        <section>
          <h2 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
            <Wrench className="w-4 h-4" /> Tool access
          </h2>
          <Card>
            <CardContent className="p-0 divide-y">
              {(
                [
                  ["auto", "Auto", "LENORY chooses tools when needed"],
                  ["on_demand", "On demand", "Tools only when the request clearly needs them"],
                  ["always", "Always available", "Tools ready from the start of each message"],
                ] as const
              ).map(([id, title, desc]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setMode(id)}
                  className="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-muted/50"
                >
                  <div className="flex-1">
                    <div className={`font-medium ${caps.toolAccess === id ? "text-primary" : ""}`}>{title}</div>
                    <div className="text-sm text-muted-foreground">{desc}</div>
                  </div>
                  {caps.toolAccess === id && <span className="text-primary text-sm">✓</span>}
                </button>
              ))}
            </CardContent>
          </Card>
          <p className="text-xs text-muted-foreground mt-3 leading-relaxed">
            When you ask Chat or Live AI to research, create files, or use Knowledge Base, the selected model
            receives these tools and must call them to finish the job — not explain how you could do it yourself.
          </p>
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
