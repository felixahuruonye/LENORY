/**
 * Free, zero-latency SVG diagram generator.
 * The model provides structured JSON; this code converts it to a clean, correct SVG.
 * No API calls, no credits charged, no external dependency.
 */
import type { ToolContext, ToolResult } from "../types";
import { saveImage } from "../../imageStudio";

const ESC = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Map 1–N data into screen coordinates. */
function scale(val: number, min: number, max: number, lo: number, hi: number): number {
  if (max === min) return (lo + hi) / 2;
  return lo + ((val - min) / (max - min)) * (hi - lo);
}

export async function toolGenerateDiagram(ctx: ToolContext, args: {
  kind: "line_graph" | "bar_chart" | "scatter" | "table" | "flowchart" | "pie_chart";
  title?: string;
  x_label?: string;
  y_label?: string;
  series?: { name: string; color?: string; points?: [number, number][]; values?: number[] }[];
  x_categories?: string[];
  rows?: string[][];         // for table
  nodes?: { id: string; label: string }[];  // for flowchart
  edges?: { from: string; to: string; label?: string }[];
  save?: boolean;
}): Promise<ToolResult> {
  const W = 700, H = 440, PAD = { top: 50, right: 30, bottom: 70, left: 70 };
  const BW = W - PAD.left - PAD.right, BH = H - PAD.top - PAD.bottom;
  const COLS = ["#5B6EFF","#FF5B72","#1EC991","#FFB340","#A259FF","#36B4FF","#FF7849"];
  const col = (i: number, override?: string) => override || COLS[i % COLS.length];
  const title = ESC(args.title || "");

  const header = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="system-ui,Arial,sans-serif">
  <rect width="${W}" height="${H}" fill="#0F1117" rx="10"/>
  ${title ? `<text x="${W/2}" y="30" text-anchor="middle" fill="#fff" font-size="17" font-weight="600">${title}</text>` : ""}`;
  const footer = `</svg>`;
  const axes = (xl: string, yl: string) =>
    `<line x1="${PAD.left}" y1="${PAD.top}" x2="${PAD.left}" y2="${PAD.top+BH}" stroke="#444" stroke-width="1.5"/>
     <line x1="${PAD.left}" y1="${PAD.top+BH}" x2="${PAD.left+BW}" y2="${PAD.top+BH}" stroke="#444" stroke-width="1.5"/>
     ${xl ? `<text x="${PAD.left+BW/2}" y="${H-8}" text-anchor="middle" fill="#aaa" font-size="13">${ESC(xl)}</text>` : ""}
     ${yl ? `<text x="14" y="${PAD.top+BH/2}" text-anchor="middle" fill="#aaa" font-size="13" transform="rotate(-90,14,${PAD.top+BH/2})">${ESC(yl)}</text>` : ""}`;

  let body = "";

  if (args.kind === "line_graph" || args.kind === "scatter") {
    const series = args.series || [];
    const allX = series.flatMap(s => (s.points||[]).map(p => p[0]));
    const allY = series.flatMap(s => (s.points||[]).map(p => p[1]));
    const [minX,maxX,minY,maxY] = [Math.min(...allX),Math.max(...allX),Math.min(...allY),Math.max(...allY)];
    const px = (x: number) => scale(x, minX, maxX, PAD.left, PAD.left+BW);
    const py = (y: number) => scale(y, minY, maxY, PAD.top+BH, PAD.top);
    // Grid
    for (let i=0;i<=5;i++) {
      const y=PAD.top + BH - i*BH/5; const v=minY+i*(maxY-minY)/5;
      body+=`<line x1="${PAD.left}" y1="${y}" x2="${PAD.left+BW}" y2="${y}" stroke="#222" stroke-width="1"/>
             <text x="${PAD.left-6}" y="${y+4}" text-anchor="end" fill="#aaa" font-size="11">${Number(v.toFixed(2))}</text>`;
    }
    for (let i=0;i<=5;i++) {
      const x=PAD.left + i*BW/5; const v=minX+i*(maxX-minX)/5;
      body+=`<line x1="${x}" y1="${PAD.top}" x2="${x}" y2="${PAD.top+BH}" stroke="#222" stroke-width="1"/>
             <text x="${x}" y="${PAD.top+BH+16}" text-anchor="middle" fill="#aaa" font-size="11">${Number(v.toFixed(2))}</text>`;
    }
    body += axes(args.x_label||"", args.y_label||"");
    series.forEach((s,si) => {
      const c=col(si,s.color); const pts=(s.points||[]).map(([x,y])=>`${px(x).toFixed(1)},${py(y).toFixed(1)}`);
      if (args.kind === "line_graph" && pts.length>1) body+=`<polyline points="${pts.join(" ")}" fill="none" stroke="${c}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
      (s.points||[]).forEach(([x,y])=>{ body+=`<circle cx="${px(x).toFixed(1)}" cy="${py(y).toFixed(1)}" r="4" fill="${c}"/>`; });
      if (s.name) body+=`<text x="${PAD.left+BW+8}" y="${PAD.top+si*18}" fill="${c}" font-size="12">${ESC(s.name)}</text>`;
    });
  }
  else if (args.kind === "bar_chart") {
    const cats = args.x_categories || [];
    const series = args.series || [];
    const vals = series.flatMap(s => s.values||[]);
    const maxV = Math.max(...vals, 0); const minV = Math.min(...vals, 0);
    const nG = cats.length || 1; const nS = series.length || 1;
    const gW = BW/nG; const bW = gW*0.7/nS;
    const py = (v:number) => scale(v, minV, maxV, PAD.top+BH, PAD.top);
    for (let i=1;i<=5;i++) {
      const y=PAD.top+BH-i*BH/5; const v=minV+i*(maxV-minV)/5;
      body+=`<line x1="${PAD.left}" y1="${y}" x2="${PAD.left+BW}" y2="${y}" stroke="#222" stroke-width="1"/>
             <text x="${PAD.left-6}" y="${y+4}" text-anchor="end" fill="#aaa" font-size="11">${Number(v.toFixed(1))}</text>`;
    }
    body += axes(args.x_label||"", args.y_label||"");
    cats.forEach((cat,gi) => {
      const gx=PAD.left + gi*gW;
      series.forEach((s,si) => {
        const v=(s.values||[])[gi]||0; const c=col(si,s.color);
        const x=gx+(si-(nS-1)/2)*bW*1.1+gW/2-bW/2;
        const y=py(Math.max(v,0)); const h=Math.abs(py(v)-py(0));
        body+=`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bW.toFixed(1)}" height="${Math.max(h,1).toFixed(1)}" fill="${c}" rx="3"/>
               <text x="${(x+bW/2).toFixed(1)}" y="${(y-5).toFixed(1)}" text-anchor="middle" fill="${c}" font-size="10">${Number(v.toFixed(1))}</text>`;
      });
      body+=`<text x="${(gx+gW/2).toFixed(1)}" y="${PAD.top+BH+16}" text-anchor="middle" fill="#aaa" font-size="11">${ESC(cat)}</text>`;
    });
    if (nS>1) series.forEach((s,si)=>{ body+=`<rect x="${PAD.left+si*90}" y="${H-20}" width="12" height="12" fill="${col(si,s.color)}" rx="2"/><text x="${PAD.left+si*90+16}" y="${H-10}" fill="#ccc" font-size="11">${ESC(s.name||"")}</text>`; });
  }
  else if (args.kind === "pie_chart") {
    const vals = (args.series?.[0]?.values || []);
    const labels = args.x_categories || [];
    const total = vals.reduce((a,b)=>a+b,0) || 1;
    const cx=W/2, cy=(H+PAD.top)/2, r=Math.min(BH,BW)/2.4;
    let angle=-Math.PI/2;
    vals.forEach((v,i)=>{
      const frac=v/total; const a2=angle+frac*2*Math.PI; const c=col(i);
      const lx=Math.cos(angle+frac*Math.PI)*r; const ly=Math.sin(angle+frac*Math.PI)*r;
      const x1=cx+Math.cos(angle)*r, y1=cy+Math.sin(angle)*r;
      const x2=cx+Math.cos(a2)*r, y2=cy+Math.sin(a2)*r;
      const large=frac>0.5?1:0;
      body+=`<path d="M${cx},${cy} L${x1.toFixed(1)},${y1.toFixed(1)} A${r},${r} 0 ${large},1 ${x2.toFixed(1)},${y2.toFixed(1)} Z" fill="${c}"/>
             <text x="${(cx+lx*0.7).toFixed(1)}" y="${(cy+ly*0.7).toFixed(1)}" text-anchor="middle" fill="#fff" font-size="11" font-weight="600">${(frac*100).toFixed(1)}%</text>`;
      if (labels[i]) body+=`<rect x="${PAD.left+(i%3)*150}" y="${H-30-Math.floor(i/3)*18}" width="12" height="12" fill="${c}" rx="2"/><text x="${PAD.left+16+(i%3)*150}" y="${H-20-Math.floor(i/3)*18}" fill="#ccc" font-size="11">${ESC(labels[i])}</text>`;
      angle=a2;
    });
  }
  else if (args.kind === "table") {
    const rows = args.rows || [];
    if (!rows.length) return { tool: "generate_diagram", success: false, summary: "Table needs at least one row of data.", error: "EMPTY" };
    const cols = Math.max(...rows.map(r=>r.length));
    const cw = BW/cols, rh = Math.min(40, BH/rows.length);
    rows.forEach((row,ri)=>{
      row.forEach((cell,ci)=>{
        const x=PAD.left+ci*cw, y=PAD.top+ri*rh;
        body+=`<rect x="${x}" y="${y}" width="${cw}" height="${rh}" fill="${ri===0?"#2a2d3e":"#1a1d2e"}" stroke="#333" stroke-width="0.5"/>
               <text x="${(x+cw/2).toFixed(1)}" y="${(y+rh/2+4).toFixed(1)}" text-anchor="middle" fill="${ri===0?"#fff":"#ddd"}" font-size="${Math.min(12,cw/5)}" font-weight="${ri===0?"600":"400"}">${ESC(String(cell||""))}</text>`;
      });
    });
  }
  else if (args.kind === "flowchart") {
    const nodes = args.nodes || [];
    const edges = args.edges || [];
    const nw=120, nh=44, cols=3;
    const positions: Record<string,{x:number,y:number}> = {};
    nodes.forEach((n,i)=>{
      const col=i%cols, row=Math.floor(i/cols);
      const x=PAD.left+col*(BW/cols)+BW/(cols*2)-nw/2;
      const y=PAD.top+row*(BH/Math.ceil(nodes.length/cols))+20;
      positions[n.id]={x,y};
      body+=`<rect x="${x}" y="${y}" width="${nw}" height="${nh}" rx="8" fill="#2a2d3e" stroke="#5B6EFF" stroke-width="1.5"/>
             <text x="${(x+nw/2).toFixed(1)}" y="${(y+nh/2+5).toFixed(1)}" text-anchor="middle" fill="#fff" font-size="12">${ESC(n.label)}</text>`;
    });
    edges.forEach(e=>{
      const f=positions[e.from], t=positions[e.to];
      if (!f||!t) return;
      const mx=(f.x+nw/2+t.x+nw/2)/2, my=(f.y+nh/2+t.y+nh/2)/2;
      body+=`<defs><marker id="arr" markerWidth="8" markerHeight="8" refX="4" refY="2" orient="auto"><path d="M0,0 L4,2 L0,4" fill="none" stroke="#888" stroke-width="1"/></marker></defs>
             <line x1="${(f.x+nw/2).toFixed(1)}" y1="${(f.y+nh).toFixed(1)}" x2="${(t.x+nw/2).toFixed(1)}" y2="${t.y.toFixed(1)}" stroke="#888" stroke-width="1.5" marker-end="url(#arr)"/>
             ${e.label ? `<text x="${mx.toFixed(1)}" y="${my.toFixed(1)}" text-anchor="middle" fill="#aaa" font-size="10">${ESC(e.label)}</text>` : ""}`;
    });
  }

  if (!body) return { tool: "generate_diagram", success: false, summary: `Diagram kind "${args.kind}" needs data.`, error: "EMPTY" };
  const svg = header + body + footer;

  if (args.save) {
    try {
      const { renderImage } = await import("../../assistant/formats");
      const pngBuf = await renderImage("png", svg);
      const saved = await saveImage(ctx.userId, { buffer: pngBuf, mime: "image/png" }, { prompt: args.title || "diagram", provider: "svg:local" });
      return { tool: "generate_diagram", success: true, images: [{ url: saved.url, id: saved.id, title: args.title || "Diagram" }], summary: `Diagram saved to your image history.` };
    } catch {}
  }
  // Inline SVG delivery: encode as a data URI the chat can render
  const dataUri = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  return {
    tool: "generate_diagram",
    success: true,
    images: [{ url: dataUri, title: args.title || "Diagram", id: `svg_${Date.now()}` }],
    summary: `Diagram ready and shown in the chat. No credits were used.`,
    data: { svg }
  };
}
