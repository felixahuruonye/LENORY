// client/src/components/kb/ShareDialog.tsx
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Share2, Link2, Copy, Trash2, Loader2, Globe , Circle } from "lucide-react";

interface ShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folderId: string | null;
  shareCode: string | null;
  shareLink: string;
  sharePermission: string;
  onShare: (folderId: string, permission: string) => void;
  onRemoveShare: (folderId: string) => void;
  onCopyLink: () => void;
  onShareWhatsApp: () => void;
  isSharing: boolean;
  isRemoving: boolean;
}

export function ShareDialog({
  open,
  onOpenChange,
  folderId,
  shareCode,
  shareLink,
  sharePermission,
  onShare,
  onRemoveShare,
  onCopyLink,
  onShareWhatsApp,
  isSharing,
  isRemoving,
}: ShareDialogProps) {
  const [permission, setPermission] = useState(sharePermission || "view");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="h-5 w-5 text-primary" />
            Share Folder
          </DialogTitle>
          <DialogDescription>
            Share this folder with classmates and study groups.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {!shareCode ? (
            <>
              <div>
                <label className="text-sm font-medium">Permission Level</label>
                <select
                  className="w-full mt-1 p-2 rounded-md border border-input bg-background"
                  value={permission}
                  onChange={(e) => setPermission(e.target.value)}
                >
                  <option value="view">View Only</option>
                  <option value="comment">View & Comment</option>
                  <option value="ai">View & AI Access</option>
                </select>
              </div>
              <Button
                onClick={() => {
                  if (folderId) onShare(folderId, permission);
                }}
                disabled={isSharing || !folderId}
                className="w-full gap-2 hover-elevate"
              >
                {isSharing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Link2 className="h-4 w-4" />
                )}
                Generate Share Link
              </Button>
            </>
          ) : (
            <>
              <div className="p-3 bg-muted/50 rounded-lg">
                <p className="text-xs text-muted-foreground mb-1">Share Link</p>
                <div className="flex items-center gap-2">
                  <Input value={shareLink} readOnly className="text-xs" />
                  <Button size="icon" variant="outline" onClick={onCopyLink}>
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={onShareWhatsApp} className="gap-2">
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
                  </svg>
                  WhatsApp
                </Button>
                <Button variant="outline" size="sm" onClick={onCopyLink} className="gap-2">
                  <Copy className="h-4 w-4" />
                  Copy Link
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    if (folderId) onRemoveShare(folderId);
                  }}
                  disabled={isRemoving}
                  className="gap-2"
                >
                  {isRemoving ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                  Remove Link
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

