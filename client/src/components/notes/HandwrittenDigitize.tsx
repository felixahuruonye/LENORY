/**
 * Isolated handwritten / document digitization UI for Write My Note.
 * Processes pages one-by-one with live status + timer; save is handled by parent.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  X, Upload, Loader2, FileText, Trash2, Sparkles, AlertTriangle, Check,
  ChevronUp, ChevronDown, Download, Columns2,
} from "lucide-react";
import { getAuthHeaders } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

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

type DigitizePagePreview = {
  id: string;
  file: File;
  previewUrl: string;
  kind: "image" | "document";
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

/** Shrink large photos so uploads + OCR stay reliable on mobile. */
async function compressImageFile(file: File, maxEdge = 1600, quality = 0.72): Promise<File> {
  if (!file.type.startsWith("image/") || file.type.includes("heic")) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, "image/jpeg", quality));
    if (!blob) return file;
    return new File([blob], file.name.replace(/\.\w+$/, ".jpg"), { type: "image/jpeg" });
  } catch {
    return file;
  }
}

function formatHMS(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function textToDocBlob(text: string): Blob {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html = `<html><head><meta charset="utf-8"></head><body>${
    text.split("\n").map((l) => `<p>${esc(l) || "&nbsp;"}</p>`).join("")
  }</body></html>`;
  return new Blob(["\ufeff", html], { type: "application/msword" });
}

type Props = {
  open: boolean;
  onClose: () => void;
  onComplete: (result: DigitizeResult) => void | Promise<void>;
};

export default function HandwrittenDigitize({ open, onClose, onComplete }: Props) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const dragFrom = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const [pages, setPages] = useState<DigitizePagePreview[]>([]);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [editedDoc, setEditedDoc] = useState<string | null>(null);
  const [result, setResult] = useState<DigitizeResult | null>(null);
  const [viewMode, setViewMode] = useState<"text" | "original" | "side">("text");
  const [previewIndex, setPreviewIndex] = useState(0);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!busy) {
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }
    setElapsed(0);
    timerRef.current = window.setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, [busy]);

  const addFiles = useCallback((list: FileList | File[]) => {
    const next: DigitizePagePreview[] = [];
    for (const file of Array.from(list)) {
      const kind = fileKind(file);
      if (!kind) {
        toast({
          title: "File rejected",
          description: `${file.name}: only images and documents (no audio/video).`,
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

  const reorder = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0) return;
    setPages((p) => {
      if (from >= p.length || to >= p.length) return p;
      const copy = [...p];
      const [item] = copy.splice(from, 1);
      copy.splice(to, 0, item);
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
    setPhase("Preparing pages…");
    try {
      const headers = await getAuthHeaders();
      const h: Record<string, string> = { ...headers };
      delete (h as any)["Content-Type"];
      delete (h as any)["content-type"];

      const pageResults: DigitizeResult["pages"] = [];
      const photoDataUrls: string[] = [];
      const textParts: string[] = [];

      for (let i = 0; i < pages.length; i++) {
        const p = pages[i];
        setPhase(`Writing page ${i + 1} of ${pages.length}…`);
        setPreviewIndex(i);

        let fileToSend = p.file;
        if (p.kind === "image") {
          fileToSend = await compressImageFile(p.file);
          try {
            photoDataUrls.push(await fileToDataUrl(fileToSend));
          } catch {
            if (p.previewUrl) photoDataUrls.push(p.previewUrl);
          }
        }

        const form = new FormData();
        form.append("pages", fileToSend, fileToSend.name || `page_${i + 1}`);
        form.append("order", "0");

        let pageText = "";
        let confidence = "none";
        let warnings: string[] = [];
        let isBlank = true;

        try {
          const res = await fetch("/api/notes/digitize", {
            method: "POST",
            headers: h,
            credentials: "include",
            body: form,
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.message || data.modelError || "OCR failed");
          const pr = (data.pages && data.pages[0]) || null;
          if (pr) {
            pageText = pr.text || "";
            confidence = pr.confidence || "none";
            warnings = pr.warnings || [];
            isBlank = !!pr.isBlank || !pageText.trim();
          } else if (data.document) {
            pageText = String(data.document).replace(/^--- Page \d+[^\n]*---\n*/m, "").trim();
            isBlank = !pageText;
            confidence = isBlank ? "none" : "medium";
          }
        } catch (e: any) {
          warnings = [e?.message || "OCR failed for this page"];
          isBlank = true;
        }

        pageResults.push({
          index: i,
          fileName: p.file.name,
          text: pageText,
          confidence,
          warnings,
          isBlank,
        });
        if (!isBlank && pageText.trim()) {
          textParts.push(`\n\n--- Page ${i + 1} ---\n\n${pageText.trim()}`);
        } else {
          textParts.push(`\n\n--- Page ${i + 1} (no readable text) ---\n`);
        }
      }

      const document = textParts.join("").trim();
      const out: DigitizeResult = { document, pages: pageResults, photoDataUrls };
      setResult(out);
      setEditedDoc(document);
      setViewMode("side");

      const blank = pageResults.filter((x) => x.isBlank).length;
      const total = pageResults.length;
      if (blank === total) {
        toast({
          title: "OCR busy — try again",
          description: "No text extracted. Wait a few seconds and tap Convert again.",
          variant: "destructive",
        });
      } else if (blank > 0) {
        toast({ title: `Got ${total - blank} of ${total} pages`, description: "Some pages need a retry or manual edit." });
      } else {
        toast({ title: "Digital notes ready", description: `Done in ${formatHMS(elapsed)}. Review, then Save to Note tab.` });
      }
    } catch (e: any) {
      toast({ title: "Digitize failed", description: e?.message || "Try again", variant: "destructive" });
    } finally {
      setBusy(false);
      setPhase("");
    }
  };

  const exportTxt = () => {
    downloadBlob("lenory-digital-notes.txt", new Blob([editedDoc ?? result?.document ?? ""], { type: "text/plain;charset=utf-8" }));
  };
  const exportDoc = () => {
    downloadBlob("lenory-digital-notes.doc", textToDocBlob(editedDoc ?? result?.document ?? ""));
  };
  const exportPdf = () => {
    const text = editedDoc ?? result?.document ?? "";
    const w = window.open("", "_blank");
    if (w) {
      w.document.write(`<html><head><title>Digital notes</title><style>body{font-family:system-ui;padding:24px;white-space:pre-wrap;line-height:1.5}</style></head><body>${
        text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      }</body></html>`);
      w.document.close();
      setTimeout(() => w.print(), 400);
    }
  };

  const save = async () => {
    if (!result) return;
    setSaving(true);
    try {
      await onComplete({
        ...result,
        document: editedDoc ?? result.document,
      });
      // Parent closes / navigates; if still open, close
      onClose();
    } catch (e: any) {
      toast({ title: "Save failed", description: e?.message || "Try again", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/50 p-3">
      <div className="w-full max-w-lg max-h-[92vh] overflow-hidden rounded-2xl bg-background border shadow-xl flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
          <div>
            <h2 className="font-bold text-base">Scan handwritten notes</h2>
            <p className="text-xs text-muted-foreground">
              Creates a <strong>new page</strong> · exact text · timer while writing
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} disabled={busy || saving}><X className="w-5 h-5" /></Button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {!result ? (
            <>
              <div
                className="rounded-xl border border-dashed p-6 text-center space-y-2 cursor-pointer hover:bg-muted/40"
                onClick={() => !busy && inputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (!busy && e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
                }}
              >
                <Upload className="w-8 h-8 mx-auto text-primary" />
                <p className="text-sm font-medium">Select or drop photos / documents</p>
                <p className="text-xs text-muted-foreground">Tap a photo card to preview full size before reordering.</p>
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
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    {pages.length} page{pages.length === 1 ? "" : "s"} · drag or arrows to reorder · tap image to enlarge
                  </p>
                  {pages.map((p, i) => (
                    <div
                      key={p.id}
                      draggable={!busy}
                      onDragStart={() => { dragFrom.current = i; }}
                      onDragOver={(e) => { e.preventDefault(); setDragOverIdx(i); }}
                      onDragLeave={() => setDragOverIdx(null)}
                      onDrop={(e) => {
                        e.preventDefault();
                        const from = dragFrom.current;
                        setDragOverIdx(null);
                        if (from != null) reorder(from, i);
                        dragFrom.current = null;
                      }}
                      className={`flex items-center gap-2 rounded-lg border p-2 ${
                        dragOverIdx === i ? "border-primary bg-primary/5" : ""
                      } ${busy && previewIndex === i ? "ring-2 ring-primary" : ""}`}
                    >
                      {p.kind === "image" && p.previewUrl ? (
                        <button
                          type="button"
                          className="shrink-0"
                          onClick={() => setLightboxUrl(p.previewUrl)}
                          title="Preview full image"
                        >
                          <img src={p.previewUrl} alt="" className="w-14 h-14 object-cover rounded-md" />
                        </button>
                      ) : (
                        <div className="w-14 h-14 rounded-md bg-muted flex items-center justify-center shrink-0">
                          <FileText className="w-5 h-5 text-muted-foreground" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm truncate font-medium">{p.file.name}</p>
                        <p className="text-[10px] text-muted-foreground">Page {i + 1} · {(p.file.size / 1024).toFixed(0)} KB</p>
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <button type="button" className="p-1 rounded hover:bg-muted" onClick={() => move(i, -1)} disabled={busy || i === 0}><ChevronUp className="w-4 h-4" /></button>
                        <button type="button" className="p-1 rounded hover:bg-muted" onClick={() => move(i, 1)} disabled={busy || i === pages.length - 1}><ChevronDown className="w-4 h-4" /></button>
                      </div>
                      <button type="button" className="p-1.5 rounded text-destructive hover:bg-destructive/10" onClick={() => remove(p.id)} disabled={busy}><Trash2 className="w-4 h-4" /></button>
                    </div>
                  ))}
                </div>
              )}

              {busy && (
                <div className="rounded-xl border bg-primary/5 p-4 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm font-medium text-primary">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      {phase || "Working…"}
                    </div>
                    <span className="font-mono text-sm tabular-nums font-semibold">{formatHMS(elapsed)}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full bg-primary transition-all duration-500"
                      style={{ width: `${Math.min(100, ((previewIndex + 1) / Math.max(pages.length, 1)) * 100)}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Page {Math.min(previewIndex + 1, pages.length)} of {pages.length} · keep this screen open
                  </p>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="flex rounded-lg border p-0.5 bg-muted/30">
                {(["text", "side", "original"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={`flex-1 text-xs sm:text-sm py-2 rounded-md font-medium ${viewMode === m ? "bg-background shadow-sm" : "text-muted-foreground"}`}
                    onClick={() => setViewMode(m)}
                  >
                    {m === "text" ? "Text" : m === "side" ? "Side by side" : "Original"}
                  </button>
                ))}
              </div>

              {viewMode === "text" && (
                <textarea
                  className="w-full min-h-[280px] rounded-xl border bg-card p-3 text-sm font-sans leading-relaxed"
                  value={editedDoc ?? ""}
                  onChange={(e) => setEditedDoc(e.target.value)}
                />
              )}

              {viewMode === "original" && (
                <div className="space-y-2">
                  <div className="flex gap-1 overflow-x-auto pb-1">
                    {pages.map((p, i) => (
                      <button key={p.id} type="button" onClick={() => setPreviewIndex(i)} className={`px-2 py-1 rounded-md text-xs border shrink-0 ${previewIndex === i ? "bg-primary text-primary-foreground" : ""}`}>
                        Page {i + 1}
                      </button>
                    ))}
                  </div>
                  {pages[previewIndex]?.previewUrl ? (
                    <button type="button" className="w-full" onClick={() => setLightboxUrl(pages[previewIndex].previewUrl)}>
                      <img src={pages[previewIndex].previewUrl} alt="" className="w-full rounded-lg border max-h-72 object-contain bg-muted" />
                    </button>
                  ) : (
                    <p className="text-sm text-muted-foreground p-4 border rounded-lg">Document — image preview N/A</p>
                  )}
                </div>
              )}

              {viewMode === "side" && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase flex items-center gap-1"><Columns2 className="w-3 h-3" /> Original</p>
                    <div className="flex gap-1 overflow-x-auto">
                      {pages.map((p, i) => (
                        <button key={p.id} type="button" onClick={() => setPreviewIndex(i)} className={`px-2 py-1 rounded text-[10px] border ${previewIndex === i ? "bg-primary text-primary-foreground" : ""}`}>
                          {i + 1}
                        </button>
                      ))}
                    </div>
                    {pages[previewIndex]?.previewUrl ? (
                      <button type="button" className="w-full" onClick={() => setLightboxUrl(pages[previewIndex].previewUrl!)}>
                        <img src={pages[previewIndex].previewUrl} alt="" className="w-full rounded-lg border max-h-56 object-contain bg-muted" />
                      </button>
                    ) : (
                      <div className="h-40 rounded-lg border bg-muted flex items-center justify-center text-xs text-muted-foreground">No image</div>
                    )}
                  </div>
                  <div className="space-y-2">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase">Extracted (page {previewIndex + 1})</p>
                    <div className="rounded-lg border bg-card p-2 text-xs max-h-56 overflow-y-auto whitespace-pre-wrap font-sans">
                      {result.pages[previewIndex]?.isBlank
                        ? (result.pages[previewIndex]?.warnings?.[0] || "No text on this page")
                        : (result.pages[previewIndex]?.text || "—")}
                    </div>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" className="gap-1" onClick={exportTxt}><Download className="w-3.5 h-3.5" />TXT</Button>
                <Button size="sm" variant="outline" className="gap-1" onClick={exportDoc}><Download className="w-3.5 h-3.5" />DOC</Button>
                <Button size="sm" variant="outline" className="gap-1" onClick={exportPdf}><Download className="w-3.5 h-3.5" />PDF</Button>
                {(result.pages || []).some((x) => x.isBlank) && (
                  <Button size="sm" variant="secondary" onClick={() => { setResult(null); setEditedDoc(null); }}>
                    Retry convert
                  </Button>
                )}
              </div>

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
                {busy ? formatHMS(elapsed) : "Convert to digital notes"}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" className="flex-1" onClick={() => { setResult(null); setEditedDoc(null); }} disabled={saving}>Back</Button>
              <Button className="flex-1 gap-1.5" onClick={save} disabled={saving || !(editedDoc || result.document)?.trim()}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                Save to Note tab
              </Button>
            </>
          )}
        </div>
      </div>

      {lightboxUrl && (
        <div
          className="fixed inset-0 z-[70] bg-black/90 flex items-center justify-center p-4"
          onClick={() => setLightboxUrl(null)}
        >
          <button type="button" className="absolute top-4 right-4 text-white p-2" onClick={() => setLightboxUrl(null)}>
            <X className="w-6 h-6" />
          </button>
          <img src={lightboxUrl} alt="Preview" className="max-w-full max-h-full object-contain" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}
