import React, { useState, useRef, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Paperclip, Send, Loader2 } from "lucide-react";
import { toast } from "sonner";
import ChatMessage from "./ChatMessage";

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
}

const ChatArea: React.FC<ChatAreaProps> = ({ projectId, onProjectNameChange }) => {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadMessages();
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

    if (!error) {
      setMessages((data as Message[]) || []);
    }
    setLoadingMessages(false);
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
    setInput("");
    setLoading(true);

    // Auto-resize textarea back
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }

    // Save user message to DB
    const { error: saveError } = await supabase.from("messages").insert({
      project_id: projectId,
      user_id: user.id,
      role: "user",
      content: userMessage.content,
    });

    if (saveError) {
      toast.error("Failed to save message");
      setLoading(false);
      return;
    }

    // Placeholder: AI response (will be replaced with edge function later)
    const assistantMessage: Message = {
      id: crypto.randomUUID(),
      role: "assistant",
      content:
        "Welcome to Rebar Estimator Pro! To get started, please upload your construction blueprint files (PDF or images). I'll analyze them and guide you through the estimation process step by step.\n\n**What I can do:**\n- 🔍 Scan and identify rebar scopes from blueprints\n- 📐 Extract dimensions and scales\n- ⚖️ Calculate rebar weight by size\n- 📊 Estimate welded wire mesh sheets\n- 📄 Generate PDF reports\n\nUpload your files using the 📎 button below to begin!",
      created_at: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, assistantMessage]);

    // Save assistant message
    await supabase.from("messages").insert({
      project_id: projectId,
      user_id: user.id,
      role: "assistant",
      content: assistantMessage.content,
    });

    setLoading(false);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || !user) return;

    for (const file of Array.from(files)) {
      const filePath = `${user.id}/${projectId}/${Date.now()}_${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from("blueprints")
        .upload(filePath, file);

      if (uploadError) {
        toast.error(`Failed to upload ${file.name}`);
        continue;
      }

      // Save file metadata
      await supabase.from("project_files").insert({
        project_id: projectId,
        user_id: user.id,
        file_name: file.name,
        file_path: filePath,
        file_type: file.type,
        file_size: file.size,
      });

      // Add message about file upload
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

    // Reset file input
    if (fileInputRef.current) fileInputRef.current.value = "";
    toast.success("Files uploaded successfully!");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    // Auto-resize
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
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <h3 className="text-lg font-medium text-foreground mb-2">
                Start your estimation
              </h3>
              <p className="text-muted-foreground text-sm max-w-sm">
                Upload blueprint files or describe your project to begin the rebar and wire mesh estimation process.
              </p>
            </div>
          ) : (
            messages.map((msg) => <ChatMessage key={msg.id} message={msg} />)
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
              disabled={!input.trim() || loading}
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
