import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Loader2, Plus, Ruler, Star, Pencil } from "lucide-react";
import { toast } from "sonner";

interface StandardsProfile {
  id: string;
  name: string;
  code_family: string;
  units: string;
  is_default: boolean;
  cover_defaults: Record<string, any>;
  lap_defaults: Record<string, any>;
  hook_defaults: Record<string, any>;
  naming_rules: Record<string, any>;
  created_at: string;
}

const DEFAULT_COVERS: Record<string, string> = { footing: "75", slab: "40", wall: "50", beam: "40", column: "40" };
const DEFAULT_LAPS: Record<string, string> = { "10M": "300", "15M": "450", "20M": "600", "25M": "750", "30M": "900" };
const DEFAULT_HOOKS: Record<string, string> = { standard_90: "12db", standard_180: "4db", seismic: "6db" };

export default function StandardsPage() {
  const { user } = useAuth();
  const [profiles, setProfiles] = useState<StandardsProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editProfile, setEditProfile] = useState<StandardsProfile | null>(null);
  const [newName, setNewName] = useState("");
  const [newCodeFamily, setNewCodeFamily] = useState("CSA A23.3");
  const [newUnits, setNewUnits] = useState("metric");
  const [coverDefaults, setCoverDefaults] = useState<Record<string, string>>(DEFAULT_COVERS);
  const [lapDefaults, setLapDefaults] = useState<Record<string, string>>(DEFAULT_LAPS);
  const [hookDefaults, setHookDefaults] = useState<Record<string, string>>(DEFAULT_HOOKS);
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    supabase.from("standards_profiles").select("*").order("created_at").then(({ data }) => {
      setProfiles((data as StandardsProfile[]) || []);
      setLoading(false);
    });
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => {
    setEditProfile(null);
    setNewName("");
    setNewCodeFamily("CSA A23.3");
    setNewUnits("metric");
    setCoverDefaults({ ...DEFAULT_COVERS });
    setLapDefaults({ ...DEFAULT_LAPS });
    setHookDefaults({ ...DEFAULT_HOOKS });
    setDialogOpen(true);
  };

  const openEdit = (p: StandardsProfile) => {
    setEditProfile(p);
    setNewName(p.name);
    setNewCodeFamily(p.code_family || "CSA A23.3");
    setNewUnits(p.units || "metric");
    setCoverDefaults(Object.keys(p.cover_defaults || {}).length > 0 ? p.cover_defaults as any : { ...DEFAULT_COVERS });
    setLapDefaults(Object.keys(p.lap_defaults || {}).length > 0 ? p.lap_defaults as any : { ...DEFAULT_LAPS });
    setHookDefaults(Object.keys(p.hook_defaults || {}).length > 0 ? p.hook_defaults as any : { ...DEFAULT_HOOKS });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!newName.trim() || !user) return;
    setSaving(true);
    const payload = {
      name: newName.trim(),
      code_family: newCodeFamily,
      units: newUnits,
      cover_defaults: coverDefaults,
      lap_defaults: lapDefaults,
      hook_defaults: hookDefaults,
    };

    if (editProfile) {
      const { error } = await supabase.from("standards_profiles").update(payload).eq("id", editProfile.id);
      if (error) toast.error("Failed to update profile");
      else { toast.success("Profile updated"); setDialogOpen(false); load(); }
    } else {
      const { error } = await supabase.from("standards_profiles").insert({ ...payload, user_id: user.id });
      if (error) toast.error("Failed to create profile");
      else { toast.success("Profile created"); setDialogOpen(false); load(); }
    }
    setSaving(false);
  };

  const handleSetDefault = async (id: string) => {
    // Clear all defaults first, then set this one
    await supabase.from("standards_profiles").update({ is_default: false }).neq("id", "00000000-0000-0000-0000-000000000000");
    const { error } = await supabase.from("standards_profiles").update({ is_default: true }).eq("id", id);
    if (error) toast.error("Failed to set default");
    else { toast.success("Default profile updated"); load(); }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-full"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  return (
    <div className="p-4 md:p-6 max-w-4xl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-bold text-foreground">Standards Profiles</h2>
          <p className="text-xs text-muted-foreground">Manage code families, cover defaults, lap lengths, hook rules, and naming conventions.</p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={openCreate}><Plus className="h-3.5 w-3.5" />New Profile</Button>
      </div>

      {profiles.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-40 text-muted-foreground gap-2 border border-dashed border-border rounded-lg">
          <Ruler className="h-8 w-8" />
          <p className="text-sm">No standards profiles yet.</p>
          <p className="text-[10px]">Create a profile to define cover, lap, and hook defaults.</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {profiles.map((p) => (
            <Card key={p.id} className="hover:bg-muted/20 transition-colors">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
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
                  <div className="flex gap-1">
                    {!p.is_default && <Button variant="ghost" size="sm" className="text-xs h-8" onClick={() => handleSetDefault(p.id)}>Set Default</Button>}
                    <Button variant="outline" size="sm" className="text-xs h-8 gap-1" onClick={() => openEdit(p)}><Pencil className="h-3 w-3" />Edit</Button>
                  </div>
                </div>
                {/* Quick preview of defaults */}
                <div className="grid grid-cols-3 gap-3 mt-2">
                  <div className="bg-muted/40 rounded p-2">
                    <p className="text-[10px] text-muted-foreground uppercase font-semibold mb-1">Cover Defaults</p>
                    {Object.entries(p.cover_defaults || {}).slice(0, 3).map(([k, v]) => (
                      <p key={k} className="text-[10px] text-foreground"><span className="text-muted-foreground capitalize">{k}:</span> {String(v)}mm</p>
                    ))}
                    {Object.keys(p.cover_defaults || {}).length === 0 && <p className="text-[10px] text-muted-foreground">Not set</p>}
                  </div>
                  <div className="bg-muted/40 rounded p-2">
                    <p className="text-[10px] text-muted-foreground uppercase font-semibold mb-1">Lap Defaults</p>
                    {Object.entries(p.lap_defaults || {}).slice(0, 3).map(([k, v]) => (
                      <p key={k} className="text-[10px] text-foreground"><span className="text-muted-foreground">{k}:</span> {String(v)}mm</p>
                    ))}
                    {Object.keys(p.lap_defaults || {}).length === 0 && <p className="text-[10px] text-muted-foreground">Not set</p>}
                  </div>
                  <div className="bg-muted/40 rounded p-2">
                    <p className="text-[10px] text-muted-foreground uppercase font-semibold mb-1">Hook Defaults</p>
                    {Object.entries(p.hook_defaults || {}).slice(0, 3).map(([k, v]) => (
                      <p key={k} className="text-[10px] text-foreground"><span className="text-muted-foreground">{k.replace(/_/g, " ")}:</span> {String(v)}</p>
                    ))}
                    {Object.keys(p.hook_defaults || {}).length === 0 && <p className="text-[10px] text-muted-foreground">Not set</p>}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editProfile ? "Edit Standards Profile" : "New Standards Profile"}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-3 sm:col-span-1">
                <Label className="text-xs">Name</Label>
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. CSA Metric" className="h-9 text-sm" />
              </div>
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
            </div>

            {/* Cover Defaults */}
            <div>
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Cover Defaults (mm)</Label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-1.5">
                {Object.entries(coverDefaults).map(([k, v]) => (
                  <div key={k} className="flex items-center gap-2">
                    <Label className="text-[10px] capitalize w-16 text-muted-foreground">{k}</Label>
                    <Input value={v} onChange={(e) => setCoverDefaults({ ...coverDefaults, [k]: e.target.value })} className="h-7 text-xs w-20" />
                  </div>
                ))}
              </div>
            </div>

            {/* Lap Defaults */}
            <div>
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Lap Lengths (mm)</Label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-1.5">
                {Object.entries(lapDefaults).map(([k, v]) => (
                  <div key={k} className="flex items-center gap-2">
                    <Label className="text-[10px] w-16 text-muted-foreground">{k}</Label>
                    <Input value={v} onChange={(e) => setLapDefaults({ ...lapDefaults, [k]: e.target.value })} className="h-7 text-xs w-20" />
                  </div>
                ))}
              </div>
            </div>

            {/* Hook Defaults */}
            <div>
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Hook Rules</Label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-1.5">
                {Object.entries(hookDefaults).map(([k, v]) => (
                  <div key={k} className="flex items-center gap-2">
                    <Label className="text-[10px] w-20 text-muted-foreground capitalize">{k.replace(/_/g, " ")}</Label>
                    <Input value={v} onChange={(e) => setHookDefaults({ ...hookDefaults, [k]: e.target.value })} className="h-7 text-xs w-20" />
                  </div>
                ))}
              </div>
            </div>

            <Button onClick={handleSave} disabled={saving || !newName.trim()} className="w-full">
              {saving ? "Saving…" : editProfile ? "Update Profile" : "Create Profile"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
