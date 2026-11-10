/**
 * Isolated handwritten / document digitization UI for Write My Note.
 * Does not modify Live Session recording, audio upload, or video flows.
 */
import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  X, Upload, Loader2, FileText, Trash2, Sparkles, AlertTriangle, Check,
  ChevronUp, ChevronDown, Download, Columns2,
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

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Minimal DOCX (Word will open plain OOXML with one paragraph body). */
function textToDocxBlob(text: string): Blob {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const paras = text.split(/\n/).map((line) =>
    `<w:p><w:r><w:t xml:space="preserve">${esc(line)}</w:t></w:r></w:p>`
  ).join("");
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${paras}<w:sectPr/></w:body>
</w:document>`;
  // Without zip, many editors reject — use HTML disguised as .doc for mobile compatibility
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"></head><body>${
    text.split("\n").map((l) => `<p>${esc(l) || "&nbsp;"}</p>`).join("")
  }</body></html>`;
  return new Blob(["\ufeff", html], { type: "application/msword" });
}

type Props = {
  open: boolean;
  onClose: () => void;
  onComplete: (result: DigitizeResult) => void;
};

export default function HandwrittenDigitize({ open, onClose, onComplete }: Props) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const dragFrom = useRef<number | null>(null);
  const [pages, setPages] = useState<DigitizePagePreview[]>([]);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState("");
  const [editedDoc, setEditedDoc] = useState<string | null>(null);
  const [result, setResult] = useState<DigitizeResult | null>(null);
  const [viewMode, setViewMode] = useState<"text" | "original" | "side">("text");
  const [previewIndex, setPreviewIndex] = useState(0);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

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
    setPhase("Uploading pages…");
    try {
      const form = new FormData();
      pages.forEach((p) => form.append("pages", p.file, p.file.name || "page"));
      form.append("order", pages.map((_, i) => i).join(","));

      setPhase("Recognizing handwriting (exact text only)…");
      const headers = await getAuthHeaders();
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
            if (p.previewUrl) photoDataUrls.push(p.previewUrl);
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
      setViewMode("side");
      const blank = (out.pages || []).filter((x: any) => x.isBlank).length;
      const total = (out.pages || []).length || 1;
      if (blank === total) {
        toast({
          title: "OCR busy — try again",
          description: data.modelError || data.message || "The vision model was overloaded. Tap Convert again in a few seconds.",
          variant: "destructive",
        });
      } else if (blank > 0) {
        toast({
          title: `Got ${total - blank} of ${total} pages`,
          description: "Some pages failed (provider busy). You can Convert again or edit the text.",
        });
      } else {
        toast({ title: "Digital notes ready", description: data.message || "Review, export, or save as a new page." });
      }
    } catch (e: any) {
      toast({ title: "Digitize failed", description: e?.message || "Try again", variant: "destructive" });
    } finally {
      setBusy(false);
      setPhase("");
    }
  };

  const exportTxt = () => {
    const text = editedDoc ?? result?.document ?? "";
    downloadBlob("lenory-digital-notes.txt", new Blob([text], { type: "text/plain;charset=utf-8" }));
  };

  const exportDoc = () => {
    const text = editedDoc ?? result?.document ?? "";
    downloadBlob("lenory-digital-notes.doc", textToDocxBlob(text));
  };

  const exportPdf = async () => {
    const text = editedDoc ?? result?.document ?? "";
    try {
      const headers = await getAuthHeaders();
      const res = await fetch("/api/assistant/generate-file", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          format: "pdf",
          title: "Digital notes",
          content: text,
        }),
      });
      if (res.ok) {
        const ct = res.headers.get("content-type") || "";
        if (ct.includes("application/json")) {
          const j = await res.json();
          if (j.url) {
            window.open(j.url, "_blank");
            return;
          }
          if (j.downloadUrl) {
            window.open(j.downloadUrl, "_blank");
            return;
          }
        } else {
          const blob = await res.blob();
          downloadBlob("lenory-digital-notes.pdf", blob);
          return;
        }
      }
    } catch {}
    // Fallback: print-friendly HTML → user can Save as PDF
    const w = window.open("", "_blank");
    if (w) {
      w.document.write(`<html><head><title>Digital notes</title><style>body{font-family:system-ui;padding:24px;white-space:pre-wrap;line-height:1.5}</style></head><body>${
        (text || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      }</body></html>`);
      w.document.close();
      w.focus();
      setTimeout(() => w.print(), 400);
    } else {
      toast({ title: "Allow pop-ups to export PDF", variant: "destructive" });
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
            <p className="text-xs text-muted-foreground">Creates a <strong>new page</strong> in this topic · exact text only</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} disabled={busy}><X className="w-5 h-5" /></Button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {!result ? (
            <>
              <div
                className="rounded-xl border border-dashed p-6 text-center space-y-2 cursor-pointer hover:bg-muted/40"
                onClick={() => inputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
                }}
              >
                <Upload className="w-8 h-8 mx-auto text-primary" />
                <p className="text-sm font-medium">Select or drop photos / documents</p>
                <p className="text-xs text-muted-foreground">JPG, PNG, WEBP, HEIC, PDF, DOCX, TXT. No audio/video.</p>
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
                    {pages.length} page{pages.length === 1 ? "" : "s"} · drag to reorder
                  </p>
                  {pages.map((p, i) => (
                    <div
                      key={p.id}
                      draggable
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
                      className={`flex items-center gap-2 rounded-lg border p-2 cursor-grab active:cursor-grabbing ${
                        dragOverIdx === i ? "border-primary bg-primary/5" : ""
                      }`}
                    >
                      {p.kind === "image" && p.previewUrl ? (
                        <img src={p.previewUrl} alt="" className="w-12 h-12 object-cover rounded-md shrink-0 pointer-events-none" />
                      ) : (
                        <div className="w-12 h-12 rounded-md bg-muted flex items-center justify-center shrink-0">
                          <FileText className="w-5 h-5 text-muted-foreground" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm truncate font-medium">{p.file.name}</p>
                        <p className="text-[10px] text-muted-foreground">Page {i + 1} · {(p.file.size / 1024).toFixed(0)} KB</p>
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
                    <img src={pages[previewIndex].previewUrl} alt="" className="w-full rounded-lg border max-h-72 object-contain bg-muted" />
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
                      <img src={pages[previewIndex].previewUrl} alt="" className="w-full rounded-lg border max-h-56 object-contain bg-muted" />
                    ) : (
                      <div className="h-40 rounded-lg border bg-muted flex items-center justify-center text-xs text-muted-foreground">No image</div>
                    )}
                  </div>
                  <div className="space-y-2">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase">Extracted text (page {previewIndex + 1})</p>
                    <div className="rounded-lg border bg-card p-2 text-xs max-h-56 overflow-y-auto whitespace-pre-wrap font-sans">
                      {result.pages[previewIndex]?.isBlank
                      ? (result.pages[previewIndex]?.warnings?.[0] || "No text on this page — try Convert again")
                      : (result.pages[previewIndex]?.text || "—")}
                    </div>
                    {result.pages[previewIndex]?.warnings?.length ? (
                      <div className="text-[10px] text-amber-600 flex gap-1"><AlertTriangle className="w-3 h-3" />{result.pages[previewIndex].warnings.join(" · ")}</div>
                    ) : null}
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" className="gap-1" onClick={exportTxt}><Download className="w-3.5 h-3.5" />TXT</Button>
                <Button size="sm" variant="outline" className="gap-1" onClick={exportDoc}><Download className="w-3.5 h-3.5" />DOC</Button>
                <Button size="sm" variant="outline" className="gap-1" onClick={exportPdf}><Download className="w-3.5 h-3.5" />PDF</Button>
                {(result.pages || []).some((x) => x.isBlank) && (
                  <Button size="sm" variant="secondary" className="gap-1" onClick={() => { setResult(null); setEditedDoc(null); }} disabled={busy}>
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
                Convert to digital notes
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" className="flex-1" onClick={() => { setResult(null); setEditedDoc(null); }} disabled={busy}>Back</Button>
              <Button className="flex-1 gap-1.5" onClick={save}>
                <Check className="w-4 h-4" /> Save as new page
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
