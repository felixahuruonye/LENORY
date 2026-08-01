// client/src/components/integrations/GoogleDriveBrowser.tsx
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Loader2, FolderOpen, File, FileText, Image,
  FileCode, Music, Video, Archive,
  ChevronRight, ChevronLeft, Check, X,
  Database, Cloud, RefreshCw, Upload, Link2,
  FolderPlus, Trash2, Download, ExternalLink,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface GoogleDriveFile {
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
}

interface GoogleDriveBrowserProps {
  folderId: string;
  onSelect: (file: GoogleDriveFile) => void;
  onClose: () => void;
  selectedFiles?: string[];
}

export function GoogleDriveBrowser({ folderId, onSelect, onClose, selectedFiles = [] }: GoogleDriveBrowserProps) {
  const { toast } = useToast();
  const [files, setFiles] = useState<GoogleDriveFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentFolder, setCurrentFolder] = useState<string>("root");
  const [path, setPath] = useState<{ id: string; name: string }[]>([{ id: "root", name: "My Drive" }]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selected, setSelected] = useState<string[]>(selectedFiles);
  const [isConnected, setIsConnected] = useState(false);

  // Check connection status
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
    }
  };

  const fetchFiles = async (folderId: string) => {
    setLoading(true);
    try {
      const res = await apiRequest("GET", `/api/integrations/google-drive/files?folderId=${folderId}`);
      const data = await res.json();
      setFiles(data.files || []);
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleAuth = async () => {
    try {
      const res = await apiRequest("GET", "/api/integrations/google-drive/auth");
      const data = await res.json();
      if (data.authUrl) {
        const popup = window.open(data.authUrl, "_blank", "width=500,height=650");
        const poll = setInterval(() => {
          if (popup?.closed) {
            clearInterval(poll);
            checkConnection();
          }
        }, 800);
      } else {
        toast({ title: "Error", description: "Failed to get auth URL", variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const handleFileClick = (file: GoogleDriveFile) => {
    if (file.isFolder) {
      setCurrentFolder(file.id);
      setPath([...path, { id: file.id, name: file.name }]);
      fetchFiles(file.id);
    } else {
      if (selected.includes(file.id)) {
        setSelected(selected.filter((id) => id !== file.id));
      } else {
        setSelected([...selected, file.id]);
        onSelect(file);
      }
    }
  };

  const handleSync = async () => {
    try {
      const res = await apiRequest("POST", "/api/integrations/sync", {
        sourceType: "google_drive",
        folderId: currentFolder,
      });
      const data = await res.json();
      toast({ title: "Sync started", description: data.message });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const getFileIcon = (file: GoogleDriveFile) => {
    if (file.isFolder) return <FolderOpen className="h-5 w-5 text-yellow-500" />;
    const mime = file.mimeType;
    if (mime.includes("image")) return <Image className="h-5 w-5 text-purple-500" />;
    if (mime.includes("pdf")) return <FileText className="h-5 w-5 text-red-500" />;
    if (mime.includes("text")) return <FileText className="h-5 w-5 text-blue-500" />;
    if (mime.includes("audio")) return <Music className="h-5 w-5 text-green-500" />;
    if (mime.includes("video")) return <Video className="h-5 w-5 text-orange-500" />;
    if (mime.includes("zip") || mime.includes("rar")) return <Archive className="h-5 w-5 text-gray-500" />;
    if (mime.includes("code") || mime.includes("json") || mime.includes("html")) return <FileCode className="h-5 w-5 text-cyan-500" />;
    return <File className="h-5 w-5 text-muted-foreground" />;
  };

  const formatFileSize = (bytes: string) => {
    const size = parseInt(bytes);
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
    return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  if (!isConnected) {
    return (
      <Card className="p-8 text-center">
        <Cloud className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
        <h3 className="text-lg font-semibold mb-2">Connect Google Drive</h3>
        <p className="text-sm text-muted-foreground mb-4">
          Connect your Google Drive to sync files and folders.
        </p>
        <Button onClick={handleAuth} className="gap-2">
          <Cloud className="h-4 w-4" />
          Connect Google Drive
        </Button>
      </Card>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 p-2 border-b">
        <div className="flex items-center gap-2">
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
          <div className="flex items-center gap-1 text-sm">
            {path.map((p, i) => (
              <span key={p.id} className="flex items-center">
                <span className="font-medium">{p.name}</span>
                {i < path.length - 1 && <ChevronRight className="h-3 w-3 mx-1 text-muted-foreground" />}
              </span>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Input
            placeholder="Search files..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-8 text-xs w-40"
          />
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => fetchFiles(currentFolder)}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={handleSync}
          >
            <Sync className="h-4 w-4" />
          </Button>
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
            <FolderOpen className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No files in this folder</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {files.map((file) => {
              const isSelected = selected.includes(file.id);
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
                            <span>{formatFileSize(file.size)}</span>
                            <span>•</span>
                            <span>{new Date(file.modifiedTime).toLocaleDateString()}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {isSelected && <Check className="h-4 w-4 text-primary" />}
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
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </ScrollArea>

      {/* Footer */}
      <div className="border-t p-2 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {selected.length} files selected
        </span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
          <Button size="sm" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}

// Add missing Sync icon
function Sync(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.1 2" />
      <path d="M21 3v6h-6" />
      <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.1-2" />
      <path d="M3 21v-6h6" />
    </svg>
  );
}
