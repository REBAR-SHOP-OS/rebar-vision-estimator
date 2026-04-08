import { useParams, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ArrowLeft, Loader2, Package, CheckCircle2, Clock, ShieldAlert, AlertTriangle,
  Truck, FileText, DollarSign, Factory, History, Save
} from "lucide-react";
import { toast } from "sonner";
import { logAuditEvent } from "@/lib/audit-logger";

const ORDER_STATUSES = ["draft","extracting","validating","pricing","approved","optimizing","in_production","complete","delivered","cancelled"];
const VALIDATION_STATUSES = ["pending","in_progress","approved","rejected"];
const PRICING_STATUSES = ["pending","draft","approved","rejected"];

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  extracting: "bg-[hsl(var(--status-review))]/15 text-[hsl(var(--status-review))]",
  validating: "bg-[hsl(var(--status-review))]/15 text-[hsl(var(--status-review))]",
  pricing: "bg-[hsl(var(--status-review))]/15 text-[hsl(var(--status-review))]",
  approved: "bg-[hsl(var(--status-approved))]/15 text-[hsl(var(--status-approved))]",
  optimizing: "bg-primary/15 text-primary",
  in_production: "bg-primary/15 text-primary",
  complete: "bg-[hsl(var(--status-approved))]/15 text-[hsl(var(--status-approved))]",
  delivered: "bg-[hsl(var(--status-approved))]/15 text-[hsl(var(--status-approved))]",
  cancelled: "bg-destructive/15 text-destructive",
  pending: "bg-muted text-muted-foreground",
  in_progress: "bg-[hsl(var(--status-review))]/15 text-[hsl(var(--status-review))]",
  rejected: "bg-destructive/15 text-destructive",
};

