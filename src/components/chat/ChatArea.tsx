import React, { useState, useRef, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Paperclip, Send, Loader2 } from "lucide-react";
import { toast } from "sonner";
import ChatMessage from "./ChatMessage";
import CalculationModePicker from "./CalculationModePicker";

interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  metadata?: Record<string, unknown>;
  step?: number;
  created_at: string;
}

interface ChatAreaProps {
  projectId: string;
  onProjectNameChange?: (name: string) => void;
  onStepChange?: (step: number | null) => void;
  onModeChange?: (mode: "smart" | "step-by-step" | null) => void;
}

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-blueprint`;

const ChatArea: React.FC<ChatAreaProps> = ({ projectId, onProjectNameChange, onStepChange, onModeChange }) => {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(true);
  const [uploadedFiles, setUploadedFiles] = useState<string[]>([]);
  const [showModePicker, setShowModePicker] = useState(false);
  const [calculationMode, setCalculationMode] = useState<"smart" | "step-by-step" | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadMessages();
    loadUploadedFiles();
  }, [projectId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const loadMessages = async () => {
    setLoadingMessages(true);
    const { data, error } = await supabase
      .from("messages")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true });

    if (!error && data) {
      setMessages(data as Message[]);
      // Check if mode was already selected
      const modeMsg = data.find((m: any) => m.metadata && (m.metadata as any).calculationMode);
      if (modeMsg) {
        const mode = (modeMsg.metadata as any).calculationMode;
        setCalculationMode(mode);
        onModeChange?.(mode);
        onStepChange?.(1);
      }
    }
    setLoadingMessages(false);
  };

  const loadUploadedFiles = async () => {
    const { data } = await supabase
      .from("project_files")
      .select("file_path, file_type")
      .eq("project_id", projectId);

    if (data && data.length > 0) {
      const urls = await Promise.all(
        data.map(async (f) => {
          const { data: signedData } = await supabase.storage
            .from("blueprints")
            .createSignedUrl(f.file_path, 3600);
          return signedData?.signedUrl || "";
        })
      );
      setUploadedFiles(urls.filter(Boolean));
    }
  };

  const streamAIResponse = useCallback(
    async (chatMessages: { role: string; content: string }[], mode: "smart" | "step-by-step", fileUrls: string[]) => {
      const resp = await fetch(CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ messages: chatMessages, mode, fileUrls }),
      });

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({ error: "AI request failed" }));
        throw new Error(errData.error || `Request failed (${resp.status})`);
      }

      if (!resp.body) throw new Error("No response body");

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let textBuffer = "";
      let fullContent = "";

      const assistantId = crypto.randomUUID();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        textBuffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = textBuffer.indexOf("\n")) !== -1) {
          let line = textBuffer.slice(0, newlineIndex);
          textBuffer = textBuffer.slice(newlineIndex + 1);

          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (line.startsWith(":") || line.trim() === "") continue;
          if (!line.startsWith("data: ")) continue;

          const jsonStr = line.slice(6).trim();
          if (jsonStr === "[DONE]") break;

          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content as string | undefined;
            if (content) {
              fullContent += content;
              setMessages((prev) => {
                const last = prev[prev.length - 1];
                if (last?.id === assistantId) {
                  return prev.map((m) => (m.id === assistantId ? { ...m, content: fullContent } : m));
                }
                return [
                  ...prev,
                  {
                    id: assistantId,
                    role: "assistant" as const,
                    content: fullContent,
                    created_at: new Date().toISOString(),
                  },
                ];
              });
            }
          } catch {
            textBuffer = line + "\n" + textBuffer;
            break;
          }
        }
      }

      // Flush remaining
      if (textBuffer.trim()) {
        for (let raw of textBuffer.split("\n")) {
          if (!raw) continue;
          if (raw.endsWith("\r")) raw = raw.slice(0, -1);
          if (!raw.startsWith("data: ")) continue;
          const jsonStr = raw.slice(6).trim();
          if (jsonStr === "[DONE]") continue;
          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content as string | undefined;
            if (content) {
              fullContent += content;
              setMessages((prev) =>
                prev.map((m) => (m.id === assistantId ? { ...m, content: fullContent } : m))
              );
            }
          } catch {}
        }
      }

      return fullContent;
    },
    []
  );

  const handleModeSelect = async (mode: "smart" | "step-by-step") => {
    if (!user) return;
    setShowModePicker(false);
    setCalculationMode(mode);
    onModeChange?.(mode);
    onStepChange?.(1);
    setLoading(true);

    const modeLabel = mode === "smart" ? "⚡ Smart Calculation" : "📋 Step-by-Step Calculation";
    const modeMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: `Selected: **${modeLabel}**`,
      metadata: { calculationMode: mode },
      created_at: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, modeMsg]);

    await supabase.from("messages").insert({
      project_id: projectId,
      user_id: user.id,
      role: "user",
      content: modeMsg.content,
      metadata: { calculationMode: mode },
    });

    try {
      const chatHistory = [{ role: "user", content: `I've uploaded my blueprint files. Please begin the ${mode === "smart" ? "complete automatic" : "step-by-step"} estimation process.` }];

      const fullContent = await streamAIResponse(chatHistory, mode, uploadedFiles);

      // Save assistant response to DB
      await supabase.from("messages").insert({
        project_id: projectId,
        user_id: user.id,
        role: "assistant",
        content: fullContent,
        metadata: { calculationMode: mode, step: 1 },
      });
    } catch (err: any) {
      toast.error(err.message || "AI analysis failed");
    }

    setLoading(false);
  };

  const sendMessage = async () => {
    if (!input.trim() || !user || loading) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: input.trim(),
      created_at: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMessage]);
    const msgContent = input.trim();
    setInput("");
    setLoading(true);

    if (textareaRef.current) textareaRef.current.style.height = "auto";

    await supabase.from("messages").insert({
      project_id: projectId,
      user_id: user.id,
      role: "user",
      content: msgContent,
    });

    // If no mode selected yet and files exist, show mode picker
    if (!calculationMode && uploadedFiles.length > 0) {
      setShowModePicker(true);
      setLoading(false);
      return;
    }

    // If mode is selected, continue conversation with AI
    if (calculationMode) {
      try {
        // Build chat history from messages
        const chatHistory = messages
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({ role: m.role, content: m.content }));
        chatHistory.push({ role: "user", content: msgContent });

        const fullContent = await streamAIResponse(chatHistory, calculationMode, uploadedFiles);

        await supabase.from("messages").insert({
          project_id: projectId,
          user_id: user.id,
          role: "assistant",
          content: fullContent,
        });
      } catch (err: any) {
        toast.error(err.message || "AI analysis failed");
      }
    }

    setLoading(false);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || !user) return;

    const newUrls: string[] = [];

    for (const file of Array.from(files)) {
      const filePath = `${user.id}/${projectId}/${Date.now()}_${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from("blueprints")
        .upload(filePath, file);

      if (uploadError) {
        toast.error(`Failed to upload ${file.name}`);
        continue;
      }

      await supabase.from("project_files").insert({
        project_id: projectId,
        user_id: user.id,
        file_name: file.name,
        file_path: filePath,
        file_type: file.type,
        file_size: file.size,
      });

      // Get signed URL
      const { data: signedData } = await supabase.storage
        .from("blueprints")
        .createSignedUrl(filePath, 3600);

      if (signedData?.signedUrl) newUrls.push(signedData.signedUrl);

      const msg: Message = {
        id: crypto.randomUUID(),
        role: "user",
        content: `📎 Uploaded: **${file.name}** (${(file.size / 1024 / 1024).toFixed(2)} MB)`,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, msg]);

      await supabase.from("messages").insert({
        project_id: projectId,
        user_id: user.id,
        role: "user",
        content: msg.content,
      });
    }

    setUploadedFiles((prev) => [...prev, ...newUrls]);

    if (fileInputRef.current) fileInputRef.current.value = "";
    toast.success("Files uploaded successfully!");

    // Auto-rename project to first uploaded file name (without extension)
    if (files.length > 0) {
      const firstName = files[0].name.replace(/\.[^/.]+$/, "");
      await supabase.from("projects").update({ name: firstName }).eq("id", projectId);
      onProjectNameChange?.(firstName);
    }

    // Show mode picker after upload if not already selected
    if (!calculationMode && (uploadedFiles.length + newUrls.length) > 0) {
      setShowModePicker(true);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  };

  return (
    <div className="flex flex-1 flex-col min-h-0">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-4 py-6 space-y-1">
          {loadingMessages ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center max-w-lg mx-auto">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary mb-5">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>
              </div>
              <h3 className="text-xl font-semibold text-foreground mb-2">
                Welcome to Rebar Estimator Pro
              </h3>
              <p className="text-muted-foreground text-sm mb-4">
                Upload your construction blueprint files (PDF or images) using the 📎 button below to get started with rebar weight and wire mesh estimation.
              </p>
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-left">
                <p className="text-xs text-destructive flex items-start gap-2">
                  <span className="text-base leading-none mt-0.5">⚠️</span>
                  <span>
                    <strong>Important:</strong> This app is an AI-powered estimation tool and may produce errors or inaccurate results. Always double-check and verify the calculations against your original blueprints before using them in any project.
                  </span>
                </p>
              </div>
            </div>
          ) : (
            messages.map((msg) => <ChatMessage key={msg.id} message={msg} />)
          )}

          {/* Mode Picker */}
          {showModePicker && !calculationMode && (
            <div className="py-2">
              <CalculationModePicker onSelect={handleModeSelect} disabled={loading} />
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input Bar */}
      <div className="border-t border-border bg-background p-4">
        <div className="mx-auto max-w-3xl">
          <div className="flex items-end gap-2 rounded-xl border border-border bg-chat-input p-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,.pdf,.dwg,.dxf"
              onChange={handleFileUpload}
              className="hidden"
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => fileInputRef.current?.click()}
              className="h-9 w-9 flex-shrink-0 text-muted-foreground hover:text-foreground"
            >
              <Paperclip className="h-5 w-5" />
            </Button>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleTextareaChange}
              onKeyDown={handleKeyDown}
              placeholder="Message Rebar Estimator..."
              rows={1}
              className="flex-1 resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none min-h-[36px] max-h-[200px] py-2"
            />
            <Button
              onClick={sendMessage}
              disabled={(!input.trim() && !showModePicker) || loading}
              size="icon"
              className="h-9 w-9 flex-shrink-0 rounded-lg"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
          <p className="mt-2 text-center text-xs text-muted-foreground">
            AI-powered rebar and wire mesh estimation from construction blueprints
          </p>
        </div>
      </div>
    </div>
  );
};

export default ChatArea;
