import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Paperclip, Send, Loader2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import ChatMessage from "./ChatMessage";
import CalculationModePicker from "./CalculationModePicker";
import ValidationResults from "./ValidationResults";
import ScopeDefinitionPanel, { type ScopeData, type DetectionResult } from "./ScopeDefinitionPanel";
import BlueprintViewer from "./BlueprintViewer";
import { type OverlayElement } from "./DrawingOverlay";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { useIsMobile } from "@/hooks/use-mobile";

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
  initialFiles?: File[] | null;
  onInitialFilesConsumed?: () => void;
  onProjectNameChange?: (name: string) => void;
  onStepChange?: (step: number | null) => void;
  onModeChange?: (mode: "smart" | "step-by-step" | null) => void;
}

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-blueprint`;
const LEARN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/extract-learning`;
const VALIDATE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/validate-elements`;
const PRICE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/price-elements`;
const DETECT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/detect-project-type`;

const ChatArea: React.FC<ChatAreaProps> = ({ projectId, initialFiles, onInitialFilesConsumed, onProjectNameChange, onStepChange, onModeChange }) => {
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
  const [uploadProgress, setUploadProgress] = useState<{ fileName: string; progress: number } | null>(null);
  const messageCountSinceLastLearn = useRef(0);
  const [validationData, setValidationData] = useState<any>(null);
  const [quoteResult, setQuoteResult] = useState<any>(null);
  const [userAnswers, setUserAnswers] = useState<{ element_id: string; field: string; value: string }[]>([]);
  const [showScopePanel, setShowScopePanel] = useState(false);
  const [scopeData, setScopeData] = useState<ScopeData | null>(null);
  const [detectionResult, setDetectionResult] = useState<DetectionResult | null>(null);
  const [isDetecting, setIsDetecting] = useState(false);
  const [showBlueprintViewer, setShowBlueprintViewer] = useState(false);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const isMobile = useIsMobile();
  useEffect(() => {
    // Reset state when switching projects
    setMessages([]);
    setUploadedFiles([]);
    setShowModePicker(false);
    setCalculationMode(null);
    setUploadProgress(null);
    setValidationData(null);
    setQuoteResult(null);
    setUserAnswers([]);
    setShowScopePanel(false);
    setScopeData(null);
    setDetectionResult(null);
    setIsDetecting(false);
    initialFilesProcessed.current = false;
    onModeChange?.(null);
    onStepChange?.(null);
    loadMessages();
    loadUploadedFiles();
  }, [projectId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Auto-upload initial files passed from Dashboard
  const initialFilesProcessed = useRef(false);
  useEffect(() => {
    if (initialFiles && initialFiles.length > 0 && !initialFilesProcessed.current) {
      initialFilesProcessed.current = true;
      // Create a synthetic event-like object to reuse handleFileUpload logic
      const dataTransfer = new DataTransfer();
      initialFiles.forEach((f) => dataTransfer.items.add(f));
      const syntheticEvent = {
        target: { files: dataTransfer.files },
      } as React.ChangeEvent<HTMLInputElement>;
      handleFileUpload(syntheticEvent);
      onInitialFilesConsumed?.();
    }
  }, [initialFiles]);

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

  const fetchKnowledgeContext = async (): Promise<{ rules: string[]; fileUrls: string[]; trainingExamples: { title: string; answerText: string }[]; learnedRules: string[] }> => {
    if (!user) return { rules: [], fileUrls: [], trainingExamples: [], learnedRules: [] };
    
    // Fetch knowledge items
    const { data } = await supabase
      .from("agent_knowledge" as any)
      .select("*")
      .eq("user_id", user.id);

    const rules: string[] = [];
    const knowledgeFileUrls: string[] = [];
    const learnedRules: string[] = [];

    if (data && data.length > 0) {
      for (const item of data as any[]) {
        if (item.type === "rule" && item.content) {
          rules.push(item.title ? `[${item.title}]: ${item.content}` : item.content);
        } else if (item.type === "learned" && item.content) {
          learnedRules.push(item.content);
        } else if (item.type === "file" && item.file_path) {
          const { data: signedData } = await supabase.storage
            .from("blueprints")
            .createSignedUrl(item.file_path, 3600);
          if (signedData?.signedUrl) knowledgeFileUrls.push(signedData.signedUrl);
        }
      }
    }

    // Fetch training examples
    const { data: trainingData } = await supabase
      .from("agent_training_examples" as any)
      .select("*")
      .eq("user_id", user.id);

    const trainingExamples: { title: string; answerText: string }[] = [];
    if (trainingData && trainingData.length > 0) {
      for (const ex of trainingData as any[]) {
        if (ex.answer_text) {
          trainingExamples.push({ title: ex.title, answerText: ex.answer_text });
        }
      }
    }

    return { rules, fileUrls: knowledgeFileUrls, trainingExamples, learnedRules };
  };

  const scopeDataRef = useRef(scopeData);
  useEffect(() => { scopeDataRef.current = scopeData; }, [scopeData]);

  const streamAIResponse = useCallback(
    async (chatMessages: { role: string; content: string }[], mode: "smart" | "step-by-step", fileUrls: string[]) => {
      // Fetch user knowledge context
      const knowledgeContext = await fetchKnowledgeContext();

      const resp = await fetch(CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ messages: chatMessages, mode, fileUrls, knowledgeContext, scope: scopeDataRef.current }),
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
              
              // Parse step markers from streamed content
              const stepMatch = fullContent.match(/(?:^|\n)\s*(?:###?\s*)?Step\s+(\d+(?:\.\d+)?)\s*[—–\-:]/gim);
              if (stepMatch) {
                const lastStep = stepMatch[stepMatch.length - 1];
                const numMatch = lastStep.match(/Step\s+(\d+(?:\.\d+)?)/i);
                if (numMatch) {
                  const stepNum = parseFloat(numMatch[1]);
                  onStepChange?.(stepNum);
                }
              }
              
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

      // Mark final step as done
      onStepChange?.(9);
      
      return fullContent;
    },
    [onStepChange]
  );

  // Fire-and-forget: extract learnings from chat
  const triggerLearning = useCallback((allMessages: { role: string; content: string }[]) => {
    if (!user) return;
    messageCountSinceLastLearn.current++;
    if (messageCountSinceLastLearn.current < 5) return;
    if (allMessages.length < 3) return;
    messageCountSinceLastLearn.current = 0;
    
    fetch(LEARN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
      },
      body: JSON.stringify({
        messages: allMessages.slice(-10), // last 10 messages for context
        userId: user.id,
      }),
    }).catch(() => {}); // fire-and-forget
  }, [user]);

  // ── Atomic Truth Pipeline helpers ──
  const extractAtomicTruthJSON = (content: string): any | null => {
    const startMarker = "%%%ATOMIC_TRUTH_JSON_START%%%";
    const endMarker = "%%%ATOMIC_TRUTH_JSON_END%%%";
    const startIdx = content.indexOf(startMarker);
    const endIdx = content.indexOf(endMarker);
    if (startIdx === -1 || endIdx === -1) return null;
    const jsonStr = content.substring(startIdx + startMarker.length, endIdx).trim();
    try {
      return JSON.parse(jsonStr);
    } catch {
      console.error("Failed to parse Atomic Truth JSON");
      return null;
    }
  };

  const runValidation = async (elements: any[], answers?: any[]) => {
    try {
      const resp = await fetch(VALIDATE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ elements, userAnswers: answers }),
      });
      if (!resp.ok) throw new Error("Validation failed");
      const data = await resp.json();
      setValidationData(data);
      return data;
    } catch (err: any) {
      toast.error("Validation failed: " + (err.message || "Unknown error"));
      return null;
    }
  };

  const runPricing = async (elements: any[], mode: "ai_express" | "verified") => {
    try {
      const truthElements = elements
        .filter((e: any) => mode === "ai_express" ? e.status === "READY" : true)
        .map((e: any) => ({
          element_id: e.element_id,
          element_type: e.element_type,
          truth: e.extraction?.truth || {},
          sources: e.extraction?.sources || { identity_sources: [] },
          confidence: e.extraction?.confidence || 0,
          status: e.status,
        }));

      const resp = await fetch(PRICE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ elements: truthElements, mode }),
      });
      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        throw new Error(errData.message || "Pricing failed");
      }
      const data = await resp.json();
      setQuoteResult(data);
    } catch (err: any) {
      toast.error("Pricing failed: " + (err.message || "Unknown error"));
    }
  };

  const handleAnswerQuestion = (elementId: string, field: string, value: string) => {
    setUserAnswers((prev) => [...prev, { element_id: elementId, field, value }]);
  };

  const handleRequestQuote = async (mode: "ai_express" | "verified") => {
    if (!validationData?.elements) return;
    if (userAnswers.length > 0) {
      const revalidated = await runValidation(validationData.elements, userAnswers);
      if (revalidated) {
        await runPricing(revalidated.elements, mode);
      }
    } else {
      await runPricing(validationData.elements, mode);
    }
  };

  const processAtomicTruth = async (fullContent: string) => {
    const atomicData = extractAtomicTruthJSON(fullContent);
    if (atomicData?.elements && atomicData.elements.length > 0) {
      await runValidation(atomicData.elements);
    }
  };

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

      // Trigger learning extraction
      triggerLearning([...chatHistory, { role: "assistant", content: fullContent }]);

      // Save assistant response to DB
      await supabase.from("messages").insert({
        project_id: projectId,
        user_id: user.id,
        role: "assistant",
        content: fullContent,
        metadata: { calculationMode: mode, step: 1 },
      });

      // Process Atomic Truth pipeline
      await processAtomicTruth(fullContent);
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

        // Trigger learning extraction
        triggerLearning([...chatHistory, { role: "assistant", content: fullContent }]);

        await supabase.from("messages").insert({
          project_id: projectId,
          user_id: user.id,
          role: "assistant",
          content: fullContent,
        });

        // Process Atomic Truth pipeline
        await processAtomicTruth(fullContent);
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
      setUploadProgress({ fileName: file.name, progress: 0 });

      // Get current session token for auth
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

      // Upload with progress tracking via XHR
      const uploadSuccess = await new Promise<boolean>((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const pct = Math.round((e.loaded / e.total) * 100);
            setUploadProgress({ fileName: file.name, progress: pct });
          }
        };
        xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300);
        xhr.onerror = () => resolve(false);
        const url = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/blueprints/${filePath}`;
        xhr.open("POST", url);
        xhr.setRequestHeader("Authorization", `Bearer ${token}`);
        xhr.setRequestHeader("apikey", import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);
        xhr.setRequestHeader("x-upsert", "true");
        xhr.send(file);
      });

      setUploadProgress(null);

      if (!uploadSuccess) {
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

    // Show scope panel and trigger detection after upload
    if (!calculationMode && (uploadedFiles.length + newUrls.length) > 0) {
      setShowScopePanel(true);
      // Trigger smart project type detection
      const allUrls = [...uploadedFiles, ...newUrls];
      setIsDetecting(true);
      try {
        const detectResp = await fetch(DETECT_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({ fileUrls: allUrls }),
        });
        if (detectResp.ok) {
          const result = await detectResp.json();
          setDetectionResult(result);
        }
      } catch (err) {
        console.error("Project type detection failed:", err);
      }
      setIsDetecting(false);
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

  // Build overlay elements from validation data
  const overlayElements: OverlayElement[] = useMemo(() => {
    if (!validationData?.elements) return [];
    return validationData.elements
      .filter((el: any) => el.regions?.tag_region?.bbox)
      .map((el: any) => ({
        element_id: el.element_id,
        element_type: el.element_type,
        status: el.status,
        bbox: el.regions.tag_region.bbox as [number, number, number, number],
        confidence: el.extraction?.confidence,
        weight_lbs: quoteResult?.quote?.elements?.find((qe: any) => qe.element_id === el.element_id)?.weight_lbs,
        page_number: el.regions?.tag_region?.page_number,
      }));
  }, [validationData, quoteResult]);

  // Show viewer whenever uploaded files exist (supports PDF read-only mode too)
  const hasDrawingData = uploadedFiles.length > 0;

  const handleShowOnDrawing = useCallback((elementId: string) => {
    setSelectedElementId(elementId);
    if (!showBlueprintViewer) setShowBlueprintViewer(true);
  }, [showBlueprintViewer]);

  const handleSelectElementFromViewer = useCallback((id: string | null) => {
    setSelectedElementId(id);
    if (id) {
      // Scroll to element card in results
      const card = document.getElementById(`element-card-${id}`);
      card?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, []);

  const chatContent = (
    <div className="flex flex-1 flex-col min-h-0 bg-background/50">
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
              <h3 className="text-xl font-bold text-foreground mb-2">
                Upload Your Blueprint
              </h3>
              <p className="text-muted-foreground text-sm mb-5">
                Drag and drop your files below or click the 📎 button to upload PDF, DWG, or image files.
              </p>
              {/* Drop zone */}
              <div
                className="w-full rounded-xl border-2 border-dashed border-primary/30 bg-primary/5 p-8 cursor-pointer hover:border-primary/50 hover:bg-primary/10 transition-all"
                onClick={() => fileInputRef.current?.click()}
              >
                <div className="flex flex-col items-center gap-2">
                  <div className="flex gap-3 text-2xl">📄 🏗️ 📐</div>
                  <p className="text-xs font-semibold text-primary">Click to upload files</p>
                  <p className="text-[10px] text-muted-foreground">PDF, DWG, PNG, JPG supported</p>
                </div>
              </div>
              <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-left mt-5 w-full">
                <p className="text-xs text-destructive flex items-start gap-2">
                  <span className="text-base leading-none mt-0.5">⚠️</span>
                  <span>
                    <strong>Important:</strong> This app is an AI-powered estimation tool and may produce errors. Always verify calculations against your original blueprints.
                  </span>
                </p>
              </div>
            </div>
          ) : (
            messages.map((msg) => <ChatMessage key={msg.id} message={msg} />)
          )}

          {/* Validation Results */}
          {validationData && (
            <div className="py-2">
              <ValidationResults
                elements={validationData.elements}
                summary={validationData.summary}
                questions={validationData.questions || []}
                quoteResult={quoteResult}
                onAnswerQuestion={handleAnswerQuestion}
                onRequestQuote={handleRequestQuote}
                scopeData={scopeData}
                onShowOnDrawing={handleShowOnDrawing}
                onToggleViewer={() => setShowBlueprintViewer((v) => !v)}
                showViewer={showBlueprintViewer}
                selectedElementId={selectedElementId}
                hasDrawingData={hasDrawingData}
              />
            </div>
          )}

          {/* Scope Definition Panel */}
          {showScopePanel && !scopeData && !calculationMode && (
            <div className="py-2">
              <ScopeDefinitionPanel
                onProceed={(scope) => {
                  setScopeData(scope);
                  setShowScopePanel(false);
                  setShowModePicker(true);
                  if (user) {
                    supabase.from("projects").update({
                      client_name: scope.clientName || null,
                      project_type: scope.projectType || null,
                      scope_items: scope.scopeItems,
                      deviations: scope.deviations || null,
                    } as any).eq("id", projectId);
                  }
                }}
                disabled={loading}
                detectionResult={detectionResult}
                isDetecting={isDetecting}
              />
            </div>
          )}

          {showModePicker && !calculationMode && (
            <div className="py-2">
              <CalculationModePicker onSelect={handleModeSelect} disabled={loading} />
            </div>
          )}

          {/* Upload Progress */}
          {uploadProgress && (
            <div className="py-2 px-1">
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Uploading: {uploadProgress.fileName}</span>
                <span className="ml-auto font-medium">{uploadProgress.progress}%</span>
              </div>
              <Progress value={uploadProgress.progress} className="h-2" />
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input Bar */}
      <div className="border-t border-border bg-background/80 backdrop-blur-sm p-3">
        <div className="mx-auto max-w-3xl">
          <div className="flex items-end gap-2 rounded-2xl border border-border bg-chat-input p-2 shadow-sm">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="*"
              onChange={handleFileUpload}
              className="hidden"
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => fileInputRef.current?.click()}
              className="h-9 w-9 flex-shrink-0 text-muted-foreground hover:text-primary rounded-xl"
              title="Attach files"
            >
              <Paperclip className="h-4 w-4" />
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
              className="h-9 w-9 flex-shrink-0 rounded-xl"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
          <div className="flex items-center justify-center gap-2 mt-2">
            <span className="text-[10px] text-muted-foreground">Powered by AI</span>
            <span className="text-[10px] text-muted-foreground/50">•</span>
            <span className="text-[10px] text-muted-foreground/50">Shift+Enter for new line</span>
          </div>
        </div>
      </div>
    </div>
  );

  // If blueprint viewer is active and not mobile, show split panel
  if (showBlueprintViewer && hasDrawingData && !isMobile) {
    return (
      <ResizablePanelGroup direction="horizontal" className="flex-1 min-h-0">
        <ResizablePanel defaultSize={55} minSize={30}>
          <BlueprintViewer
            imageUrl={uploadedFiles[0]}
            elements={overlayElements}
            selectedElementId={selectedElementId}
            onSelectElement={handleSelectElementFromViewer}
            onClose={() => setShowBlueprintViewer(false)}
          />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={45} minSize={25}>
          {chatContent}
        </ResizablePanel>
      </ResizablePanelGroup>
    );
  }

  // Mobile: stack viewer above chat
  if (showBlueprintViewer && hasDrawingData && isMobile) {
    return (
      <div className="flex flex-col flex-1 min-h-0">
        <div className="h-[40vh] flex-shrink-0">
          <BlueprintViewer
            imageUrl={uploadedFiles[0]}
            elements={overlayElements}
            selectedElementId={selectedElementId}
            onSelectElement={handleSelectElementFromViewer}
            onClose={() => setShowBlueprintViewer(false)}
          />
        </div>
        {chatContent}
      </div>
    );
  }

  return chatContent;
};

export default ChatArea;
