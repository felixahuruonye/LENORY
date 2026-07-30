// client/src/components/website/AppCard.tsx
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Heart, Code2, Trash2 , Circle } from "lucide-react";

interface AppCardProps {
  app: {
    id: string;
    title: string;
    description: string | null;
    view_count: number;
    is_favorite: boolean;
    created_at: string;
  };
  onOpen: () => void;
  onFavorite: () => void;
  onDelete: () => void;
  formatDate: (date: string) => string;
}

export function AppCard({ app, onOpen, onFavorite, onDelete, formatDate }: AppCardProps) {
  return (
    <Card
      className="hover-elevate cursor-pointer p-4 hover:border-primary/30 transition-all"
      onClick={onOpen}
      data-testid={`app-${app.id}`}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Code2 className="h-5 w-5 text-primary flex-shrink-0" />
            <h3 className="font-semibold truncate">{app.title}</h3>
          </div>
          {app.description && (
            <p className="text-sm text-muted-foreground truncate mt-1">{app.description}</p>
          )}
          <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
            <span>{formatDate(app.created_at)}</span>
            <span>•</span>
            <span>{app.view_count || 0} views</span>
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={(e) => {
              e.stopPropagation();
              onFavorite();
            }}
            data-testid={`favorite-${app.id}`}
          >
            <Heart className={`h-4 w-4 ${app.is_favorite ? "fill-red-500 text-red-500" : ""}`} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-destructive hover:text-destructive"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </Card>
  );
}

