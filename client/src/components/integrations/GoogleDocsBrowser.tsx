// client/src/components/integrations/GoogleDocsBrowser.tsx
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Loader2, FileText, File, Check, X,
  Database, Cloud, RefreshCw, Upload, Link2,
  Trash2, Download, ExternalLink, ChevronLeft,
  Search, Filter, Clock
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface GoogleDocFile {
  id: string;
  name: string;
  mimeType: string;
  webViewLink: string;
  webContentLink: string;
  size: string;
  createdTime: string;
  modifiedTime: string;
  parents: string[];
  iconLink: string;
  thumbnailLink: string;
  isFolder: boolean;
  isDoc: boolean;
  content?: string; // extracted text content
}

interface GoogleDocsBrowserProps {
  folderId?: string;
  onSelect: (file: GoogleDocFile) => void;
  onClose: () => void;
  selectedFiles?: string[];
  multiSelect?: boolean;
}

export function GoogleDocsBrowser({ 
  folderId = "root", 
  onSelect, 
  onClose, 
  selectedFiles = [],
  multiSelect = false
}: GoogleDocsBrowserProps) {
  const { toast } = useToast();
  const [files, setFiles] = useState<GoogleDocFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentFolder, setCurrentFolder] = useState<string>("root");
  const [path, setPath] = useState<{ id: string; name: string }[]>([{ id: "root", name: "My Drive" }]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selected, setSelected] = useState<string[]>(selectedFiles);
  const [isConnected, setIsConnected] = useState(false);
  const [extractingContent, setExtractingContent] = useState<string | null>(null);

  // ─── CHECK CONNECTION ──────────────────────────────────────

  useEffect(() => {
    checkConnection();
  }, []);

  const checkConnection = async () => {
    try {
      const res = await apiRequest("GET", "/api/integrations/google-drive/status");
      const data = await res.json();
      setIsConnected(data.connected);
      if (data.connected) {
        fetchFiles("root");
      }
    } catch (e) {
      setIsConnected(false);
    } finally {
      setLoading(false);
    }
  };

  // ─── FETCH FILES (ONLY GOOGLE DOCS) ─────────────────────

  const fetchFiles = async (folderId: string) => {
    setLoading(true);
    try {
      const res = await apiRequest("GET", `/api/integrations/google-docs/files?folderId=${folderId}`);
      const data = await res.json();
      setFiles(data.files || []);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  // ─── AUTH ──────────────────────────────────────────────────

  const handleAuth = async () => {
    try {
      const res = await apiRequest("GET", "/api/integrations/google-drive/auth");
      const data = await res.json();
      if (data.authUrl) {
        window.open(data.authUrl, "_blank");
        // Poll for connection after auth
        const interval = setInterval(async () => {
          const statusRes = await apiRequest("GET", "/api/integrations/google-drive/status");
          const statusData = await statusRes.json();
          if (statusData.connected) {
            setIsConnected(true);
            fetchFiles("root");
            clearInterval(interval);
          }
        }, 2000);
      } else {
        toast({ title: "Error", description: "Failed to get auth URL", variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  // ─── HANDLERS ──────────────────────────────────────────────

  const handleFileClick = (file: GoogleDocFile) => {
    if (file.isFolder) {
      setCurrentFolder(file.id);
      setPath([...path, { id: file.id, name: file.name }]);
      fetchFiles(file.id);
    } else {
      if (multiSelect) {
        if (selected.includes(file.id)) {
          setSelected(selected.filter((id) => id !== file.id));
        } else {
          setSelected([...selected, file.id]);
          onSelect(file);
        }
      } else {
        onSelect(file);
        onClose();
      }
    }
  };

  const handleExtractContent = async (file: GoogleDocFile) => {
    setExtractingContent(file.id);
    try {
      const res = await apiRequest("POST", "/api/integrations/google-docs/extract", {
        fileId: file.id,
        folderId: currentFolder
      });
      const data = await res.json();
      toast({ title: "Content extracted!", description: `Imported ${data.wordCount || 'text'} from ${file.name}` });
      // Update file with content
      setFiles(prev => prev.map(f => f.id === file.id ? { ...f, content: data.content } : f));
    } catch (e: any) {
      toast({ title: "Extraction failed", description: e.message, variant: "destructive" });
    } finally {
      setExtractingContent(null);
    }
  };

  const getFileIcon = (file: GoogleDocFile) => {
    if (file.isFolder) return <FolderOpen className="h-5 w-5 text-yellow-500" />;
    return <FileText className="h-5 w-5 text-blue-500" />;
  };

  const formatFileSize = (bytes: string) => {
    const size = parseInt(bytes);
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  };

  // ─── UI ────────────────────────────────────────────────────

  if (!isConnected) {
    return (
      <Card className="p-8 text-center max-w-md mx-auto">
        <Cloud className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
        <h3 className="text-lg font-semibold mb-2">Connect Google Drive</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Connect your Google Drive to import Google Docs.
        </p>
        <Button onClick={handleAuth} className="gap-2">
          <Cloud className="h-4 w-4" />
          Connect Google Drive
        </Button>
      </Card>
    );
  }

  return (
    <div className="flex flex-col h-[500px] bg-background border rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 p-3 border-b bg-muted/20">
        <div className="flex items-center gap-2 min-w-0">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => {
              if (path.length > 1) {
                const newPath = path.slice(0, -1);
                setPath(newPath);
                setCurrentFolder(newPath[newPath.length - 1].id);
                fetchFiles(newPath[newPath.length - 1].id);
              }
            }}
            disabled={path.length <= 1}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-1 text-sm truncate">
            {path.map((p, i) => (
              <span key={p.id} className="flex items-center whitespace-nowrap">
                <span className="font-medium">{p.name}</span>
                {i < path.length - 1 && <span className="mx-1 text-muted-foreground">›</span>}
              </span>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Badge variant="outline" className="text-[10px] gap-1">
            <FileText className="h-3 w-3" />
            Google Docs
          </Badge>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => fetchFiles(currentFolder)}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="p-2 border-b">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search Google Docs..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-9 pl-8 text-sm"
          />
        </div>
      </div>

      {/* File List */}
      <ScrollArea className="flex-1">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : files.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No Google Docs found in this folder</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {files.map((file) => {
              const isSelected = selected.includes(file.id);
              const hasContent = !!file.content;
              return (
                <div
                  key={file.id}
                  className={`flex items-center justify-between p-3 cursor-pointer hover:bg-muted/30 transition-colors ${
                    isSelected ? "bg-primary/10 border-l-2 border-primary" : ""
                  }`}
                  onClick={() => handleFileClick(file)}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {getFileIcon(file)}
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{file.name}</p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {file.isFolder ? (
                          <span>Folder</span>
                        ) : (
                          <>
                            <span>{new Date(file.modifiedTime).toLocaleDateString()}</span>
                            {hasContent && (
                              <>
                                <span>•</span>
                                <span className="text-green-500">✓ Extracted</span>
                              </>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {!file.isFolder && !hasContent && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs gap-1"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleExtractContent(file);
                        }}
                        disabled={extractingContent === file.id}
                      >
                        {extractingContent === file.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Upload className="h-3 w-3" />
                        )}
                        Extract
                      </Button>
                    )}
                    {!file.isFolder && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          window.open(file.webViewLink, "_blank");
                        }}
                      >
                        <ExternalLink className="h-3 w-3" />
                      </Button>
                    )}
                    {isSelected && <Check className="h-4 w-4 text-primary" />}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </ScrollArea>

      {/* Footer */}
      <div className="border-t p-2 flex items-center justify-between bg-muted/10">
        <span className="text-xs text-muted-foreground">
          {selected.length} document{selected.length !== 1 ? 's' : ''} selected
        </span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={onClose}>
            Import Selected
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── FOLDER OPEN ICON ─────────────────────────────────────

function FolderOpen(props: any) {
  return (
    <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
      <path d="M2 8h20" />
      <path d="m16 16-4-4-4 4" />
      <path d="M12 12v8" />
    </svg>
  );
}