export default function OrderDetail() {
  const { orderId } = useParams<{ orderId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [order, setOrder] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [project, setProject] = useState<any>(null);
  const [estimateItems, setEstimateItems] = useState<any[]>([]);
  const [issues, setIssues] = useState<any[]>([]);
  const [auditEvents, setAuditEvents] = useState<any[]>([]);

  // Editable fields
  const [status, setStatus] = useState("draft");
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [totalWeight, setTotalWeight] = useState("");
  const [totalPrice, setTotalPrice] = useState("");
  const [pricePerTon, setPricePerTon] = useState("");
  const [validationStatus, setValidationStatus] = useState("pending");
  const [pricingStatus, setPricingStatus] = useState("pending");
  const [notes, setNotes] = useState("");

  useEffect(() => { if (orderId) loadOrder(); }, [orderId]);

  const loadOrder = async () => {
    setLoading(true);
    const { data: o } = await supabase.from("orders").select("*").eq("id", orderId!).single();
    if (!o) { setLoading(false); return; }
    setOrder(o);
    setStatus(o.status);
    setCustomerName(o.customer_name || "");
    setCustomerEmail(o.customer_email || "");
    setDueDate(o.due_date || "");
    setTotalWeight(String(o.total_weight_kg || ""));
    setTotalPrice(String(o.total_price || ""));
    setPricePerTon(String(o.price_per_ton || ""));
    setValidationStatus(o.validation_status || "pending");
    setPricingStatus(o.pricing_status || "pending");
    setNotes(o.notes || "");

    // Load related data
    const auditRes = await supabase.from("audit_events").select("*").eq("entity_id", orderId!).order("created_at", { ascending: false }).limit(50);
    setAuditEvents(auditRes.data || []);

    if (o.project_id) {
      const [projRes, estRes, issRes] = await Promise.all([
        supabase.from("projects").select("id, name, client_name, address, project_type, status").eq("id", o.project_id).single(),
        supabase.from("estimate_items").select("*").eq("project_id", o.project_id).neq("item_type", "source_link").order("created_at"),
        supabase.from("validation_issues").select("*").eq("project_id", o.project_id).order("created_at", { ascending: false }),
      ]);
      setProject(projRes.data || null);
      setEstimateItems(estRes.data || []);
      setIssues(issRes.data || []);
    }
    setLoading(false);
  };

  const handleSave = async () => {
    if (!user || !orderId) return;
    setSaving(true);
    const oldStatus = order?.status;
    const { error } = await supabase.from("orders").update({
      status,
      customer_name: customerName.trim() || null,
      customer_email: customerEmail.trim() || null,
      due_date: dueDate || null,
      total_weight_kg: parseFloat(totalWeight) || 0,
      total_price: parseFloat(totalPrice) || 0,
      price_per_ton: parseFloat(pricePerTon) || 0,
      validation_status: validationStatus,
      pricing_status: pricingStatus,
      notes: notes.trim() || null,
    }).eq("id", orderId);
    if (error) toast.error("Failed to save");
    else {
      if (oldStatus !== status) {
        await logAuditEvent(user.id, "status_changed", "order", orderId, order?.project_id, undefined, { from: oldStatus, to: status });
      } else {
        await logAuditEvent(user.id, "updated", "order", orderId, order?.project_id);
      }
      toast.success("Order saved");
      loadOrder();
    }
    setSaving(false);
  };

  if (loading) return <div className="flex items-center justify-center h-full"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  if (!order) return (
    <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2">
      <Package className="h-8 w-8" /><p className="text-sm">Order not found.</p>
      <Button variant="outline" size="sm" onClick={() => navigate("/app/orders")}>Back to Orders</Button>
    </div>
  );

  const openIssues = issues.filter(i => i.status === "open").length;
  const blockerIssues = issues.filter(i => i.status === "open" && (i.severity === "error" || i.severity === "critical")).length;
  const approvedItems = estimateItems.filter(i => i.status === "approved").length;
  const pendingItems = estimateItems.filter(i => i.status === "draft" || i.status === "pending").length;

  const readinessItem = (label: string, ok: boolean, detail: string) => (
    <div className="flex items-center gap-2 text-xs">
      {ok ? <CheckCircle2 className="h-3.5 w-3.5 text-[hsl(var(--status-approved))]" /> : <Clock className="h-3.5 w-3.5 text-muted-foreground" />}
      <span className="font-medium text-foreground">{label}</span>
      <span className="text-muted-foreground ml-auto">{detail}</span>
    </div>
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-muted/30">
        <Button variant="ghost" size="icon" onClick={() => navigate("/app/orders")} className="h-8 w-8"><ArrowLeft className="h-4 w-4" /></Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-foreground">{order.order_number || "Untitled Order"}</h2>
            <Badge className={`text-[9px] ${STATUS_COLORS[status] || STATUS_COLORS.draft}`}>{status.replace(/_/g, " ")}</Badge>
          </div>
          <div className="flex items-center gap-3 mt-0.5 text-[10px] text-muted-foreground">
            {customerName && <span>{customerName}</span>}
            {project && <span>→ {project.name}</span>}
            {dueDate && <span>Due: {new Date(dueDate).toLocaleDateString()}</span>}
          </div>
        </div>
        <Button size="sm" className="gap-1.5 h-8 text-xs" onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
          Save
        </Button>
      </div>

      {/* Readiness Summary */}
      <div className="px-4 py-3 border-b border-border bg-background">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="border-border/50"><CardContent className="p-2.5 space-y-1.5">
            {readinessItem("Validation", validationStatus === "approved", validationStatus)}
            {readinessItem("Pricing", pricingStatus === "approved", pricingStatus)}
          </CardContent></Card>
          <Card className="border-border/50"><CardContent className="p-2.5 space-y-1.5">
            {readinessItem("Production", status === "in_production" || status === "complete", status === "in_production" ? "Active" : status === "complete" ? "Done" : "Not started")}
            {readinessItem("Delivery", status === "delivered", status === "delivered" ? "Delivered" : "Pending")}
          </CardContent></Card>
          <Card className="border-border/50"><CardContent className="p-2.5 text-center">
            <p className="text-lg font-bold font-mono">{Number(totalWeight || 0).toLocaleString()}</p>
            <p className="text-[10px] text-muted-foreground uppercase">Weight (kg)</p>
          </CardContent></Card>
          <Card className="border-border/50"><CardContent className="p-2.5 text-center">
            <p className="text-lg font-bold font-mono">${Number(totalPrice || 0).toLocaleString()}</p>
            <p className="text-[10px] text-muted-foreground uppercase">Total Price</p>
          </CardContent></Card>
        </div>
        {blockerIssues > 0 && (
          <div className="flex items-center gap-2 p-2 mt-2 bg-destructive/10 border border-destructive/20 rounded-lg">
            <ShieldAlert className="h-3.5 w-3.5 text-destructive" />
            <span className="text-xs text-destructive">{blockerIssues} blocker(s) must be resolved.</span>
          </div>
        )}
      </div>

      <Tabs defaultValue="summary" className="flex flex-col flex-1">
        <div className="border-b border-border px-4">
          <TabsList className="bg-transparent h-9 gap-1">
            <TabsTrigger value="summary" className="text-xs">Summary</TabsTrigger>
            <TabsTrigger value="line_items" className="text-xs">Line Items ({estimateItems.length})</TabsTrigger>
            <TabsTrigger value="validation" className="text-xs">Validation ({openIssues})</TabsTrigger>
            <TabsTrigger value="pricing" className="text-xs">Pricing</TabsTrigger>
            <TabsTrigger value="production" className="text-xs">Production</TabsTrigger>
            <TabsTrigger value="delivery" className="text-xs">Delivery</TabsTrigger>
            <TabsTrigger value="history" className="text-xs">History ({auditEvents.length})</TabsTrigger>
          </TabsList>
        </div>

        {/* Summary Tab */}
        <TabsContent value="summary" className="flex-1 overflow-auto p-4 m-0">
          <div className="grid md:grid-cols-2 gap-4 max-w-3xl">
            <Card><CardHeader className="pb-2"><CardTitle className="text-xs uppercase text-muted-foreground">Order Details</CardTitle></CardHeader>
              <CardContent className="space-y-2.5">
                <div><Label className="text-xs">Status</Label>
                  <Select value={status} onValueChange={setStatus}><SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>{ORDER_STATUSES.map(s => <SelectItem key={s} value={s} className="text-sm capitalize">{s.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label className="text-xs">Due Date</Label><Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="h-9 text-sm" /></div>
                <div><Label className="text-xs">Notes</Label><Textarea value={notes} onChange={e => setNotes(e.target.value)} className="text-sm min-h-[60px]" /></div>
              </CardContent>
            </Card>
            <Card><CardHeader className="pb-2"><CardTitle className="text-xs uppercase text-muted-foreground">Customer</CardTitle></CardHeader>
              <CardContent className="space-y-2.5">
                <div><Label className="text-xs">Name</Label><Input value={customerName} onChange={e => setCustomerName(e.target.value)} className="h-9 text-sm" /></div>
                <div><Label className="text-xs">Email</Label><Input value={customerEmail} onChange={e => setCustomerEmail(e.target.value)} className="h-9 text-sm" /></div>
                {project && (
                  <div className="pt-1 border-t border-border">
                    <p className="text-[10px] uppercase text-muted-foreground mb-1">Linked Project</p>
                    <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => navigate(`/app/project/${project.id}`)}>{project.name}</Button>
                    {project.client_name && <p className="text-[10px] text-muted-foreground">{project.client_name}</p>}
                    {project.address && <p className="text-[10px] text-muted-foreground">{project.address}</p>}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Line Items Tab */}
        <TabsContent value="line_items" className="flex-1 overflow-auto p-4 m-0">
          {estimateItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-muted-foreground gap-2 border border-dashed border-border rounded-lg">
              <FileText className="h-6 w-6" /><p className="text-xs">{project ? "No estimate items in linked project." : "Link a project to see line items."}</p>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 mb-3">
                <Badge variant="secondary" className="text-[10px]">{approvedItems} approved</Badge>
                <Badge variant="outline" className="text-[10px]">{pendingItems} pending</Badge>
                <Badge variant="outline" className="text-[10px]">{estimateItems.length} total</Badge>
              </div>
              <div className="border border-border rounded-lg overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-muted/60">
                    <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      <th className="text-left px-3 py-2 font-semibold">Description</th>
                      <th className="text-left px-3 py-2 font-semibold">Bar Size</th>
                      <th className="text-right px-3 py-2 font-semibold">Qty</th>
                      <th className="text-right px-3 py-2 font-semibold">Weight</th>
                      <th className="text-right px-3 py-2 font-semibold">Confidence</th>
                      <th className="text-left px-3 py-2 font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {estimateItems.map(item => (
                      <tr key={item.id} className="border-t border-border/50 hover:bg-muted/20 transition-colors">
                        <td className="px-3 py-2 text-foreground">{item.description || "—"}</td>
                        <td className="px-3 py-2 text-muted-foreground">{item.bar_size || "—"}</td>
                        <td className="px-3 py-2 text-right font-mono">{item.quantity_count}</td>
                        <td className="px-3 py-2 text-right font-mono">{Number(item.total_weight).toLocaleString()}</td>
                        <td className="px-3 py-2 text-right font-mono">{Number(item.confidence) > 0 ? `${Math.round(Number(item.confidence) * 100)}%` : "—"}</td>
                        <td className="px-3 py-2"><Badge className={`text-[9px] ${STATUS_COLORS[item.status] || ""}`}>{item.status}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </TabsContent>

        {/* Validation Tab */}
        <TabsContent value="validation" className="flex-1 overflow-auto p-4 m-0">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-semibold">Validation Status</h4>
              <Badge className={`text-[9px] ${STATUS_COLORS[validationStatus]}`}>{validationStatus}</Badge>
            </div>
            <Select value={validationStatus} onValueChange={setValidationStatus}>
              <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>{VALIDATION_STATUSES.map(s => <SelectItem key={s} value={s} className="text-xs capitalize">{s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {issues.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-muted-foreground gap-2 border border-dashed border-border rounded-lg">
              <AlertTriangle className="h-6 w-6" /><p className="text-xs">No validation issues.</p>
            </div>
          ) : (
            <div className="border border-border rounded-lg overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/60">
                  <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="text-left px-3 py-2 font-semibold">Title</th>
                    <th className="text-left px-3 py-2 font-semibold">Type</th>
                    <th className="text-left px-3 py-2 font-semibold">Severity</th>
                    <th className="text-left px-3 py-2 font-semibold">Status</th>
                    <th className="text-left px-3 py-2 font-semibold">Assigned</th>
                  </tr>
                </thead>
                <tbody>
                  {issues.map(i => (
                    <tr key={i.id} className="border-t border-border/50 hover:bg-muted/20 transition-colors">
                      <td className="px-3 py-2 text-foreground">{i.title}</td>
                      <td className="px-3 py-2"><Badge variant="outline" className="text-[9px]">{i.issue_type}</Badge></td>
                      <td className="px-3 py-2"><Badge className={`text-[9px] ${i.severity === "critical" || i.severity === "error" ? "bg-destructive/15 text-destructive" : "bg-muted text-muted-foreground"}`}>{i.severity}</Badge></td>
                      <td className="px-3 py-2"><Badge variant="outline" className="text-[9px]">{i.status}</Badge></td>
                      <td className="px-3 py-2 text-muted-foreground">{i.assigned_to || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        {/* Pricing Tab */}
        <TabsContent value="pricing" className="flex-1 overflow-auto p-4 m-0">
          <div className="max-w-lg space-y-4">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-semibold">Pricing</h4>
              <Badge className={`text-[9px] ${STATUS_COLORS[pricingStatus]}`}>{pricingStatus}</Badge>
            </div>
            <Card><CardContent className="p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><Label className="text-xs">Total Weight (kg)</Label><Input type="number" value={totalWeight} onChange={e => setTotalWeight(e.target.value)} className="h-9 text-sm" /></div>
                <div><Label className="text-xs">Price per Ton ($)</Label><Input type="number" value={pricePerTon} onChange={e => setPricePerTon(e.target.value)} className="h-9 text-sm" /></div>
              </div>
              <div><Label className="text-xs">Total Price ($)</Label><Input type="number" value={totalPrice} onChange={e => setTotalPrice(e.target.value)} className="h-9 text-sm" /></div>
              <div><Label className="text-xs">Pricing Status</Label>
                <Select value={pricingStatus} onValueChange={setPricingStatus}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>{PRICING_STATUSES.map(s => <SelectItem key={s} value={s} className="text-sm capitalize">{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </CardContent></Card>
          </div>
        </TabsContent>

        {/* Production Tab */}
        <TabsContent value="production" className="flex-1 overflow-auto p-4 m-0">
          <div className="flex flex-col items-center justify-center h-40 text-muted-foreground gap-2 border border-dashed border-border rounded-lg">
            <Factory className="h-8 w-8" />
            <p className="text-xs font-medium">Production tracking coming soon.</p>
            <p className="text-[10px]">Tasks, machine assignments, and progress will appear here.</p>
          </div>
        </TabsContent>

        {/* Delivery Tab */}
        <TabsContent value="delivery" className="flex-1 overflow-auto p-4 m-0">
          <div className="flex flex-col items-center justify-center h-40 text-muted-foreground gap-2 border border-dashed border-border rounded-lg">
            <Truck className="h-8 w-8" />
            <p className="text-xs font-medium">Delivery tracking coming soon.</p>
            <p className="text-[10px]">Schedule, truck, and dispatch status will appear here.</p>
          </div>
        </TabsContent>

        {/* Event History Tab */}
        <TabsContent value="history" className="flex-1 overflow-auto p-4 m-0">
          {auditEvents.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-muted-foreground gap-2 border border-dashed border-border rounded-lg">
              <History className="h-6 w-6" /><p className="text-xs">No events recorded yet.</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {auditEvents.map(ev => (
                <div key={ev.id} className="flex items-start gap-3 px-3 py-2 border border-border/50 rounded-lg text-xs">
                  <div className="flex-shrink-0 mt-0.5"><Clock className="h-3 w-3 text-muted-foreground" /></div>
                  <div className="flex-1 min-w-0">
                    <span className="font-medium text-foreground">{ev.action}</span>
                    <span className="text-muted-foreground ml-1">on {ev.entity_type}</span>
                    {ev.metadata && Object.keys(ev.metadata).length > 0 && (
                      <span className="text-muted-foreground ml-1">— {JSON.stringify(ev.metadata)}</span>
                    )}
                  </div>
                  <span className="text-[10px] text-muted-foreground flex-shrink-0">{new Date(ev.created_at).toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
