import React, { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Brain, Upload, Trash2, FileText, Plus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface KnowledgeItem {
  id: string;
  title: string | null;
  content: string | null;
  file_path: string | null;
  file_name: string | null;
  type: string;
  created_at: string;
}

const BrainKnowledgeDialog: React.FC = () => {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [ruleTitle, setRuleTitle] = useState("");
  const [ruleContent, setRuleContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && user) loadItems();
  }, [open, user]);

  const loadItems = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("agent_knowledge" as any)
      .select("*")
      .eq("user_id", user!.id)
      .order("created_at", { ascending: false });

    if (!error && data) setItems(data as any);
    setLoading(false);
  };

  const addRule = async () => {
    if (!ruleContent.trim() || !user) return;
    const rules = items.filter((i) => i.type === "rule");
    if (rules.length >= 20) {
      toast.error("Maximum 20 rules allowed");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("agent_knowledge" as any).insert({
      user_id: user.id,
      title: ruleTitle.trim() || null,
      content: ruleContent.trim(),
      type: "rule",
    } as any);

    if (error) {
      toast.error("Failed to save rule");
    } else {
      toast.success("Rule saved");
      setRuleTitle("");
      setRuleContent("");
      loadItems();
    }
    setSaving(false);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || !user) return;

    const existingFiles = items.filter((i) => i.type === "file");
    if (existingFiles.length + files.length > 10) {
      toast.error("Maximum 10 knowledge files allowed");
      return;
    }

    setUploading(true);
    for (const file of Array.from(files)) {
      const filePath = `${user.id}/knowledge/${Date.now()}_${file.name}`;

      const { error: uploadError } = await supabase.storage
        .from("blueprints")
        .upload(filePath, file, { upsert: true });

      if (uploadError) {
        toast.error(`Failed to upload ${file.name}`);
        continue;
      }

      const { error } = await supabase.from("agent_knowledge" as any).insert({
        user_id: user.id,
        title: file.name,
        file_path: filePath,
        file_name: file.name,
        type: "file",
      } as any);

      if (error) toast.error(`Failed to save ${file.name}`);
    }

    toast.success("Files uploaded");
    loadItems();
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const deleteItem = async (item: KnowledgeItem) => {
    if (item.file_path) {
      await supabase.storage.from("blueprints").remove([item.file_path]);
    }
    const { error } = await supabase
      .from("agent_knowledge" as any)
      .delete()
      .eq("id", item.id);

    if (error) {
      toast.error("Failed to delete");
    } else {
      setItems((prev) => prev.filter((i) => i.id !== item.id));
    }
  };

  const ruleCount = items.filter((i) => i.type === "rule").length;
  const fileCount = items.filter((i) => i.type === "file").length;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground relative"
          title="Agent Brain - Knowledge Base"
        >
          <Brain className="h-4 w-4" />
          {items.length > 0 && (
            <span className="absolute -top-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-primary text-[9px] font-bold text-primary-foreground flex items-center justify-center">
              {items.length}
            </span>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-primary" />
            Agent Brain — Knowledge Base
          </DialogTitle>
        </DialogHeader>

        {/* Add Rule Section */}
        <div className="space-y-2 border rounded-lg p-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Add Rule ({ruleCount}/20)
          </p>
          <Input
            placeholder="Rule title (optional)"
            value={ruleTitle}
            onChange={(e) => setRuleTitle(e.target.value)}
            className="text-sm"
          />
          <Textarea
            placeholder="Write your rule or instruction here..."
            value={ruleContent}
            onChange={(e) => setRuleContent(e.target.value)}
            rows={3}
            className="text-sm"
          />
          <Button
            onClick={addRule}
            disabled={!ruleContent.trim() || saving || ruleCount >= 20}
            size="sm"
            className="gap-1"
          >
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
            Add Rule
          </Button>
        </div>

        {/* Upload Files Section */}
        <div className="space-y-2 border rounded-lg p-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Upload Files ({fileCount}/10)
          </p>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,.pdf,.txt,.csv"
            onChange={handleFileUpload}
            className="hidden"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || fileCount >= 10}
            className="gap-1"
          >
            {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
            Upload File
          </Button>
          <p className="text-[10px] text-muted-foreground">PDF, images, text files (max 10 files)</p>
        </div>

        {/* Knowledge List */}
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Saved Knowledge ({items.length})
          </p>
          {loading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No knowledge added yet. Add rules or upload files to train the agent.
            </p>
          ) : (
            items.map((item) => (
              <div
                key={item.id}
                className="flex items-start gap-2 rounded-md border p-2 text-sm group"
              >
                {item.type === "rule" ? (
                  <FileText className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                ) : (
                  <Upload className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-xs truncate">
                    {item.title || (item.type === "rule" ? "Untitled Rule" : item.file_name)}
                  </p>
                  {item.content && (
                    <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                      {item.content}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => deleteItem(item)}
                  className="opacity-0 group-hover:opacity-100 text-destructive hover:text-destructive/80 transition-opacity"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default BrainKnowledgeDialog;
