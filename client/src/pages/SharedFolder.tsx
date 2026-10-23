import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getAuthHeaders } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, FolderOpen, FileText, Download, ArrowLeft, LogIn } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface SharedFile {
  id: string;
  name: string;
  file_type: string;
  file_size: number;
  created_at: string;
  extracted_text?: string;
  preview_notes?: string;
}

function parsePreview(file: SharedFile): { title: string; body: string } {
  const raw = file.preview_notes || file.extracted_text || "";
  try {
    const j = JSON.parse(raw);
    if (j && typeof j === "object") {
      return {
        title: file.name,
        body: j.formattedNotes || j.transcript || "",
      };
    }
  } catch {}
  return { title: file.name, body: raw };
}

export default function SharedFolder() {
  const { code } = useParams<{ code: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user, isLoading: authLoading } = useAuth();

  const { data, isLoading, error } = useQuery({
    queryKey: ["/api/kb/shared", code, user?.id || "anon"],
    queryFn: async () => {
      // Public folders work without auth; send token when available
      const headers = user ? await getAuthHeaders() : {};
      const res = await fetch(`/api/kb/shared/${code}`, { headers });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err: any = new Error(body.message || "Failed to load shared notebook");
        err.status = res.status;
        err.requiresAuth = body.requiresAuth || body.error === "LOGIN_REQUIRED";
        throw err;
      }
      return body;
    },
    enabled: !!code,
    retry: false,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!user) {
        // Send them to login, then back here
        sessionStorage.setItem("lenory_return_after_login", `/shared/${code}`);
        navigate(`/login?next=${encodeURIComponent(`/shared/${code}`)}`);
        throw new Error("Sign in required to save");
      }
      const res = await apiRequest("POST", `/api/kb/shared/${code}/save`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Couldn't save this notebook");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/kb/folders"] });
      toast({
        title: "Saved to Write My Note",
        description: "Opening your notebooks…",
      });
      setTimeout(() => navigate("/live-session"), 800);
    },
    onError: (err: any) => {
      if (String(err.message || "").includes("Sign in required")) return;
      toast({ title: "Couldn't save", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading || authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !data?.folder) {
    const needsLogin = (error as any)?.requiresAuth || (error as any)?.status === 401;
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center">
        <FolderOpen className="h-12 w-12 text-muted-foreground" />
        <h1 className="text-xl font-semibold">{needsLogin ? "Sign in to view" : "Link not found"}</h1>
        <p className="text-sm text-muted-foreground max-w-sm">
          {needsLogin
            ? "This notebook is private. Sign in or create an account to open it."
            : "This share link is invalid or has been revoked by its owner."}
        </p>
        {needsLogin ? (
          <Button
            onClick={() => {
              sessionStorage.setItem("lenory_return_after_login", `/shared/${code}`);
              navigate(`/login?next=${encodeURIComponent(`/shared/${code}`)}`);
            }}
            className="gap-2"
          >
            <LogIn className="h-4 w-4" /> Sign in
          </Button>
        ) : (
          <Button onClick={() => navigate("/live-session")}>Go to Write My Note</Button>
        )}
      </div>
    );
  }

  const { folder, files, ownerName, isOwnFolder, isPublic } = data;
  const meta = folder.meta || {};

  return (
    <div className="min-h-screen bg-background p-4 max-w-2xl mx-auto">
      <Button
        variant="ghost"
        size="sm"
        className="mb-4 gap-2"
        onClick={() => navigate(user ? "/live-session" : "/")}
      >
        <ArrowLeft className="h-4 w-4" /> {user ? "Write My Note" : "Home"}
      </Button>

      <div className="mb-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
          <FolderOpen className="h-4 w-4" />
          {isPublic ? "Public notebook" : "Shared notebook"}
        </div>
        <h1 className="text-2xl font-bold">{folder.name}</h1>
        {(meta.academicSession || meta.semester || meta.lecturer) && (
          <p className="text-sm text-muted-foreground mt-1">
            {[meta.academicSession, meta.semester, meta.lecturer].filter(Boolean).join(" · ")}
          </p>
        )}
        <p className="text-sm text-muted-foreground mt-2">
          Shared by {ownerName} · {(files || []).length} topic{(files || []).length === 1 ? "" : "s"}
        </p>
      </div>

      {isOwnFolder ? (
        <p className="text-sm text-muted-foreground mb-6">
          This is your own notebook — open it in Write My Note.
        </p>
      ) : (
        <Button
          className="w-full mb-6 gap-2"
          disabled={saveMutation.isPending}
          onClick={() => saveMutation.mutate()}
          data-testid="button-save-shared-folder"
        >
          {saveMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          {user ? "Save to my Write My Note" : "Sign in to save"}
        </Button>
      )}

      <div className="space-y-3">
        {(files || []).length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">No topics in this notebook yet.</p>
        )}
        {(files || []).map((file: SharedFile) => {
          const preview = parsePreview(file);
          return (
            <Card key={file.id}>
              <CardContent className="p-4 space-y-2">
                <div className="flex items-center gap-3">
                  <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  <p className="font-medium text-sm truncate">{file.name}</p>
                </div>
                {preview.body && (
                  <div className="text-xs text-muted-foreground line-clamp-4 prose prose-sm dark:prose-invert max-w-none">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {preview.body.slice(0, 600)}
                    </ReactMarkdown>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
