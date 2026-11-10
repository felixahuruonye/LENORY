/**
 * Isolated handwritten / document digitization UI for Write My Note.
 * Does not modify Live Session recording, audio upload, or video flows.
 */
import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  X, Upload, Loader2, FileText, Image as ImageIcon, ChevronUp, ChevronDown,
  Trash2, Sparkles, AlertTriangle, Check,
} from "lucide-react";
import { getAuthHeaders } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export type DigitizePagePreview = {
  id: string;
  file: File;
  previewUrl: string;
  kind: "image" | "document";
};

export type DigitizeResult = {
  document: string;
  pages: {
    index: number;
    fileName: string;
    text: string;
    confidence: string;
    warnings: string[];
    isBlank: boolean;
  }[];
  photoDataUrls: string[];
};

const ACCEPT =
  "image/jpeg,image/jpg,image/png,image/webp,image/heic,image/heif,image/gif,.jpg,.jpeg,.png,.webp,.heic,.heif,.pdf,.docx,.doc,.txt,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain";

const BLOCKED_EXT = /\.(mp3|wav|m4a|aac|ogg|flac|mp4|mov|avi|mkv|webm)$/i;

function fileKind(f: File): "image" | "document" | null {
  if (BLOCKED_EXT.test(f.name) || f.type.startsWith("audio/") || f.type.startsWith("video/")) return null;
  if (f.type.startsWith("image/") || /\.(jpe?g|png|webp|heic|heif|gif|bmp)$/i.test(f.name)) return "image";
  if (/\.(pdf|docx?|txt)$/i.test(f.name) || /pdf|word|text\/plain/i.test(f.type)) return "document";
  return null;
}

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

type Props = {
  open: boolean;
  onClose: () => void;
  onComplete: (result: DigitizeResult) => void;
};

