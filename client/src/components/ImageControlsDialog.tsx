import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { apiRequest } from "@/lib/queryClient";
import { Loader2, ImageIcon, RefreshCw } from "lucide-react";

interface Svc { id: string; label: string; kind: string; provider: string; providerUsd: number; credits: number; enabled: boolean; premiumOnly?: boolean; help: string }
interface Controls { master: number; caps: { free: number; pro: number; premium: number }; services: Svc[]; stability: { ok: boolean; credits?: number; error?: string }; geminiKey: boolean; note: string }
const KINDS: Record<string, string> = { generate: "Make pictures", upscale: "Upscale", edit: "Edit", control: "Control", "3d": "3D" };
const CREDIT_USD = 0.002; // rough value of one LENORY credit on the paid plans (admin can judge with their own rate)

/** Admin > Credit Usage > Image controls: switches, prices, monthly caps and a live provider check. */
export default function ImageControlsDialog() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<Record<string, string>>({});
  const { data, isFetching, refetch } = useQuery<Controls>({
    queryKey: ["/api/admin/image-controls"],
    queryFn: async () => (await apiRequest("GET", "/api/admin/image-controls")).json(),
    enabled: open,
  });
  const put = async (key: string, value: number) => {
    setMsg((m) => ({ ...m, [key]: "Saving..." }));
    try {
      const r = await apiRequest("PUT", `/api/admin/feature-costs/${key}`, { cost: Math.round(value) });
      const b = await r.json().catch(() => ({}));
      if (!r.ok || b?.success === false) throw new Error(b?.message || `HTTP ${r.status}`);
      setMsg((m) => ({ ...m, [key]: "Saved" }));
      qc.invalidateQueries({ queryKey: ["/api/admin/image-controls"] });
    } catch (e: any) { setMsg((m) => ({ ...m, [key]: `Error: ${String(e?.message).slice(0, 90)}` })); }
  };
  const val = (key: string, fallback: number) => draft[key] ?? String(fallback);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" data-testid="button-image-controls"><ImageIcon className="w-4 h-4 mr-2" />Image controls</Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[88vh] overflow-y-auto" data-testid="dialog-image-controls">
        <DialogHeader>
          <DialogTitle>Image controls</DialogTitle>
          <DialogDescription>Switch image features on or off, set what each costs students in credits, and set monthly image limits per plan.</DialogDescription>
        </DialogHeader>
        {!data ? <div className="py-8 flex justify-center"><Loader2 className="w-5 h-5 animate-spin" /></div> : (
          <div className="space-y-5">
            <div className="rounded-lg border p-3 flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-[220px] text-sm">
                <p className="font-medium">Stability key</p>
                {data.stability.ok ? <p className="text-green-600">Working. Provider balance: {data.stability.credits} credits (about ${((data.stability.credits || 0) * 0.01).toFixed(2)}).</p> : <p className="text-destructive">{data.stability.error}</p>}
                <p className="text-xs text-muted-foreground mt-1">Gemini key for Nano Banana: {data.geminiKey ? "set" : "missing"}. {data.note}</p>
              </div>
              <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}><RefreshCw className={`w-4 h-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />Re-check</Button>
            </div>
            <div className="rounded-lg border p-3 flex items-center justify-between">
              <div><p className="text-sm font-medium">All image features</p><p className="text-xs text-muted-foreground">Master switch. Off stops every picture in Chat and Live AI.</p></div>
              <Switch checked={data.master > 0} onCheckedChange={(v) => put("img_master", v ? 1 : 0)} data-testid="switch-image-master" />
            </div>
            <div>
              <p className="text-sm font-medium mb-2">Monthly image limit per plan</p>
              <div className="grid grid-cols-3 gap-3">
                {(["free", "pro", "premium"] as const).map((p) => {
                  const key = `image_cap_${p}`;
                  return (
                    <div key={p} className="space-y-1">
                      <label className="text-xs text-muted-foreground capitalize">{p}</label>
                      <div className="flex gap-1"><Input type="number" min={0} value={val(key, data.caps[p])} onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))} /><Button size="sm" onClick={() => put(key, Number(val(key, data.caps[p])))}>Save</Button></div>
                      <p className="text-[11px] text-muted-foreground">{msg[key]}</p>
                    </div>
                  );
                })}
              </div>
            </div>
            {Object.keys(KINDS).map((kind) => {
              const rows = data.services.filter((s) => s.kind === kind);
              if (!rows.length) return null;
              return (
                <div key={kind}>
                  <p className="text-sm font-medium mb-2">{KINDS[kind]}</p>
                  <div className="space-y-2">
                    {rows.map((s) => {
                      const ck = `img_${s.id}`, ok = `img_on_${s.id}`;
                      const credits = Number(val(ck, s.credits));
                      const margin = s.providerUsd > 0 ? (credits * CREDIT_USD) / s.providerUsd : 0;
                      return (
                        <div key={s.id} className="rounded-lg border p-3 grid gap-2 sm:grid-cols-[1fr_auto_auto] items-center">
                          <div className="min-w-0">
                            <p className="text-sm font-medium">{s.label}{s.premiumOnly ? " (Premium only)" : ""}</p>
                            <p className="text-xs text-muted-foreground">{s.help}. Costs us about ${s.providerUsd.toFixed(3)}. At ~${CREDIT_USD}/credit you earn {margin.toFixed(1)}x.</p>
                            <p className="text-[11px] text-muted-foreground">{msg[ck] || msg[ok]}</p>
                          </div>
                          <div className="flex gap-1"><Input className="w-20" type="number" min={0} value={val(ck, s.credits)} onChange={(e) => setDraft((d) => ({ ...d, [ck]: e.target.value }))} /><Button size="sm" onClick={() => put(ck, credits)}>Save</Button></div>
                          <Switch checked={s.enabled} onCheckedChange={(v) => put(ok, v ? 1 : 0)} />
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
