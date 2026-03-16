import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CheckCircle2, Clock, Plus, Calendar, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

interface FollowUp {
  id: string;
  project_id: string;
  action: string;
  status: string | null;
  due_date: string | null;
  notes: string | null;
  created_at: string | null;
}

const FollowUpBoard: React.FC<{ projectId: string; onClose: () => void }> = ({ projectId, onClose }) => {
  const { user } = useAuth();
  const [items, setItems] = useState<FollowUp[]>([]);
  const [loading, setLoading] = useState(true);
  const [newAction, setNewAction] = useState("");
  const [newDueDate, setNewDueDate] = useState("");

  useEffect(() => {
    if (!user) return;
    supabase
      .from("follow_ups")
      .select("*")
      .eq("project_id", projectId)
      .order("due_date", { ascending: true, nullsFirst: false })
      .then(({ data }) => {
        setItems((data as FollowUp[]) || []);
        setLoading(false);
      });
  }, [user, projectId]);

  const addFollowUp = async () => {
    if (!user || !newAction.trim()) return;
    const { data, error } = await supabase.from("follow_ups").insert({
      project_id: projectId,
      user_id: user.id,
      action: newAction.trim(),
      due_date: newDueDate || null,
      status: "pending",
    }).select().single();

    if (error) { toast.error("Failed to add follow-up"); return; }
    setItems(prev => [...prev, data as FollowUp]);
    setNewAction("");
    setNewDueDate("");
    toast.success("Follow-up added");
  };

  const toggleStatus = async (id: string, current: string | null) => {
    const next = current === "completed" ? "pending" : "completed";
    const { error } = await supabase.from("follow_ups").update({ status: next }).eq("id", id);
    if (!error) setItems(prev => prev.map(i => i.id === id ? { ...i, status: next } : i));
  };

  const isOverdue = (dueDate: string | null) => {
    if (!dueDate) return false;
    return new Date(dueDate) < new Date() && new Date(dueDate).toDateString() !== new Date().toDateString();
  };

  const pending = items.filter(i => i.status !== "completed");
  const completed = items.filter(i => i.status === "completed");

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
          <Clock className="h-5 w-5 text-primary" /> Follow-Ups
        </h2>
        <button onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">Close</button>
      </div>

      {/* Add new */}
      <Card className="border-primary/20">
        <CardContent className="pt-4 space-y-2">
          <Input value={newAction} onChange={e => setNewAction(e.target.value)} placeholder="Follow-up action..." className="text-xs" onKeyDown={e => e.key === "Enter" && addFollowUp()} />
          <div className="flex gap-2">
            <Input type="date" value={newDueDate} onChange={e => setNewDueDate(e.target.value)} className="text-xs flex-1" />
            <Button size="sm" onClick={addFollowUp} disabled={!newAction.trim()} className="gap-1">
              <Plus className="h-3.5 w-3.5" /> Add
            </Button>
          </div>
        </CardContent>
      </Card>

      {loading ? <p className="text-xs text-muted-foreground">Loading...</p> : (
        <>
          {/* Pending */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Pending ({pending.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="max-h-[250px]">
                <div className="space-y-2">
                  {pending.map(item => (
                    <div key={item.id} className="flex items-start gap-2 rounded-lg border border-border p-2.5 cursor-pointer hover:bg-accent/50" onClick={() => toggleStatus(item.id, item.status)}>
                      <div className={`mt-0.5 h-4 w-4 rounded-full border-2 flex-shrink-0 ${isOverdue(item.due_date) ? "border-destructive" : "border-muted-foreground/40"}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-foreground">{item.action}</p>
                        {item.due_date && (
                          <p className={`text-[10px] flex items-center gap-1 mt-0.5 ${isOverdue(item.due_date) ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                            {isOverdue(item.due_date) && <AlertTriangle className="h-3 w-3" />}
                            <Calendar className="h-3 w-3" />
                            {new Date(item.due_date).toLocaleDateString()}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                  {pending.length === 0 && <p className="text-xs text-muted-foreground text-center py-4">No pending follow-ups</p>}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          {/* Completed */}
          {completed.length > 0 && (
            <Card className="opacity-70">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">Completed ({completed.length})</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1">
                  {completed.map(item => (
                    <div key={item.id} className="flex items-center gap-2 p-2 cursor-pointer" onClick={() => toggleStatus(item.id, item.status)}>
                      <CheckCircle2 className="h-4 w-4 text-primary flex-shrink-0" />
                      <span className="text-xs line-through text-muted-foreground">{item.action}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
};

export default FollowUpBoard;
