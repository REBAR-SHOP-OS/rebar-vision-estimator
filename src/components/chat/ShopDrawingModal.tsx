import React, { useState, useEffect, useRef, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Printer, Trash2, Eye, Clock, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getLogoDataUri } from "@/lib/logo-base64";

const SHOP_DRAWING_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-shop-drawing`;

interface ShopDrawingOptions {
  scale: string;
  includeDims: boolean;
  layerGrouping: boolean;
  barMarks: boolean;
  drawingPrefix: string;
  notes: string;
}

interface HistoryEntry {
  id: string;
  version: number;
  options: ShopDrawingOptions;
  html_content: string;
  created_at: string;
}

interface ShopDrawingModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  quoteResult: any;
  elements: any[];
  scopeData?: any;
  projectId?: string;
}

type ModalPhase = "options" | "generating" | "preview";

const DEFAULT_OPTIONS: ShopDrawingOptions = {
  scale: "1:50",
  includeDims: true,
  layerGrouping: true,
  barMarks: true,
  drawingPrefix: "SD-",
  notes: "",
};

const PROGRESS_STEPS = [
  { pct: 20, label: "Preparing bar data..." },
  { pct: 60, label: "Generating shop drawing layout..." },
  { pct: 90, label: "Adding dimensions and annotations..." },
];

export default function ShopDrawingModal({ open, onOpenChange, quoteResult, elements, scopeData, projectId }: ShopDrawingModalProps) {
  const [phase, setPhase] = useState<ModalPhase>("options");
  const [options, setOptions] = useState<ShopDrawingOptions>(DEFAULT_OPTIONS);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");
  const [htmlContent, setHtmlContent] = useState("");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("generate");
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const abortRef = useRef(false);

  const barList: any[] = quoteResult?.quote?.bar_list || [];
  const sizeBreakdown: Record<string, number> = quoteResult?.quote?.size_breakdown || {};

  const loadHistory = useCallback(async () => {
    if (!projectId) return;
    setHistoryLoading(true);
    try {
      const { data, error } = await supabase
        .from("shop_drawings")
        .select("id, version, options, html_content, created_at")
        .eq("project_id", projectId)
        .order("version", { ascending: false });
      if (error) throw error;
      setHistory((data as any[]) || []);
    } catch {
      // silent
    }
    setHistoryLoading(false);
  }, [projectId]);

  useEffect(() => {
    if (open && activeTab === "history") loadHistory();
  }, [open, activeTab, loadHistory]);

  useEffect(() => {
    if (!open) {
      // reset on close
      setPhase("options");
      setProgress(0);
      setHtmlContent("");
    }
  }, [open]);

  const handleGenerate = async () => {
    setPhase("generating");
    setProgress(0);
    setProgressLabel(PROGRESS_STEPS[0].label);
    abortRef.current = false;

    // Simulated progress
    const timers: ReturnType<typeof setTimeout>[] = [];
    timers.push(setTimeout(() => { if (!abortRef.current) { setProgress(20); setProgressLabel(PROGRESS_STEPS[0].label); } }, 300));
    timers.push(setTimeout(() => { if (!abortRef.current) { setProgress(60); setProgressLabel(PROGRESS_STEPS[1].label); } }, 2500));
    timers.push(setTimeout(() => { if (!abortRef.current) { setProgress(90); setProgressLabel(PROGRESS_STEPS[2].label); } }, 6000));

    try {
      const resp = await fetch(SHOP_DRAWING_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          barList,
          elements: quoteResult.quote.elements,
          projectName: scopeData?.projectName,
          clientName: scopeData?.clientName,
          standard: scopeData?.standard,
          coatingType: scopeData?.coatingType,
          sizeBreakdown,
          options,
        }),
      });

      timers.forEach(clearTimeout);

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: "Failed" }));
        throw new Error(err.error || "Shop drawing generation failed");
      }

      const data = await resp.json();
      if (!data.html) throw new Error("No HTML returned");

      setProgress(100);
      setProgressLabel("Done!");
      setHtmlContent(data.html);

      // Save to DB
      if (projectId) {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const nextVersion = history.length > 0 ? Math.max(...history.map(h => h.version)) + 1 : 1;
          await supabase.from("shop_drawings").insert({
            project_id: projectId,
            user_id: user.id,
            options: options as any,
            html_content: data.html,
            version: nextVersion,
          });
        }
      }

      setTimeout(() => setPhase("preview"), 400);
    } catch (err: any) {
      timers.forEach(clearTimeout);
      abortRef.current = true;
      toast.error(err.message || "Generation failed");
      setPhase("options");
    }
  };

  const handlePrint = () => {
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.print();
    }
  };

  const handleViewHistory = (entry: HistoryEntry) => {
    setHtmlContent(entry.html_content);
    setPhase("preview");
    setActiveTab("generate");
  };

  const handleDeleteHistory = async (id: string) => {
    await supabase.from("shop_drawings").delete().eq("id", id);
    setHistory(prev => prev.filter(h => h.id !== id));
    toast.success("Drawing deleted");
  };

  const iframeSrcDoc = htmlContent || "<html><body><p>No preview</p></body></html>";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full sm:max-w-3xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings2 className="h-5 w-5" />
            Shop Drawing
          </DialogTitle>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
          <TabsList className="w-full">
            <TabsTrigger value="generate" className="flex-1">Generate</TabsTrigger>
            <TabsTrigger value="history" className="flex-1">History</TabsTrigger>
          </TabsList>

          <TabsContent value="generate" className="flex-1 flex flex-col min-h-0 overflow-auto">
            {phase === "options" && (
              <div className="space-y-4 p-1">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Scale</Label>
                    <Select value={options.scale} onValueChange={v => setOptions(o => ({ ...o, scale: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1:1">1:1</SelectItem>
                        <SelectItem value="1:25">1:25</SelectItem>
                        <SelectItem value="1:50">1:50</SelectItem>
                        <SelectItem value="1:100">1:100</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Drawing Number Prefix</Label>
                    <Input value={options.drawingPrefix} onChange={e => setOptions(o => ({ ...o, drawingPrefix: e.target.value }))} placeholder="SD-" />
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label>Include Dimensions</Label>
                    <Switch checked={options.includeDims} onCheckedChange={v => setOptions(o => ({ ...o, includeDims: v }))} />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label>Layer Grouping</Label>
                    <Switch checked={options.layerGrouping} onCheckedChange={v => setOptions(o => ({ ...o, layerGrouping: v }))} />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label>Show Bar Marks</Label>
                    <Switch checked={options.barMarks} onCheckedChange={v => setOptions(o => ({ ...o, barMarks: v }))} />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Special Notes</Label>
                  <Textarea value={options.notes} onChange={e => setOptions(o => ({ ...o, notes: e.target.value }))} placeholder="Any notes to include on the drawing..." rows={3} />
                </div>

                <Button onClick={handleGenerate} className="w-full">Generate Shop Drawing</Button>
              </div>
            )}

            {phase === "generating" && (
              <div className="flex flex-col items-center justify-center py-16 gap-4">
                <Loader2 className="h-10 w-10 animate-spin text-primary" />
                <Progress value={progress} className="w-64" />
                <p className="text-sm text-muted-foreground">{progressLabel}</p>
              </div>
            )}

            {phase === "preview" && (
              <div className="flex flex-col gap-3 flex-1 min-h-0">
                <div className="flex gap-2">
                  <Button onClick={handlePrint} className="gap-2">
                    <Printer className="h-4 w-4" /> Print / Save PDF
                  </Button>
                  <Button variant="outline" onClick={() => { setPhase("options"); setHtmlContent(""); }}>New Drawing</Button>
                </div>
                <iframe
                  ref={iframeRef}
                  srcDoc={iframeSrcDoc}
                  className="flex-1 w-full min-h-[400px] border rounded-lg bg-white"
                  title="Shop Drawing Preview"
                  sandbox="allow-same-origin allow-scripts allow-modals"
                />
              </div>
            )}
          </TabsContent>

          <TabsContent value="history" className="flex-1 overflow-auto">
            {historyLoading ? (
              <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
            ) : history.length === 0 ? (
              <p className="text-center text-muted-foreground py-12">No shop drawings generated yet.</p>
            ) : (
              <div className="space-y-2 p-1">
                {history.map(entry => (
                  <div key={entry.id} className="flex items-center justify-between p-3 rounded-lg border bg-card">
                    <div className="flex items-center gap-3">
                      <span className="font-semibold text-sm">v{entry.version}</span>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {new Date(entry.created_at).toLocaleDateString()}
                      </div>
                      <span className="text-xs text-muted-foreground">
                        Scale: {(entry.options as any)?.scale || "—"}
                      </span>
                    </div>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => handleViewHistory(entry)}>
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => handleDeleteHistory(entry.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