export default function HandwrittenDigitize({ open, onClose, onComplete }: Props) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pages, setPages] = useState<DigitizePagePreview[]>([]);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState("");
  const [editedDoc, setEditedDoc] = useState<string | null>(null);
  const [result, setResult] = useState<DigitizeResult | null>(null);
  const [viewMode, setViewMode] = useState<"text" | "original">("text");
  const [previewIndex, setPreviewIndex] = useState(0);

  const addFiles = useCallback((list: FileList | File[]) => {
    const next: DigitizePagePreview[] = [];
    for (const file of Array.from(list)) {
      const kind = fileKind(file);
      if (!kind) {
        toast({
          title: "File rejected",
          description: `${file.name}: only images (JPG, PNG, WEBP, HEIC) and documents (PDF, DOCX, TXT). No audio or video.`,
          variant: "destructive",
        });
        continue;
      }
      next.push({
        id: `p_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        file,
        previewUrl: kind === "image" ? URL.createObjectURL(file) : "",
        kind,
      });
    }
    if (next.length) setPages((p) => [...p, ...next]);
  }, [toast]);

  const move = (i: number, dir: -1 | 1) => {
    setPages((p) => {
      const j = i + dir;
      if (j < 0 || j >= p.length) return p;
      const copy = [...p];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });
  };

  const remove = (id: string) => {
    setPages((p) => {
      const hit = p.find((x) => x.id === id);
      if (hit?.previewUrl) URL.revokeObjectURL(hit.previewUrl);
      return p.filter((x) => x.id !== id);
    });
  };

  const process = async () => {
    if (!pages.length) {
      toast({ title: "Add pages first", variant: "destructive" });
      return;
    }
    setBusy(true);
    setPhase("Uploading pages…");
    try {
      const form = new FormData();
      pages.forEach((p, i) => form.append("pages", p.file, p.file.name || `page_${i + 1}`));
      form.append("order", pages.map((_, i) => i).join(","));

      setPhase("Recognizing handwriting…");
      const headers = await getAuthHeaders();
      // Let browser set multipart boundary — strip Content-Type if present
      const h: Record<string, string> = { ...headers };
      delete (h as any)["Content-Type"];
      delete (h as any)["content-type"];

      const res = await fetch("/api/notes/digitize", {
        method: "POST",
        headers: h,
        credentials: "include",
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Digitization failed");

      setPhase("Preparing editable document…");
      const photoDataUrls: string[] = [];
      for (const p of pages) {
        if (p.kind === "image") {
          try {
            photoDataUrls.push(await fileToDataUrl(p.file));
          } catch {
            photoDataUrls.push(p.previewUrl);
          }
        }
      }

      const out: DigitizeResult = {
        document: data.document || "",
        pages: data.pages || [],
        photoDataUrls,
      };
      setResult(out);
      setEditedDoc(out.document);
      setViewMode("text");
      toast({ title: "Digital notes ready", description: data.message || "Review and save to this topic." });
    } catch (e: any) {
      toast({ title: "Digitize failed", description: e?.message || "Try again", variant: "destructive" });
    } finally {
      setBusy(false);
      setPhase("");
    }
  };

  const save = () => {
    if (!result) return;
    onComplete({
      ...result,
      document: editedDoc ?? result.document,
    });
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/50 p-3">
      <div className="w-full max-w-lg max-h-[92vh] overflow-hidden rounded-2xl bg-background border shadow-xl flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
          <div>
            <h2 className="font-bold text-base">Scan handwritten notes</h2>
            <p className="text-xs text-muted-foreground">Photos & documents → digital text on the Note tab</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} disabled={busy}><X className="w-5 h-5" /></Button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {!result ? (
            <>
              <div
                className="rounded-xl border border-dashed p-6 text-center space-y-2 cursor-pointer hover:bg-muted/40"
                onClick={() => inputRef.current?.click()}
              >
                <Upload className="w-8 h-8 mx-auto text-primary" />
                <p className="text-sm font-medium">Select photos or documents</p>
                <p className="text-xs text-muted-foreground">JPG, PNG, WEBP, HEIC, PDF, DOCX, TXT — multiple pages OK. No audio/video.</p>
                <input
                  ref={inputRef}
                  type="file"
                  multiple
                  accept={ACCEPT}
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files) addFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
              </div>

              {pages.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      {pages.length} page{pages.length === 1 ? "" : "s"} · drag order with arrows
                    </p>
                    <Button variant="ghost" size="sm" onClick={() => setPages([])} disabled={busy}>Clear</Button>
                  </div>
                  {pages.map((p, i) => (
                    <div key={p.id} className="flex items-center gap-2 rounded-lg border p-2">
                      {p.kind === "image" && p.previewUrl ? (
                        <img src={p.previewUrl} alt="" className="w-12 h-12 object-cover rounded-md shrink-0" />
                      ) : (
                        <div className="w-12 h-12 rounded-md bg-muted flex items-center justify-center shrink-0">
                          <FileText className="w-5 h-5 text-muted-foreground" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm truncate font-medium">{p.file.name}</p>
                        <p className="text-[10px] text-muted-foreground">
                          Page {i + 1} · {(p.file.size / 1024).toFixed(0)} KB · {p.kind}
                        </p>
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <button type="button" className="p-1 rounded hover:bg-muted" onClick={() => move(i, -1)} disabled={i === 0}><ChevronUp className="w-4 h-4" /></button>
                        <button type="button" className="p-1 rounded hover:bg-muted" onClick={() => move(i, 1)} disabled={i === pages.length - 1}><ChevronDown className="w-4 h-4" /></button>
                      </div>
                      <button type="button" className="p-1.5 rounded text-destructive hover:bg-destructive/10" onClick={() => remove(p.id)}><Trash2 className="w-4 h-4" /></button>
                    </div>
                  ))}
                </div>
              )}

              {busy && (
                <div className="flex items-center gap-2 text-sm text-primary">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {phase || "Working…"}
                </div>
              )}
            </>
          ) : (
            <>
              <div className="flex rounded-lg border p-0.5 bg-muted/30">
                <button type="button" className={`flex-1 text-sm py-2 rounded-md font-medium ${viewMode === "text" ? "bg-background shadow-sm" : "text-muted-foreground"}`} onClick={() => setViewMode("text")}>Digital text</button>
                <button type="button" className={`flex-1 text-sm py-2 rounded-md font-medium ${viewMode === "original" ? "bg-background shadow-sm" : "text-muted-foreground"}`} onClick={() => setViewMode("original")}>Original pages</button>
              </div>

              {viewMode === "text" ? (
                <textarea
                  className="w-full min-h-[280px] rounded-xl border bg-card p-3 text-sm font-sans leading-relaxed"
                  value={editedDoc ?? ""}
                  onChange={(e) => setEditedDoc(e.target.value)}
                  placeholder="Extracted notes appear here — edit freely"
                />
              ) : (
                <div className="space-y-2">
                  <div className="flex gap-1 overflow-x-auto pb-1">
                    {pages.map((p, i) => (
                      <button key={p.id} type="button" onClick={() => setPreviewIndex(i)} className={`px-2 py-1 rounded-md text-xs border shrink-0 ${previewIndex === i ? "bg-primary text-primary-foreground" : ""}`}>
                        Page {i + 1}
                      </button>
                    ))}
                  </div>
                  {pages[previewIndex]?.previewUrl ? (
                    <img src={pages[previewIndex].previewUrl} alt="" className="w-full rounded-lg border max-h-72 object-contain bg-muted" />
                  ) : (
                    <p className="text-sm text-muted-foreground p-4 border rounded-lg">Document page — preview not available</p>
                  )}
                  {result.pages[previewIndex]?.warnings?.length ? (
                    <div className="text-xs text-amber-600 flex gap-1"><AlertTriangle className="w-3.5 h-3.5" />{result.pages[previewIndex].warnings.join(" · ")}</div>
                  ) : null}
                </div>
              )}

              <div className="flex flex-wrap gap-1.5">
                {result.pages.map((p) => (
                  <Badge key={p.index} variant={p.isBlank ? "destructive" : p.confidence === "low" ? "outline" : "secondary"} className="text-[10px]">
                    P{p.index + 1}: {p.isBlank ? "blank" : p.confidence}
                  </Badge>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="border-t p-3 flex gap-2 shrink-0">
          {!result ? (
            <>
              <Button variant="outline" className="flex-1" onClick={onClose} disabled={busy}>Cancel</Button>
              <Button className="flex-1 gap-1.5" onClick={process} disabled={busy || !pages.length}>
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                Convert to digital notes
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" className="flex-1" onClick={() => { setResult(null); setEditedDoc(null); }} disabled={busy}>Back</Button>
              <Button className="flex-1 gap-1.5" onClick={save}>
                <Check className="w-4 h-4" /> Save to Note tab
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
