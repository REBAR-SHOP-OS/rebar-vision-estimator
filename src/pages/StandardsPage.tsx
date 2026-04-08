import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, Ruler, Star } from "lucide-react";
import { toast } from "sonner";

interface StandardsProfile {
  id: string;
  name: string;
  code_family: string;
  units: string;
  is_default: boolean;
  created_at: string;
}

export default function StandardsPage() {
  const { user } = useAuth();
  const [profiles, setProfiles] = useState<StandardsProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCodeFamily, setNewCodeFamily] = useState("CSA A23.3");
  const [newUnits, setNewUnits] = useState("metric");
  const [creating, setCreating] = useState(false);

  const load = () => {
    setLoading(true);
    supabase.from("standards_profiles").select("*").order("created_at").then(({ data }) => {
      setProfiles((data as StandardsProfile[]) || []);
      setLoading(false);
    });
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    if (!newName.trim() || !user) return;
    setCreating(true);
    const { error } = await supabase.from("standards_profiles").insert({
      user_id: user.id,
      name: newName.trim(),
      code_family: newCodeFamily,
      units: newUnits,
    });
    if (error) toast.error("Failed to create profile");
    else { toast.success("Standards profile created"); setNewName(""); setDialogOpen(false); load(); }
    setCreating(false);
  };

  if (loading) {
    return <div className="flex items-center justify-center h-full"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  return (
    <div className="p-4 md:p-6 max-w-3xl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-bold text-foreground">Standards Profiles</h2>
          <p className="text-xs text-muted-foreground">Manage code families, cover defaults, lap lengths, and hook rules.</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1.5"><Plus className="h-3.5 w-3.5" />New Profile</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader><DialogTitle>New Standards Profile</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label className="text-xs">Name</Label><Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. CSA Metric Default" className="h-9 text-sm" /></div>
              <div>
                <Label className="text-xs">Code Family</Label>
                <Select value={newCodeFamily} onValueChange={setNewCodeFamily}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CSA A23.3">CSA A23.3</SelectItem>
                    <SelectItem value="ACI 318">ACI 318</SelectItem>
                    <SelectItem value="BS 8666">BS 8666</SelectItem>
                    <SelectItem value="AS 3600">AS 3600</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Units</Label>
                <Select value={newUnits} onValueChange={setNewUnits}>
                  <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="metric">Metric</SelectItem>
                    <SelectItem value="imperial">Imperial</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={handleCreate} disabled={creating || !newName.trim()} className="w-full">
                {creating ? "Creating..." : "Create Profile"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {profiles.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-40 text-muted-foreground gap-2">
          <Ruler className="h-8 w-8" />
          <p className="text-sm">No standards profiles yet.</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {profiles.map((p) => (
            <Card key={p.id}>
              <CardContent className="flex items-center justify-between p-4">
                <div className="flex items-center gap-3">
                  <Ruler className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground">{p.name}</span>
                      {p.is_default && <Badge className="text-[9px] bg-primary/15 text-primary"><Star className="h-2.5 w-2.5 mr-0.5" />Default</Badge>}
                    </div>
                    <p className="text-[10px] text-muted-foreground">{p.code_family} · {p.units}</p>
                  </div>
                </div>
                <Button variant="outline" size="sm" className="text-xs h-8">Edit</Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
