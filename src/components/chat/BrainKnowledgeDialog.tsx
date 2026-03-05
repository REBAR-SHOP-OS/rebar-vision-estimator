import React, { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Brain, Upload, Trash2, FileText, Plus, Loader2, GraduationCap, Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import * as XLSX from "xlsx";

interface KnowledgeItem {
  id: string;
  title: string | null;
  content: string | null;
  file_path: string | null;
  file_name: string | null;
  type: string;
  created_at: string;
}

interface TrainingExample {
  id: string;
  title: string;
  description: string | null;
  blueprint_file_paths: string[];
  blueprint_file_names: string[];
  answer_file_path: string | null;
  answer_file_name: string | null;
  answer_text: string | null;
  created_at: string;
}

const BrainKnowledgeDialog: React.FC = () => {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [trainingExamples, setTrainingExamples] = useState<TrainingExample[]>([]);
  const [loading, setLoading] = useState(false);
  const [ruleTitle, setRuleTitle] = useState("");
  const [ruleContent, setRuleContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Training form state
  const [trainingTitle, setTrainingTitle] = useState("");
  const [trainingDescription, setTrainingDescription] = useState("");
  const [trainingBlueprintFiles, setTrainingBlueprintFiles] = useState<File[]>([]);
  const [trainingAnswerFile, setTrainingAnswerFile] = useState<File | null>(null);
  const [trainingAnswerText, setTrainingAnswerText] = useState("");
  const [savingTraining, setSavingTraining] = useState(false);
  const blueprintInputRef = useRef<HTMLInputElement>(null);
  const answerInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && user) {
      loadItems();
      loadTrainingExamples();
    }
  }, [open, user]);

  const loadItems = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("agent_knowledge" as any)
      .select("*")
      .order("created_at", { ascending: false });

    if (!error && data) setItems(data as any);
    setLoading(false);
  };

  const loadTrainingExamples = async () => {
    const { data, error } = await supabase
      .from("agent_training_examples" as any)
      .select("*")
      .order("created_at", { ascending: false });

    if (!error && data) setTrainingExamples(data as any);
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

  // Parse Excel file to text
  const parseExcelToText = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target!.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: "array" });
          let text = "";
          for (const sheetName of workbook.SheetNames) {
            const sheet = workbook.Sheets[sheetName];
            text += `=== Sheet: ${sheetName} ===\n`;
            text += XLSX.utils.sheet_to_csv(sheet) + "\n\n";
          }
          resolve(text.trim());
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  };

  // Handle answer file selection - auto-parse Excel
  const handleAnswerFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setTrainingAnswerFile(file);

    const ext = file.name.toLowerCase().split(".").pop();
    if (ext === "xlsx" || ext === "xls") {
      try {
        const text = await parseExcelToText(file);
        setTrainingAnswerText(text);
        toast.success("Excel parsed successfully");
      } catch {
        toast.error("Failed to parse Excel file");
      }
    }
  };

  const saveTrainingExample = async () => {
    if (!trainingTitle.trim() || !user) return;
    if (!trainingAnswerText.trim() && !trainingAnswerFile) {
      toast.error("Please provide answer data (file or text)");
      return;
    }
    if (trainingExamples.length >= 5) {
      toast.error("Maximum 5 training examples allowed");
      return;
    }
    if (trainingAnswerText.length > 50000) {
      toast.error("Answer text exceeds 50,000 character limit");
      return;
    }

    setSavingTraining(true);

    try {
      // Upload blueprint files
      const blueprintPaths: string[] = [];
      const blueprintNames: string[] = [];
      for (const file of trainingBlueprintFiles.slice(0, 3)) {
        const filePath = `${user.id}/knowledge/training/blueprints/${Date.now()}_${file.name}`;
        const { error } = await supabase.storage.from("blueprints").upload(filePath, file, { upsert: true });
        if (!error) {
          blueprintPaths.push(filePath);
          blueprintNames.push(file.name);
        }
      }

      // Upload answer file
      let answerFilePath: string | null = null;
      let answerFileName: string | null = null;
      if (trainingAnswerFile) {
        const fp = `${user.id}/knowledge/training/answers/${Date.now()}_${trainingAnswerFile.name}`;
        const { error } = await supabase.storage.from("blueprints").upload(fp, trainingAnswerFile, { upsert: true });
        if (!error) {
          answerFilePath = fp;
          answerFileName = trainingAnswerFile.name;
        }
      }

      const { error } = await supabase.from("agent_training_examples" as any).insert({
        user_id: user.id,
        title: trainingTitle.trim(),
        description: trainingDescription.trim() || null,
        blueprint_file_paths: blueprintPaths,
        blueprint_file_names: blueprintNames,
        answer_file_path: answerFilePath,
        answer_file_name: answerFileName,
        answer_text: trainingAnswerText.trim() || null,
      } as any);

      if (error) {
        toast.error("Failed to save training example");
      } else {
        toast.success("Training example saved!");
        setTrainingTitle("");
        setTrainingDescription("");
        setTrainingBlueprintFiles([]);
        setTrainingAnswerFile(null);
        setTrainingAnswerText("");
        loadTrainingExamples();
      }
    } catch {
      toast.error("Error saving training example");
    }

    setSavingTraining(false);
  };

  const deleteTrainingExample = async (example: TrainingExample) => {
    // Delete files from storage
    const filesToDelete = [...(example.blueprint_file_paths || [])];
    if (example.answer_file_path) filesToDelete.push(example.answer_file_path);
    if (filesToDelete.length > 0) {
      await supabase.storage.from("blueprints").remove(filesToDelete);
    }

    const { error } = await supabase
      .from("agent_training_examples" as any)
      .delete()
      .eq("id", example.id);

    if (error) {
      toast.error("Failed to delete");
    } else {
      setTrainingExamples((prev) => prev.filter((e) => e.id !== example.id));
    }
  };

  const ruleCount = items.filter((i) => i.type === "rule").length;
  const fileCount = items.filter((i) => i.type === "file").length;
  const learnedItems = items.filter((i) => i.type === "learned");
  const totalCount = items.length + trainingExamples.length;

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
          {totalCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-primary text-[9px] font-bold text-primary-foreground flex items-center justify-center">
              {totalCount}
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

        <Tabs defaultValue="rules" className="w-full">
          <TabsList className="w-full">
            <TabsTrigger value="rules" className="flex-1 gap-1">
              <FileText className="h-3.5 w-3.5" />
              Rules ({ruleCount})
            </TabsTrigger>
            <TabsTrigger value="files" className="flex-1 gap-1">
              <Upload className="h-3.5 w-3.5" />
              Files ({fileCount})
            </TabsTrigger>
            <TabsTrigger value="training" className="flex-1 gap-1">
              <GraduationCap className="h-3.5 w-3.5" />
              Training ({trainingExamples.length})
            </TabsTrigger>
            <TabsTrigger value="learned" className="flex-1 gap-1">
              <Lightbulb className="h-3.5 w-3.5" />
              Learned ({learnedItems.length})
            </TabsTrigger>
          </TabsList>

          {/* Rules Tab */}
          <TabsContent value="rules" className="space-y-3">
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

            {loading ? (
              <div className="flex justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              items
                .filter((i) => i.type === "rule")
                .map((item) => (
                  <div key={item.id} className="flex items-start gap-2 rounded-md border p-2 text-sm group">
                    <FileText className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-xs truncate">
                        {item.title || "Untitled Rule"}
                      </p>
                      {item.content && (
                        <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{item.content}</p>
                      )}
                    </div>
                    <button onClick={() => deleteItem(item)} className="opacity-0 group-hover:opacity-100 text-destructive hover:text-destructive/80 transition-opacity">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))
            )}
          </TabsContent>

          {/* Files Tab */}
          <TabsContent value="files" className="space-y-3">
            <div className="space-y-2 border rounded-lg p-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Upload Files ({fileCount}/10)
              </p>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="*"
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

            {items
              .filter((i) => i.type === "file")
              .map((item) => (
                <div key={item.id} className="flex items-start gap-2 rounded-md border p-2 text-sm group">
                  <Upload className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-xs truncate">{item.file_name || item.title}</p>
                  </div>
                  <button onClick={() => deleteItem(item)} className="opacity-0 group-hover:opacity-100 text-destructive hover:text-destructive/80 transition-opacity">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
          </TabsContent>

          {/* Training Tab */}
          <TabsContent value="training" className="space-y-3">
            <div className="space-y-2 border rounded-lg p-3">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Add Training Example ({trainingExamples.length}/5)
              </p>
              <Input
                placeholder="Project title (e.g. CRU-1 LONDON)"
                value={trainingTitle}
                onChange={(e) => setTrainingTitle(e.target.value)}
                className="text-sm"
              />
              <Input
                placeholder="Description (optional)"
                value={trainingDescription}
                onChange={(e) => setTrainingDescription(e.target.value)}
                className="text-sm"
              />

              {/* Blueprint files */}
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Blueprint files (input - max 3):</p>
                <input
                  ref={blueprintInputRef}
                  type="file"
                  multiple
                  accept="*"
                  onChange={(e) => {
                    const files = Array.from(e.target.files || []).slice(0, 3);
                    setTrainingBlueprintFiles(files);
                  }}
                  className="hidden"
                />
                <Button variant="outline" size="sm" onClick={() => blueprintInputRef.current?.click()} className="gap-1 text-xs">
                  <Upload className="h-3 w-3" />
                  {trainingBlueprintFiles.length > 0
                    ? `${trainingBlueprintFiles.length} file(s) selected`
                    : "Select Blueprints"}
                </Button>
              </div>

              {/* Answer file */}
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Answer file (output - Excel/PDF):</p>
                <input
                  ref={answerInputRef}
                  type="file"
                  accept="*"
                  onChange={handleAnswerFileSelect}
                  className="hidden"
                />
                <Button variant="outline" size="sm" onClick={() => answerInputRef.current?.click()} className="gap-1 text-xs">
                  <Upload className="h-3 w-3" />
                  {trainingAnswerFile ? trainingAnswerFile.name : "Select Answer File"}
                </Button>
              </div>

              {/* Answer text */}
              <Textarea
                placeholder="Or paste answer text directly here..."
                value={trainingAnswerText}
                onChange={(e) => setTrainingAnswerText(e.target.value)}
                rows={4}
                className="text-xs font-mono"
              />
              {trainingAnswerText && (
                <p className="text-[10px] text-muted-foreground">
                  {trainingAnswerText.length.toLocaleString()} / 50,000 characters
                </p>
              )}

              <Button
                onClick={saveTrainingExample}
                disabled={!trainingTitle.trim() || (!trainingAnswerText.trim() && !trainingAnswerFile) || savingTraining || trainingExamples.length >= 5}
                size="sm"
                className="gap-1"
              >
                {savingTraining ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                Save Training Example
              </Button>
            </div>

            {trainingExamples.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No training examples yet. Add blueprints with correct answers to teach the agent.
              </p>
            ) : (
              trainingExamples.map((ex) => (
                <div key={ex.id} className="flex items-start gap-2 rounded-md border p-2 text-sm group">
                  <GraduationCap className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-xs truncate">{ex.title}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {(ex.blueprint_file_names || []).length} blueprint(s)
                      {ex.answer_file_name ? ` • ${ex.answer_file_name}` : ""}
                      {ex.answer_text ? ` • ${(ex.answer_text.length / 1000).toFixed(1)}K chars` : ""}
                    </p>
                  </div>
                  <button onClick={() => deleteTrainingExample(ex)} className="opacity-0 group-hover:opacity-100 text-destructive hover:text-destructive/80 transition-opacity">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))
            )}
          </TabsContent>

          {/* Learned Tab */}
          <TabsContent value="learned" className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Knowledge automatically extracted from your conversations with the AI.
            </p>
            {learnedItems.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No learnings yet. The agent will learn from your conversations automatically.
              </p>
            ) : (
              learnedItems.map((item) => (
                <div key={item.id} className="flex items-start gap-2 rounded-md border p-2 text-sm group">
                  <Lightbulb className="h-4 w-4 text-yellow-500 mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    {item.content && (
                      <p className="text-xs text-muted-foreground line-clamp-4">{item.content}</p>
                    )}
                    <p className="text-[10px] text-muted-foreground/60 mt-1">
                      {new Date(item.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <button onClick={() => deleteItem(item)} className="opacity-0 group-hover:opacity-100 text-destructive hover:text-destructive/80 transition-opacity">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
};

export default BrainKnowledgeDialog;
