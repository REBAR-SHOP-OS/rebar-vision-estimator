import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, Package, Search } from "lucide-react";
import { toast } from "sonner";
import { logAuditEvent } from "@/lib/audit-logger";

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
};

export default function OrdersPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newOrderNum, setNewOrderNum] = useState("");
  const [newCustomer, setNewCustomer] = useState("");
  const [projects, setProjects] = useState<any[]>([]);
  const [selectedProject, setSelectedProject] = useState("");

  useEffect(() => {
    loadOrders();
    supabase.from("projects").select("id, name").order("name").then(({ data }) => setProjects(data || []));
  }, []);

  const loadOrders = async () => {
    setLoading(true);
    const { data } = await supabase.from("orders").select("*").order("updated_at", { ascending: false });
    setOrders(data || []);
    setLoading(false);
  };

  const handleCreate = async () => {
    if (!user || !newOrderNum.trim()) return;
    setCreating(true);
    const { data, error } = await supabase.from("orders").insert({
      user_id: user.id,
      order_number: newOrderNum.trim(),
      customer_name: newCustomer.trim() || null,
      project_id: selectedProject || null,
    }).select("id").single();
    if (error) toast.error("Failed to create order");
    else {
      await logAuditEvent(user.id, "created", "order", data?.id);
      toast.success("Order created");
      setDialogOpen(false);
      setNewOrderNum("");
      setNewCustomer("");
      setSelectedProject("");
      loadOrders();
    }
    setCreating(false);
  };

  const filtered = orders.filter(o =>
    !search || o.order_number?.toLowerCase().includes(search.toLowerCase()) ||
    o.customer_name?.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) return <div className="flex items-center justify-center h-40"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>;

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-bold text-foreground">Orders</h1>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1.5 h-8 text-xs"><Plus className="h-3.5 w-3.5" />New Order</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader><DialogTitle>Create Order</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label className="text-xs">Order Number</Label><Input value={newOrderNum} onChange={e => setNewOrderNum(e.target.value)} placeholder="e.g. ORD-001" className="h-9 text-sm" /></div>
              <div><Label className="text-xs">Customer Name</Label><Input value={newCustomer} onChange={e => setNewCustomer(e.target.value)} placeholder="Optional" className="h-9 text-sm" /></div>
              <div><Label className="text-xs">Link to Project</Label>
                <Select value={selectedProject || "__none__"} onValueChange={(v) => setSelectedProject(v === "__none__" ? "" : v)}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__" className="text-sm">None</SelectItem>
                    {projects.map(p => <SelectItem key={p.id} value={p.id} className="text-sm">{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={handleCreate} disabled={creating || !newOrderNum.trim()} className="w-full">{creating ? "Creating…" : "Create Order"}</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search orders…" className="pl-9 h-9 text-sm" />
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-40 text-muted-foreground gap-2">
          <Package className="h-8 w-8" />
          <p className="text-sm">{orders.length === 0 ? "No orders yet." : "No matching orders."}</p>
        </div>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-muted/60">
              <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="text-left px-4 py-2.5 font-semibold">Order #</th>
                <th className="text-left px-3 py-2.5 font-semibold">Customer</th>
                <th className="text-left px-3 py-2.5 font-semibold">Status</th>
                <th className="text-left px-3 py-2.5 font-semibold">Validation</th>
                <th className="text-left px-3 py-2.5 font-semibold">Pricing</th>
                <th className="text-right px-3 py-2.5 font-semibold">Weight (kg)</th>
                <th className="text-right px-3 py-2.5 font-semibold">Total</th>
                <th className="text-right px-3 py-2.5 font-semibold">Due</th>
                <th className="text-right px-3 py-2.5 font-semibold">Updated</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(o => (
                <tr key={o.id} onClick={() => navigate(`/app/orders/${o.id}`)} className="border-t border-border/50 hover:bg-muted/20 transition-colors cursor-pointer">
                  <td className="px-4 py-2.5 font-medium text-foreground">{o.order_number || "—"}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{o.customer_name || "—"}</td>
                  <td className="px-3 py-2.5"><Badge className={`text-[9px] ${STATUS_COLORS[o.status] || STATUS_COLORS.draft}`}>{o.status.replace(/_/g, " ")}</Badge></td>
                  <td className="px-3 py-2.5"><Badge variant="outline" className="text-[9px]">{o.validation_status}</Badge></td>
                  <td className="px-3 py-2.5"><Badge variant="outline" className="text-[9px]">{o.pricing_status}</Badge></td>
                  <td className="px-3 py-2.5 text-right font-mono">{Number(o.total_weight_kg) > 0 ? Number(o.total_weight_kg).toLocaleString() : "—"}</td>
                  <td className="px-3 py-2.5 text-right font-mono">{Number(o.total_price) > 0 ? `$${Number(o.total_price).toLocaleString()}` : "—"}</td>
                  <td className="px-3 py-2.5 text-right text-muted-foreground">{o.due_date ? new Date(o.due_date).toLocaleDateString() : "—"}</td>
                  <td className="px-3 py-2.5 text-right text-muted-foreground">{new Date(o.updated_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
