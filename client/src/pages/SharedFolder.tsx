import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, FolderOpen, FileText, Download, ArrowLeft } from "lucide-react";

interface SharedFile {
  id: string;
  name: string;
  file_type: string;
  file_size: number;
  created_at: string;
  extracted_text?: string;
}

export default function SharedFolder() {
  const { code } = useParams<{ code: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["/api/kb/shared", code],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/kb/shared/${code}`);
      return res.json();
    },
    enabled: !!code,
    retry: false,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/kb/shared/${code}/save`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/kb/folders"] });
      toast({ title: "Saved to your Knowledge Base!", description: "Redirecting you there now." });
      setTimeout(() => navigate("/notes"), 1200);
    },
    onError: (err: any) => {
      toast({ title: "Couldn't save this folder", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !data?.folder) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center">
        <FolderOpen className="h-12 w-12 text-muted-foreground" />
        <h1 className="text-xl font-semibold">Link not found</h1>
        <p className="text-sm text-muted-foreground max-w-sm">
          This share link is invalid or has been revoked by its owner.
        </p>
        <Button onClick={() => navigate("/notes")}>Go to your Knowledge Base</Button>
      </div>
    );
  }

  const { folder, files, ownerName, isOwnFolder } = data;

  return (
    <div className="min-h-screen bg-background p-4 max-w-2xl mx-auto">
      <Button variant="ghost" size="sm" className="mb-4 gap-2" onClick={() => navigate("/notes")}>
        <ArrowLeft className="h-4 w-4" /> Back to Knowledge Base
      </Button>

      <div className="mb-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
          <FolderOpen className="h-4 w-4" /> Shared folder
        </div>
        <h1 className="text-2xl font-bold">{folder.name}</h1>
        {folder.description && <p className="text-muted-foreground mt-1">{folder.description}</p>}
        <p className="text-sm text-muted-foreground mt-2">Shared by {ownerName} • {files.length} files</p>
      </div>

      {isOwnFolder ? (
        <p className="text-sm text-muted-foreground mb-6">This is your own folder — open it directly in your Knowledge Base.</p>
      ) : (
        <Button
          className="w-full mb-6 gap-2"
          disabled={saveMutation.isPending}
          onClick={() => saveMutation.mutate()}
          data-testid="button-save-shared-folder"
        >
          {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          Save to my Knowledge Base
        </Button>
      )}

      <div className="space-y-2">
        {files.map((file: SharedFile) => (
          <Card key={file.id}>
            <CardContent className="p-4 flex items-center gap-3">
              <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <div className="min-w-0">
                <p className="font-medium text-sm truncate">{file.name}</p>
                {file.extracted_text && (
                  <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">{file.extracted_text.substring(0, 100)}</p>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
