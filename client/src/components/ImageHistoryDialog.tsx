import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, Images } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface ImgRow { id: string; imageUrl: string; prompt?: string; createdAt?: string }

export default function ImageHistoryDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { data, isLoading } = useQuery<{ images: ImgRow[] }>({
    queryKey: ["/api/images/history"],
    queryFn: async () => (await apiRequest("GET", "/api/images/history")).json(),
    enabled: open,
  });
  const images = data?.images || [];
  const [selected, setSelected] = useState<ImgRow | null>(null);
  const dl = (url: string, id: string) => { const a = document.createElement("a"); a.href = url; a.download = `lenory-${id}.png`; a.click(); };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto rounded-2xl" data-testid="image-history-dialog">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Images className="w-5 h-5" />Image History</DialogTitle></DialogHeader>
        {isLoading ? <p className="text-sm text-muted-foreground">Loading...</p> : images.length === 0 ? (
          <div className="text-center py-10 text-sm text-muted-foreground">No images yet. Ask LENORY to generate one in Chat.</div>
        ) : selected ? (
          <div className="space-y-3">
            <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>← Back</Button>
            <img src={selected.imageUrl} alt={selected.prompt || "Generated image"} className="w-full max-h-[60vh] object-contain rounded-xl" />
            <p className="text-sm text-muted-foreground">{selected.prompt}</p>
            <Button className="w-full" onClick={() => dl(selected.imageUrl, selected.id)}><Download className="w-4 h-4 mr-2" />Download</Button>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {images.map((img) => (
              <div key={img.id} className="relative group cursor-pointer rounded-xl overflow-hidden border border-border/40 aspect-square" onClick={() => setSelected(img)}>
                <img src={img.imageUrl} alt={img.prompt || "image"} className="w-full h-full object-cover" loading="lazy" />
                <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 flex items-end p-2 transition-opacity">
                  <p className="text-white text-xs line-clamp-2">{img.prompt}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
