// client/src/components/kb/FileItem.tsx
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Trash2, FileText, Image, FileText, FileCode, FileJson, Music, Video, Archive, Link2, File , Circle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface FileItemProps {
  file: {
    id: string;
    name: string;
    file_type: string;
    source_type: string;
    file_size: number;
    extracted_text: string | null;
    created_at: string;
  };
  onDelete: () => void;
}

export function FileItem({ file, onDelete }: FileItemProps) {
  const formatStorage = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const getFileIcon = (fileType: string) => {
    if (fileType.includes("image")) return <Image className="h-4 w-4" />;
    if (fileType.includes("pdf")) return <FileText className="h-4 w-4" />;
    if (fileType.includes("text") || fileType.includes("plain")) return <FileText className="h-4 w-4" />;
    if (fileType.includes("json")) return <FileJson className="h-4 w-4" />;
    if (fileType.includes("html") || fileType.includes("css") || fileType.includes("javascript")) return <FileCode className="h-4 w-4" />;
    if (fileType.includes("audio")) return <Music className="h-4 w-4" />;
    if (fileType.includes("video")) return <Video className="h-4 w-4" />;
    if (fileType.includes("zip") || fileType.includes("rar")) return <Archive className="h-4 w-4" />;
    if (fileType === "url") return <Link2 className="h-4 w-4" />;
    if (fileType === "text") return <FileText className="h-4 w-4" />;
    return <File className="h-4 w-4" />;
  };

  const getSourceLabel = (sourceType: string) => {
    const labels: Record<string, string> = {
      upload: "Uploaded",
      url: "From URL",
      google_drive: "Google Drive",
      google_docs: "Google Docs",
      github: "GitHub",
      text: "Created",
    };
    return labels[sourceType] || sourceType;
  };

  return (
    <Card className="hover-elevate">
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 bg-primary/10 rounded-lg flex-shrink-0">
              {getFileIcon(file.file_type)}
            </div>
            <div className="min-w-0">
              <p className="font-medium text-sm truncate">{file.name}</p>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>{getSourceLabel(file.source_type)}</span>
                <span>•</span>
                <span>{formatDistanceToNow(new Date(file.created_at), { addSuffix: true })}</span>
                {file.file_size > 0 && (
                  <>
                    <span>•</span>
                    <span>{formatStorage(file.file_size)}</span>
                  </>
                )}
              </div>
            </div>
          </div>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 text-destructive hover:text-destructive"
            onClick={onDelete}
            data-testid={`file-delete-${file.id}`}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
        {file.extracted_text && (
          <p className="text-xs text-muted-foreground mt-2 line-clamp-2">
            {file.extracted_text.substring(0, 150)}...
          </p>
        )}
      </CardContent>
    </Card>
  );
}

