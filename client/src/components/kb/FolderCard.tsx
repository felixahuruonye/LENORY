// client/src/components/kb/FolderCard.tsx
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { FolderOpen, Share2, Trash2, Coins, Globe , Circle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface FolderCardProps {
  folder: {
    id: string;
    name: string;
    description: string | null;
    storage_used: number;
    storage_limit: number;
    credits_allocated: number;
    credits_used: number;
    share_code: string | null;
    created_at: string;
  };
  isSelected: boolean;
  onSelect: () => void;
  onShare: () => void;
  onDelete: () => void;
  onCredits: () => void;
}

export function FolderCard({
  folder,
  isSelected,
  onSelect,
  onShare,
  onDelete,
  onCredits,
}: FolderCardProps) {
  const storagePercent = Math.min(100, ((folder.storage_used || 0) / (folder.storage_limit || 1)) * 100);
  const creditBalance = (folder.credits_allocated || 0) - (folder.credits_used || 0);
  const isLowCredits = creditBalance < 3 && creditBalance > 0;
  const isOutOfCredits = creditBalance <= 0;

  const formatStorage = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  return (
    <Card
      className={`hover-elevate cursor-pointer transition-all border-2 ${
        isSelected ? "border-primary/50 shadow-primary/20" : "border-border/50"
      }`}
      onClick={onSelect}
      data-testid={`folder-${folder.id}`}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <FolderOpen className="h-5 w-5 text-primary flex-shrink-0" />
              <CardTitle className="text-base truncate">{folder.name}</CardTitle>
            </div>
            {folder.description && (
              <p className="text-sm text-muted-foreground truncate mt-1">{folder.description}</p>
            )}
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {folder.share_code && (
              <Badge variant="secondary" className="text-[10px] gap-1">
                <Globe className="h-3 w-3" /> Shared
              </Badge>
            )}
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              onClick={(e) => {
                e.stopPropagation();
                onCredits();
              }}
              data-testid={`folder-credits-${folder.id}`}
            >
              <Coins className={`h-4 w-4 ${isOutOfCredits ? "text-red-500" : isLowCredits ? "text-yellow-500" : "text-green-500"}`} />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              {formatStorage(folder.storage_used || 0)} / {formatStorage(folder.storage_limit || 0)}
            </span>
            <span className="text-muted-foreground">
              {creditBalance} credits left
            </span>
          </div>
          <Progress value={storagePercent} className="h-1.5" />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Created {formatDistanceToNow(new Date(folder.created_at), { addSuffix: true })}</span>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs gap-1"
                onClick={(e) => {
                  e.stopPropagation();
                  onShare();
                }}
                data-testid={`folder-share-${folder.id}`}
              >
                <Share2 className="h-3 w-3" />
                Share
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
                data-testid={`folder-delete-${folder.id}`}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

