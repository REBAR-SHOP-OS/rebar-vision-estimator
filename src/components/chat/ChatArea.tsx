import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { renderPdfPagesToImages } from "@/lib/pdf-to-images";
import { Button } from "@/components/ui/button";
import { Paperclip, Send, Loader2, CheckCircle, SlidersHorizontal, Plus, Table, Download, AlertTriangle, RefreshCw, Zap, ListChecks, HelpCircle, Upload, FileQuestion, Sparkles, FileText, FileSpreadsheet, X, Eye, FileCheck, Square } from "lucide-react";
import SizeBreakdownTable from "./SizeBreakdownTable";
import ExportButtons from "./ExportButtons";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { exportExcelFile } from "@/lib/excel-export";
import { exportPdfFile } from "@/lib/pdf-export";
import { getMassKgPerM } from "@/lib/rebar-weights";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import ChatMessage from "./ChatMessage";
import CalculationModePicker from "./CalculationModePicker";
import ValidationResults from "./ValidationResults";
import ElementReviewPanel, { type ReviewAnswer } from "./ElementReviewPanel";
import FinderPassReview, { type FinderCandidate, type ReviewedCandidate } from "./FinderPassReview";
import { type ReviewStatus } from "./DrawingOverlay";
import ScopeDefinitionPanel, { type ScopeData, type DetectionResult, buildScopeFromDetection, SCOPE_ITEMS } from "./ScopeDefinitionPanel";
import { type OverlayElement } from "./DrawingOverlay";
import { useIsMobile } from "@/hooks/use-mobile";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import BarListTable from "./BarListTable";
import BendingScheduleTable from "./BendingScheduleTable";
import ApprovalWorkflow from "./ApprovalWorkflow";

interface MessageFile {
  name: string;
  url: string;
  type: string;
}

interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  metadata?: Record<string, unknown>;
  step?: number;
  created_at: string;
  files?: MessageFile[];
}

interface PreComputedPdfData {
  effectiveImageUrls: string[];
  effectivePreExtracted: any[];
  trimmedOcrResults: any[];
  knowledgeContext: any;
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
  const navigate = useNavigate();
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(true);
  const [uploadedFiles, setUploadedFiles] = useState<string[]>([]);
  const [showModePicker, setShowModePicker] = useState(false);
  const [calculationMode, setCalculationMode] = useState<"smart" | "step-by-step" | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [stagedFiles, setStagedFiles] = useState<File[]>([]);
  const [previewFile, setPreviewFile] = useState<File | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
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
  const [reviewMode, setReviewMode] = useState(false);
  const [reviewStatuses, setReviewStatuses] = useState<Map<string, ReviewStatus>>(new Map());
  const [pdfPageCount, setPdfPageCount] = useState(1);
  const [finderPassCandidates, setFinderPassCandidates] = useState<FinderCandidate[]>([]);
  const [finderReviewMode, setFinderReviewMode] = useState(false);
  const [confirmedFinderCandidates, setConfirmedFinderCandidates] = useState<ReviewedCandidate[]>([]);
  const [importedBarList, setImportedBarList] = useState<any[] | null>(null);
  const [estimationGroupFilter, setEstimationGroupFilter] = useState<"all" | "loose" | "cage">("all");
  const [subStep, setSubStep] = useState<string | null>(null);
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
    setImportedBarList(null);
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
      // P0: Restore validation state + quote result from last assistant message containing ATOMIC_TRUTH markers
      const atomicMsg = [...data].reverse().find((m: any) => m.role === "assistant" && m.content?.includes("%%%ATOMIC_TRUTH_JSON_START%%%"));
      if (atomicMsg) {
        const atomicData = extractAtomicTruthJSON(atomicMsg.content);
        if (atomicData?.elements && atomicData.elements.length > 0) {
          runValidation(atomicData.elements);
          // Restore quote result so Bar List tab persists across reloads
          const syntheticQuote = buildSyntheticQuote(atomicData.elements, atomicData.summary);
          setQuoteResult({ elements: atomicData.elements, summary: atomicData.summary || null, quote: syntheticQuote });
        }
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
            .createSignedUrl(f.file_path, 7200);
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
      .select("*");

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
      .select("*");

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
    async (
      chatMessages: { role: string; content: string }[],
      mode: "smart" | "step-by-step",
      fileUrls: string[],
      opts?: { preComputed?: PreComputedPdfData; scopeOverride?: ScopeData & { focusCategory?: string }; silent?: boolean }
    ) => {
      let effectiveImageUrls: string[];
      let effectivePreExtracted: any[];
      let trimmedOcrResults: any[];
      let knowledgeContext: any;

      if (opts?.preComputed) {
        // Reuse pre-computed PDF extraction data (scope-by-scope loop)
        effectiveImageUrls = opts.preComputed.effectiveImageUrls;
        effectivePreExtracted = opts.preComputed.effectivePreExtracted;
        trimmedOcrResults = opts.preComputed.trimmedOcrResults;
        knowledgeContext = opts.preComputed.knowledgeContext;
      } else {
      // Fetch user knowledge context
      knowledgeContext = await fetchKnowledgeContext();

      // ── Pre-extract PDF text client-side (one at a time to avoid OOM in edge functions) ──
      const pdfUrls: string[] = [];
      const nonPdfUrls: string[] = [];
      for (const url of fileUrls) {
        if (url.toLowerCase().split('?')[0].endsWith('.pdf')) {
          pdfUrls.push(url);
        } else {
          nonPdfUrls.push(url);
        }
      }

      const preExtractedText: any[] = [];
      const scannedPdfPageImageUrls: string[] = [];
      // Vision OCR text collected client-side (one image at a time via ocr-image function)
      const clientOcrResults: { image_name: string; ocr_results: any[] }[] = [];

      if (pdfUrls.length > 0) {
        console.log(`Pre-extracting text from ${pdfUrls.length} PDF(s) sequentially...`);
        for (const pdfUrl of pdfUrls) {
          try {
            console.log(`Extracting text from: ${pdfUrl.substring(0, 60)}...`);
            const { data, error } = await supabase.functions.invoke('extract-pdf-text', {
              body: { pdf_url: pdfUrl },
            });
            if (error) {
              console.error(`PDF text extraction failed for ${pdfUrl}:`, error);
            } else if (data) {
              preExtractedText.push(data);
              console.log(`Extracted ${data.total_pages || 0} pages, has_text_layer: ${data.has_text_layer}, skipped_reason: ${data.skipped_reason || 'none'}`);

              // If PDF is scanned/skipped, render pages to images client-side then OCR each
              const isScanned = data.has_text_layer === false || data.skipped_reason;
              if (isScanned) {
                console.log(`[OCR Routing] PDF is scanned/skipped. Rendering pages to images client-side...`);
                try {
                  // Refresh session before long-running client-side rendering to prevent JWT expiry
                  await supabase.auth.refreshSession();
                  const pageImages = await renderPdfPagesToImages(pdfUrl, projectId, {
                    maxPages: 10,
                    scale: 1.5,
                    onProgress: (current, total) => {
                      console.log(`[OCR Routing] Rendering page ${current}/${total}...`);
                    },
                  });
                  console.log(`[OCR Routing] ${pageImages.length} page images uploaded. Running Vision OCR on each...`);
                  
                   // OCR each page image in parallel batches of 4
                   let ocrFailCount = 0;
                   const OCR_BATCH_SIZE = 4;
                   for (let i = 0; i < pageImages.length; i += OCR_BATCH_SIZE) {
                     const batch = pageImages.slice(i, i + OCR_BATCH_SIZE);
                     const batchResults = await Promise.allSettled(
                       batch.map(async (img) => {
                         scannedPdfPageImageUrls.push(img.signedUrl);
                         console.log(`[OCR Routing] OCR page ${img.pageNumber}...`);
                         const { data: ocrData, error: ocrErr } = await supabase.functions.invoke('ocr-image', {
                           body: { image_url: img.signedUrl },
                         });
                         if (ocrErr) throw ocrErr;
                         return { pageNumber: img.pageNumber, ocrData };
                       })
                     );
                     for (const result of batchResults) {
                       if (result.status === 'fulfilled' && result.value.ocrData?.ocr_results) {
                         clientOcrResults.push({
                           image_name: `page_${result.value.pageNumber}.png`,
                           ocr_results: result.value.ocrData.ocr_results,
                         });
                         console.log(`[OCR Routing] OCR page ${result.value.pageNumber} done — ${result.value.ocrData.ocr_results.reduce((s: number, r: any) => s + (r.blocks?.length || 0), 0)} blocks`);
                       } else {
                         console.error(`[OCR Routing] OCR failed for batch page:`, result.status === 'rejected' ? result.reason : 'no results');
                         ocrFailCount++;
                       }
                     }
                   }
                  // P1: Warn if >50% OCR pages failed
                  if (pageImages.length > 0 && ocrFailCount / pageImages.length > 0.5) {
                    toast.warning(`OCR failed on ${ocrFailCount}/${pageImages.length} pages. Results may be incomplete.`);
                  }
                } catch (renderErr) {
                  console.error(`[OCR Routing] Client-side PDF rendering failed:`, renderErr);
                }
              }
            }
          } catch (err) {
            console.error(`PDF text extraction error:`, err);
          }
        }
      }
      // Trim OCR results to reduce payload size — keep only fullText (skip verbose blocks)
      // Budget: ~300KB for OCR text total, spread across pages
      const MAX_OCR_PAYLOAD_CHARS = 300_000;
      const perPageLimit = clientOcrResults.length > 0
        ? Math.min(4000, Math.floor(MAX_OCR_PAYLOAD_CHARS / clientOcrResults.length))
        : 4000;
      trimmedOcrResults = clientOcrResults.map(item => ({
        image_name: item.image_name,
        ocr_results: item.ocr_results.map((pass: any) => ({
          pass: pass.pass,
          engine: pass.engine,
          preprocess: pass.preprocess,
          fullText: (pass.fullText || "").substring(0, perPageLimit),
        })),
      }));
      console.log(`[Payload] OCR pages: ${clientOcrResults.length}, per-page limit: ${perPageLimit} chars`);

      // Don't send scanned page image URLs if we already have OCR text for them
      effectiveImageUrls = trimmedOcrResults.length > 0 ? nonPdfUrls : [...nonPdfUrls, ...scannedPdfPageImageUrls];

      // When OCR results exist, pre_extracted_text is redundant — drop it to save payload
      effectivePreExtracted = trimmedOcrResults.length > 0 ? [] : preExtractedText;
      } // end of !preComputed block

      // P1: Get user JWT for auth
      const { data: sessionData } = await supabase.auth.getSession();
      const authToken = sessionData?.session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

      // P1: Add timeout via AbortController (5 minutes)
      const controller = new AbortController();
      abortControllerRef.current = controller;
      const timeoutId = setTimeout(() => controller.abort(), 5 * 60 * 1000);

      // Use scopeOverride if provided (scope-by-scope loop), else default
      const effectiveScope = opts?.scopeOverride || scopeDataRef.current;

      const payloadObj = {
          messages: chatMessages,
          mode,
          fileUrls: effectiveImageUrls,
          pre_extracted_text: effectivePreExtracted,
          pre_ocr_results: trimmedOcrResults,
          knowledgeContext,
          scope: effectiveScope,
          primaryCategory: effectiveScope?.primaryCategory,
          features: effectiveScope?.features,
          projectId,
      };
      let payloadStr = JSON.stringify(payloadObj);
      console.log(`[Payload] Total size: ${Math.round(payloadStr.length / 1024)} KB`);

      // If still over 400KB, aggressively trim OCR fullText
      if (payloadStr.length > 400 * 1024 && payloadObj.pre_ocr_results.length > 0) {
        const excess = payloadStr.length - 350 * 1024;
        const charsToTrim = Math.ceil(excess / payloadObj.pre_ocr_results.length);
        for (const item of payloadObj.pre_ocr_results) {
          for (const pass of item.ocr_results) {
            if (pass.fullText.length > 500) {
              pass.fullText = pass.fullText.substring(0, Math.max(500, pass.fullText.length - charsToTrim));
            }
            // Drop blocks array to save space
            delete (pass as any).blocks;
          }
        }
        payloadStr = JSON.stringify(payloadObj);
        console.log(`[Payload] After trim: ${Math.round(payloadStr.length / 1024)} KB`);
      }

      // Final safety valve — hard cap at 480KB
      if (payloadStr.length > 480 * 1024 && payloadObj.pre_ocr_results.length > 0) {
        for (const item of payloadObj.pre_ocr_results) {
          for (const pass of item.ocr_results) {
            if (pass.fullText.length > 300) {
              pass.fullText = pass.fullText.substring(0, 300);
            }
          }
        }
        payloadStr = JSON.stringify(payloadObj);
        console.log(`[Payload] Hard-capped to: ${Math.round(payloadStr.length / 1024)} KB`);
      }

      const resp = await fetch(CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
        },
        body: payloadStr,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

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

      // Show thinking indicator immediately — gateway buffers reasoning tokens
      setMessages((prev) => [
        ...prev,
        {
          id: assistantId,
          role: "assistant" as const,
          content: "🧠 *Analyzing blueprints...*",
          created_at: new Date().toISOString(),
        },
      ]);

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
            const delta = parsed.choices?.[0]?.delta ?? {};
            const content =
              typeof delta.content === "string"
                ? delta.content
                : Array.isArray(delta.content)
                ? delta.content
                    .map((part: any) =>
                      typeof part === "string"
                        ? part
                        : part?.text ?? part?.content ?? ""
                    )
                    .join("")
                : undefined;

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
              
              const displayContent = fullContent
                .replace(/%%%ATOMIC_TRUTH_JSON_START%%%[\s\S]*/g, "")
                .replace(/```json[\s\S]*?```/g, "")
                .replace(/\{[^}]*"(?:Estimation Group|Element Type|element_type|element_id|Rebar Size|bar_lines)"[\s\S]*$/gs, "")
                .trim();

              setMessages((prev) => {
                const last = prev[prev.length - 1];
                if (last?.id === assistantId) {
                  return prev.map((m) => (m.id === assistantId ? { ...m, content: displayContent } : m));
                }
                return [
                  ...prev,
                  {
                    id: assistantId,
                    role: "assistant" as const,
                    content: displayContent,
                    created_at: new Date().toISOString(),
                  },
                ];
              });
            }
          } catch (parseErr) {
            // Only retry if this looks like a partial line (no complete data: prefix)
            // Complete lines that fail JSON parse should be skipped, not block the queue
            if (line.startsWith("data: ") && jsonStr.length > 0) {
              console.warn("[SSE] Skipping malformed SSE line:", jsonStr.substring(0, 100));
          } else {
              // Discard non-data lines that fail parse — don't block the stream
              console.warn("[SSE] Discarding non-data line:", line.substring(0, 80));
            }
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
            const delta = parsed.choices?.[0]?.delta ?? {};
            const content =
              typeof delta.content === "string"
                ? delta.content
                : Array.isArray(delta.content)
                ? delta.content
                    .map((part: any) =>
                      typeof part === "string"
                        ? part
                        : part?.text ?? part?.content ?? ""
                    )
                    .join("")
                : undefined;
            if (content) {
              fullContent += content;
              const flushDisplay = fullContent
                .replace(/%%%ATOMIC_TRUTH_JSON_START%%%[\s\S]*/g, "")
                .replace(/```json[\s\S]*?```/g, "")
                .replace(/\{[^}]*"(?:Estimation Group|Element Type|element_type|element_id|Rebar Size|bar_lines)"[\s\S]*$/gs, "")
                .trim();
              setMessages((prev) =>
                prev.map((m) => (m.id === assistantId ? { ...m, content: flushDisplay } : m))
              );
            }
          } catch {}
        }
      }

      // Mark final step as done
      if (!opts?.silent) onStepChange?.(9);
      
      return { fullContent, preComputed: { effectiveImageUrls, effectivePreExtracted, trimmedOcrResults, knowledgeContext } as PreComputedPdfData };
    },
    [onStepChange, projectId]
  );

  // Fire-and-forget: extract learnings from chat
  const triggerLearning = useCallback((allMessages: { role: string; content: string }[]) => {
    if (!user) return;
    messageCountSinceLastLearn.current++;
    if (messageCountSinceLastLearn.current < 5) return;
    if (allMessages.length < 3) return;
    messageCountSinceLastLearn.current = 0;
    
    supabase.auth.getSession().then(({ data: sess }) => {
      const token = sess?.session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      fetch(LEARN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          messages: allMessages.slice(-10),
          userId: user.id,
        }),
      }).catch(() => {});
    });
  }, [user]);

  // ── Atomic Truth Pipeline helpers ──
  const extractAtomicTruthJSON = (content: string): any | null => {
    const startMarker = "%%%ATOMIC_TRUTH_JSON_START%%%";
    const endMarker = "%%%ATOMIC_TRUTH_JSON_END%%%";
    let startIdx = content.indexOf(startMarker);
    let endIdx = content.indexOf(endMarker);
    // Fallback: strip markdown code fences and retry
    if (startIdx === -1 || endIdx === -1) {
      const stripped = content.replace(/```(?:json)?\s*/g, "").replace(/```/g, "");
      startIdx = stripped.indexOf(startMarker);
      endIdx = stripped.indexOf(endMarker);
      if (startIdx !== -1 && endIdx !== -1) {
        const jsonStr = stripped.substring(startIdx + startMarker.length, endIdx).trim();
        try { return JSON.parse(jsonStr); } catch { /* fall through */ }
      }
      console.warn("[extractAtomicTruthJSON] Markers not found. First 500 chars:", content.substring(0, 500));
      return null;
    }
    const jsonStr = content.substring(startIdx + startMarker.length, endIdx).trim();
    try {
      return JSON.parse(jsonStr);
    } catch {
      console.error("Failed to parse Atomic Truth JSON");
      return null;
    }
  };

  // ── Finder Pass parser ──
  const extractFinderPassCandidates = (content: string): FinderCandidate[] => {
    // Look for markdown table with columns: Page | Type | OCR Text | Potential For | Bbox
    const tableRegex = /\|.*Page.*\|.*Type.*\|.*OCR.*\|.*Potential.*\|.*Bbox.*\|\n\|[-\s|]+\|\n((?:\|.*\|\n?)*)/gi;
    const match = tableRegex.exec(content);
    if (!match) return [];

    const rows = match[1].trim().split("\n").filter((r) => r.trim());
    const candidates: FinderCandidate[] = [];

    for (const row of rows) {
      const cells = row.split("|").map((c) => c.trim()).filter(Boolean);
      if (cells.length < 5) continue;

      const page = parseInt(cells[0]) || 1;
      const type = cells[1];
      const ocrText = cells[2];
      const potentialFor = cells[3];
      // Parse bbox like [x1, y1, x2, y2]
      const bboxMatch = cells[4].match(/\[?\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\]?/);
      if (!bboxMatch) continue;

      const bbox: [number, number, number, number] = [
        parseInt(bboxMatch[1]),
        parseInt(bboxMatch[2]),
        parseInt(bboxMatch[3]),
        parseInt(bboxMatch[4]),
      ];

      candidates.push({
        id: `finder-${candidates.length}-${page}`,
        page,
        type,
        ocrText,
        potentialFor,
        bbox,
      });
    }

    return candidates;
  };

  const runValidation = async (elements: any[], answers?: any[]) => {
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const resp = await fetch(VALIDATE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
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

      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const resp = await fetch(PRICE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
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

  const buildSyntheticQuote = (elements: any[], summary: any) => {
    const barList = elements.flatMap((e: any) =>
      (e.extraction?.truth?.bar_lines || e.bar_lines || []).map((b: any) => ({
        ...b,
        element_type: e.element_type || e.type || "OTHER",
        element_id: e.element_id || e.id || "",
        sub_element: b.sub_element || e.sub_element || b.description || "",
      }))
    );
    const sizeBreakdownKg: Record<string, number> = {};
    let totalKg = 0;
    for (const b of barList) {
      // Compute weight deterministically: qty × multiplier × length × unit_weight
      const lengthMm = b.length_mm || (b.length_ft ? b.length_ft * 304.8 : 0);
      const mult = b.multiplier || 1;
      const qty = b.qty || 0;
      const totalLenM = (qty * mult * lengthMm) / 1000;
      const massKgM = getMassKgPerM(b.size || "");
      const computedWt = totalLenM * massKgM;
      const wt = (typeof b.weight_kg === "number" && b.weight_kg > 0) ? b.weight_kg : computedWt;
      // Persist computed weight on bar object so exports use it
      b.weight_kg = wt;
      totalKg += wt;
      const sz = b.size || "unknown";
      sizeBreakdownKg[sz] = (sizeBreakdownKg[sz] || 0) + wt;
    }
    return {
      bar_list: barList,
      size_breakdown_kg: sizeBreakdownKg,
      size_breakdown: {},
      total_weight_kg: summary?.total_rebar_weight_kg || totalKg,
      total_weight_lbs: summary?.total_rebar_weight_lbs || totalKg / 0.453592,
      total_weight_tonnes: ((summary?.total_rebar_weight_kg || totalKg) / 1000),
      total_weight_tons: ((summary?.total_rebar_weight_lbs || totalKg / 0.453592) / 2000),
      mesh_details: summary?.mesh_details || [],
      reconciliation: summary?.reconciliation || {},
      risk_flags: summary?.risk_flags || [],
    };
  };

  const processAtomicTruth = async (fullContent: string) => {
    const atomicData = extractAtomicTruthJSON(fullContent);
    if (atomicData?.elements && atomicData.elements.length > 0) {
      // Fast-return: set raw data immediately so UI renders
      setSubStep("parsing");
      setValidationData({ elements: atomicData.elements, summary: atomicData.summary || null, questions: [] });
      // Build synthetic quote so export buttons appear immediately
      const syntheticQuote = buildSyntheticQuote(atomicData.elements, atomicData.summary);
      setQuoteResult({ elements: atomicData.elements, summary: atomicData.summary || null, quote: syntheticQuote });
      // Background: run validation and merge results
      setSubStep("validating");
      runValidation(atomicData.elements).then(() => {
        setSubStep("ready");
        setTimeout(() => setSubStep(null), 2000);
      });
      return true;
    }
    // P0: Fallback — try to extract any JSON array of elements from the response
    const fallbackElements = extractFallbackElements(fullContent);
    if (fallbackElements) {
      setSubStep("parsing");
      setValidationData({ elements: fallbackElements, summary: null, questions: [] });
      const syntheticQuote = buildSyntheticQuote(fallbackElements, null);
      setQuoteResult({ elements: fallbackElements, summary: null, quote: syntheticQuote });
      setSubStep("validating");
      runValidation(fallbackElements).then(() => {
        setSubStep("ready");
        setTimeout(() => setSubStep(null), 2000);
      });
      return true;
    }
    console.warn("[processAtomicTruth] No elements found. First 500 chars:", fullContent.substring(0, 500));
    return false;
  };

  const extractFallbackElements = (content: string): any[] | null => {
    // Try ```json blocks
    try {
      const jsonBlockMatch = content.match(/```json\s*([\s\S]*?)```/);
      if (jsonBlockMatch) {
        const parsed = JSON.parse(jsonBlockMatch[1]);
        const elements = parsed?.elements || (Array.isArray(parsed) ? parsed : null);
        if (elements && elements.length > 0) {
          console.log("[Fallback] Extracted elements from JSON code block:", elements.length);
          return elements;
        }
      }
    } catch { /* */ }
    // Aggressive: find JSON object with "elements" array using bracket counting
    try {
      const elemIdx = content.indexOf('"elements"');
      if (elemIdx !== -1) {
        // Walk backward to find the opening {
        let startIdx = content.lastIndexOf('{', elemIdx);
        if (startIdx !== -1) {
          let depth = 0;
          let endIdx = startIdx;
          for (let i = startIdx; i < content.length; i++) {
            if (content[i] === '{') depth++;
            else if (content[i] === '}') { depth--; if (depth === 0) { endIdx = i + 1; break; } }
          }
          if (depth === 0) {
            const parsed = JSON.parse(content.slice(startIdx, endIdx));
            if (parsed?.elements?.length > 0) {
              console.log("[Fallback-aggressive] Extracted elements:", parsed.elements.length);
              return parsed.elements;
            }
          }
        }
      }
    } catch { /* */ }
    return null;
  };

  // Shared post-stream handler for both modes
  const handlePostStream = async (fullContent: string, chatHistory: { role: string; content: string }[], mode: "smart" | "step-by-step", expectStructuredOutput = true) => {
    // Fire-and-forget: learning extraction + DB save
    triggerLearning([...chatHistory, { role: "assistant", content: fullContent }]);
    supabase.from("messages").insert({
      project_id: projectId,
      user_id: user!.id,
      role: "assistant",
      content: fullContent,
      metadata: { calculationMode: mode },
    }).then(({ error }) => { if (error) console.error("Failed to save assistant message:", error); });

    // Process Atomic Truth pipeline
    const extracted = await processAtomicTruth(fullContent);

    if (!extracted) {
      setSubStep(null);
      const isIntentionalBlock = /BLOCKED|MISSING_DRAWINGS|no.*project.*drawings|cannot.*produce.*quantities|does not contain.*project-specific/i.test(fullContent);
      console.debug("[PostStream] expectStructured:", expectStructuredOutput, "intentionalBlock:", isIntentionalBlock);
      if (expectStructuredOutput && !isIntentionalBlock) {
        const fallbackMsg: Message = {
          id: crypto.randomUUID(),
          role: "system",
          content: "⚠️ Estimation completed but structured output was not returned. Please try again or adjust your scope settings.",
          created_at: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, fallbackMsg]);
      }
    }

    // Check for Finder Pass candidates
    const fpCandidates = extractFinderPassCandidates(fullContent);
    if (fpCandidates.length > 0) {
      setFinderPassCandidates(fpCandidates);
      setFinderReviewMode(true);
      openBlueprintViewer();
    }
  };

  const handleModeSelect = async (mode: "smart" | "step-by-step", fileUrlsOverride?: string[]) => {
    if (!user) return;
    setShowModePicker(false);
    setCalculationMode(mode);
    onModeChange?.(mode);
    onStepChange?.(1);
    setLoading(true);
    setSubStep("parsing");

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
      // Build category-specific initial message
      const primaryCat = scopeData?.primaryCategory;
      const isFocusedProject = primaryCat === "cage_only" || primaryCat === "bar_list_only";

      if (isFocusedProject) {
        // Focused projects: single call (already scoped tightly)
        let initialInstruction = primaryCat === "cage_only"
          ? "Begin cage assembly estimation — focus on verticals, ties, and spirals. This is a cage-only project."
          : "Parse the bar schedule table and calculate weights. This is a bar list project.";
        const chatHistory = [{ role: "user", content: initialInstruction }];
        const result = await streamAIResponse(chatHistory, mode, fileUrlsOverride ?? uploadedFiles);
        await handlePostStream(result.fullContent, chatHistory, mode, mode === "smart");
      } else {
        // ── Scope-by-scope iterative processing ──
        // Group selected scope items by category
        const selectedSet = new Set(scopeData?.scopeItems || []);
        const categoryGroups: Record<string, string[]> = {};
        for (const item of SCOPE_ITEMS) {
          if (selectedSet.has(item.id)) {
            if (!categoryGroups[item.category]) categoryGroups[item.category] = [];
            categoryGroups[item.category].push(item.id);
          }
        }
        const categories = Object.entries(categoryGroups).filter(([, items]) => items.length > 0);

        if (categories.length === 0) {
          // Fallback: no categories, single call
          const chatHistory = [{ role: "user", content: `I've uploaded my blueprint files. Please begin the ${mode === "smart" ? "complete automatic" : "step-by-step"} estimation process.` }];
          const result = await streamAIResponse(chatHistory, mode, fileUrlsOverride ?? uploadedFiles);
          await handlePostStream(result.fullContent, chatHistory, mode, mode === "smart");
        } else {
          let accumulatedContent = "";
          let preComputed: PreComputedPdfData | undefined;
          const allFiles = fileUrlsOverride ?? uploadedFiles;
          const hasCageModule = scopeData?.features?.hasCageAssembly && !isFocusedProject;

          for (let i = 0; i < categories.length; i++) {
            const [catName, catItems] = categories[i];
            const catLabels = catItems.map(id => SCOPE_ITEMS.find(s => s.id === id)?.label || id);

            // Show progress message
            const progressMsg: Message = {
              id: crypto.randomUUID(),
              role: "system",
              content: `📋 **Analyzing: ${catName}** (${i + 1}/${categories.length}) — ${catLabels.join(", ")}`,
              created_at: new Date().toISOString(),
            };
            setMessages(prev => [...prev, progressMsg]);
            setSubStep(`analyzing ${catName.toLowerCase()}`);

            // Build focused instruction
            const focusInstruction = `Analyze ONLY these element types: ${catLabels.join(", ")}. Ignore all other element types for this pass.${hasCageModule && catName === "Assemblies" ? " Process cage assemblies (verticals, ties, spirals)." : ""}`;
            const chatHistory = [{ role: "user", content: focusInstruction }];

            // Build scope override with only this category's items
            const scopeOverride = {
              ...scopeDataRef.current!,
              scopeItems: catItems,
              focusCategory: catName,
            };

            const result = await streamAIResponse(chatHistory, mode, allFiles, {
              preComputed,
              scopeOverride,
              silent: i < categories.length - 1, // Don't mark step 9 until last pass
            });

            // Cache preComputed data from first call for reuse
            if (!preComputed) {
              preComputed = result.preComputed;
            }

            accumulatedContent += "\n\n" + result.fullContent;
          }

          // Final merge of all accumulated content
          const finalChatHistory = [{ role: "user", content: `I've uploaded my blueprint files. Full scope-by-scope estimation complete.` }];
          await handlePostStream(accumulatedContent, finalChatHistory, mode, mode === "smart");
        }
      }
    } catch (err: any) {
      setSubStep(null);
      if (err.name === "AbortError") {
        toast.error("AI analysis timed out after 5 minutes. Please retry.");
      } else {
        toast.error(err.message || "AI analysis failed");
      }
    }

    setSubStep(null);
    setLoading(false);
  };

  const sendMessage = async (overrideText?: string, opts?: { skipAddMessage?: boolean }) => {
    const text = (overrideText ?? input).trim();
    if (!text || !user || loading) return;

    if (!opts?.skipAddMessage) {
      const userMessage: Message = {
        id: crypto.randomUUID(),
        role: "user",
        content: text,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMessage]);
    }
    const msgContent = text;
    setInput("");
    setLoading(true);

    if (textareaRef.current) textareaRef.current.style.height = "auto";

    await supabase.from("messages").insert({
      project_id: projectId,
      user_id: user.id,
      role: "user",
      content: msgContent,
    });

    // If user clicks "Yes, Proceed" and we already have validation data, skip re-analysis and go to pricing
    if (validationData?.elements && /yes.*proceed|proceed.*next/i.test(msgContent)) {
      try {
        const readyCount = validationData.elements.filter((e: any) => e.status === "READY").length;
        if (readyCount > 0) {
          const sysMsg: Message = {
            id: crypto.randomUUID(),
            role: "system",
            content: `✅ Proceeding with **${readyCount}** ready element(s). Skipping ${validationData.elements.length - readyCount} blocked/flagged element(s).`,
            created_at: new Date().toISOString(),
          };
          setMessages((prev) => [...prev, sysMsg]);
          await runPricing(validationData.elements, "ai_express");
        } else {
          toast.error("No elements are ready. Please resolve blocked elements first.");
        }
      } catch (err: any) {
        toast.error(err.message || "Pricing failed");
      }
      setLoading(false);
      return;
    }

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

        const result = await streamAIResponse(chatHistory, calculationMode, uploadedFiles);

        // Only expect structured output for explicit estimation intents
        const estimationIntent = /\b(estimate|analyze|recalculate|rerun|re-run|proceed|start.*estimation|run.*takeoff|calculate|compute)\b/i.test(msgContent);
        console.debug("[SendMessage] intent check:", { msgContent: msgContent.slice(0, 80), estimationIntent });
        await handlePostStream(result.fullContent, chatHistory, calculationMode, estimationIntent);
      } catch (err: any) {
        setSubStep(null);
        if (err.name === "AbortError") {
          toast.error("AI analysis timed out after 5 minutes. Please retry.");
        } else {
          toast.error(err.message || "AI analysis failed");
        }
      }
    }

    setSubStep(null);
    setLoading(false);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, skipStatusMessages = false) => {
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
        .createSignedUrl(filePath, 7200);

      if (signedData?.signedUrl) newUrls.push(signedData.signedUrl);

      if (!skipStatusMessages) {
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

    // Fire-and-forget: populate search index for uploaded PDFs
    if (newUrls.length > 0) {
      (async () => {
        try {
          for (const url of newUrls) {
            if (!url.toLowerCase().split('?')[0].endsWith('.pdf')) continue;
            const { data: extractData, error: extractErr } = await supabase.functions.invoke("extract-pdf-text", {
              body: { pdf_url: url, project_id: projectId },
            });
            if (extractErr || !extractData?.pages) continue;
            await supabase.functions.invoke("populate-search-index", {
              body: { project_id: projectId, pages: extractData.pages },
            });
          }
        } catch (e) {
          console.error("Search index population failed (non-blocking):", e);
        }
      })();
    }

    // Trigger detection and auto-proceed if confidence is high
    if (!calculationMode && (uploadedFiles.length + newUrls.length) > 0) {
      const allUrls = [...uploadedFiles, ...newUrls];
      setIsDetecting(true);
      setShowScopePanel(true); // show as fallback while detecting
      try {
        const detectResp = await fetch(DETECT_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({ fileUrls: allUrls }),
        });
        if (detectResp.ok) {
          const result: DetectionResult = await detectResp.json();
          setDetectionResult(result);

          const confidence = result.confidencePrimary ?? result.confidence ?? 0;
          const AUTO_THRESHOLD = 0.7;

          if (confidence >= AUTO_THRESHOLD) {
            // High confidence: auto-fill scope but let user choose mode
            const autoScope = buildScopeFromDetection(result);
            setScopeData(autoScope);

            // Save scope to project
            if (user) {
              supabase.from("projects").update({
                client_name: autoScope.clientName || null,
                project_type: autoScope.projectType || null,
                scope_items: autoScope.scopeItems,
                deviations: autoScope.deviations || null,
              } as any).eq("id", projectId);
            }

            // Log auto-detection as system message
            const categoryLabel = autoScope.primaryCategory === "cage_only" ? "Cage Only"
              : autoScope.primaryCategory === "bar_list_only" ? "Bar List"
              : autoScope.projectType || "Unknown";
            const autoMsg: Message = {
              id: crypto.randomUUID(),
              role: "system",
              content: `🤖 Auto-detected: **${categoryLabel}** project (${Math.round(confidence * 100)}% confidence). Please select your calculation mode below.`,
              created_at: new Date().toISOString(),
            };
            setMessages((prev) => [...prev, autoMsg]);
            await supabase.from("messages").insert({
              project_id: projectId,
              user_id: user!.id,
              role: "system",
              content: autoMsg.content,
            });
          }
          // Low confidence: fall through to manual scope panel
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

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (const item of Array.from(items)) {
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      setStagedFiles(prev => [...prev, ...files]);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files?.length) {
      setStagedFiles(prev => [...prev, ...Array.from(e.dataTransfer.files)]);
    }
  };

  const removeStagedFile = (index: number) => {
    setStagedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const uploadStagedFiles = async (textInput?: string) => {
    if (stagedFiles.length === 0) return;

    // Capture file metadata for the chat bubble before clearing
    const fileData: MessageFile[] = stagedFiles.map(f => ({
      name: f.name,
      url: URL.createObjectURL(f),
      type: f.type,
    }));

    const text = textInput || stagedFiles.map(f => `📎 ${f.name}`).join(", ");

    // Add user message with file thumbnails
    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      created_at: new Date().toISOString(),
      files: fileData,
    };
    setMessages(prev => [...prev, userMsg]);
    setInput("");

    const dt = new DataTransfer();
    stagedFiles.forEach(f => dt.items.add(f));
    setStagedFiles([]);
    await handleFileUpload({ target: { files: dt.files } } as React.ChangeEvent<HTMLInputElement>, true);

    // Trigger AI analysis if user typed a message
    if (textInput) {
      if (calculationMode) {
        await sendMessage(textInput, { skipAddMessage: true });
      } else if (uploadedFiles.length > 0 || dt.files.length > 0) {
        setShowModePicker(true);
      }
    }
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  };

  // Build overlay elements from validation data
  // Build overlay elements from validation data OR finder pass candidates
  const overlayElements: OverlayElement[] = useMemo(() => {
    // If finder pass review is active, show those candidates as overlays
    if (finderPassCandidates.length > 0 && finderReviewMode) {
      return finderPassCandidates.map((c) => ({
        element_id: c.id,
        element_type: "FINDER_CANDIDATE",
        status: "candidate",
        bbox: c.bbox,
        page_number: c.page,
      }));
    }

    if (!validationData?.elements) return [];

    // Separate elements with and without spatial data
    const withBbox: OverlayElement[] = [];
    const withoutBbox: any[] = [];

    validationData.elements.forEach((el: any) => {
      const bbox = el.regions?.tag_region?.bbox;
      const hasBbox = bbox && (bbox[2] - bbox[0]) > 10 && (bbox[3] - bbox[1]) > 10;
      if (hasBbox) {
        withBbox.push({
          element_id: el.element_id,
          element_type: el.element_type,
          status: el.status,
          bbox: el.regions.tag_region.bbox as [number, number, number, number],
          confidence: el.extraction?.confidence,
          weight_lbs: quoteResult?.quote?.elements?.find((qe: any) => qe.element_id === el.element_id)?.weight_lbs,
          page_number: el.regions?.tag_region?.page_number,
        });
      } else {
        withoutBbox.push(el);
      }
    });

    // Generate synthetic positions for elements without bbox
    if (withoutBbox.length > 0) {
      // Use a reasonable default image size for positioning
      const imgH = 2000;
      let curX = 80;
      let curY = 80;
      const boxSize = 40;
      const gap = 60;

      // Group by type for organized placement
      const grouped: Record<string, any[]> = {};
      withoutBbox.forEach((el) => {
        const t = el.element_type || "OTHER";
        if (!grouped[t]) grouped[t] = [];
        grouped[t].push(el);
      });

      Object.values(grouped).forEach((group) => {
        group.forEach((el) => {
          if (curY + boxSize > imgH - 40) {
            curY = 80;
            curX += 200;
          }
          withBbox.push({
            element_id: el.element_id,
            element_type: el.element_type,
            status: el.status,
            bbox: [curX, curY, curX + boxSize, curY + boxSize] as [number, number, number, number],
            confidence: el.extraction?.confidence,
            weight_lbs: quoteResult?.quote?.elements?.find((qe: any) => qe.element_id === el.element_id)?.weight_lbs,
            page_number: el.regions?.tag_region?.page_number,
          });
          curY += gap;
        });
        curY += 20; // extra gap between type groups
      });
    }

    return withBbox;
  }, [validationData, quoteResult, finderPassCandidates, finderReviewMode]);

  // Show viewer whenever uploaded files exist (supports PDF read-only mode too)
  const hasDrawingData = uploadedFiles.length > 0;

  // Compute effective review statuses (add "active" for selected element during review)
  const effectiveReviewStatuses = useMemo(() => {
    if (!reviewMode) return undefined;
    const statuses = new Map(reviewStatuses);
    if (selectedElementId && !statuses.has(selectedElementId)) {
      statuses.set(selectedElementId, "active");
    }
    return statuses;
  }, [reviewMode, reviewStatuses, selectedElementId]);

  // Navigate to full-screen blueprint viewer page
  const viewerOpenCounter = useRef(0);
  const openBlueprintViewer = useCallback(() => {
    if (!uploadedFiles.length) return;
    viewerOpenCounter.current += 1;
    const reviewStatusObj: Record<string, string> = {};
    if (reviewMode) {
      reviewStatuses.forEach((v, k) => reviewStatusObj[k] = v);
    }
    // Use a microtask to ensure state updates (like setSelectedElementId) are flushed
    setTimeout(() => {
      sessionStorage.setItem("blueprint-viewer-data", JSON.stringify({
        imageUrl: uploadedFiles[0] || "",
        elements: overlayElements,
        selectedElementId,
        reviewStatuses: reviewMode ? reviewStatusObj : null,
      }));
      navigate("/blueprint-viewer");
    }, 0);
  }, [uploadedFiles, overlayElements, selectedElementId, reviewMode, reviewStatuses, navigate]);

  const handleShowOnDrawing = useCallback((elementId: string) => {
    setSelectedElementId(elementId);
    // Store data with the new element selected and navigate
    if (!uploadedFiles.length) return;
    const reviewStatusObj: Record<string, string> = {};
    if (reviewMode) {
      reviewStatuses.forEach((v, k) => reviewStatusObj[k] = v);
    }
    sessionStorage.setItem("blueprint-viewer-data", JSON.stringify({
      imageUrl: uploadedFiles[0] || "",
      elements: overlayElements,
      selectedElementId: elementId,
      reviewStatuses: reviewMode ? reviewStatusObj : null,
    }));
    navigate("/blueprint-viewer");
  }, [uploadedFiles, overlayElements, reviewMode, reviewStatuses, navigate]);

  const handleSelectElementFromViewer = useCallback((id: string | null) => {
    setSelectedElementId(id);
    if (id) {
      // Auto-expand collapsed collapsible groups containing this element
      const card = document.getElementById(`element-card-${id}`);
      
      // Find the parent collapsible and open it if collapsed
      const collapsibleContent = card?.closest('[data-state]');
      if (collapsibleContent?.getAttribute('data-state') === 'closed') {
        // Find the trigger button and click it to expand
        const collapsibleRoot = collapsibleContent?.closest('[data-radix-collapsible]') || collapsibleContent?.parentElement;
        const trigger = collapsibleRoot?.querySelector('[data-radix-collapsible-trigger]') as HTMLElement;
        if (trigger) trigger.click();
      }

      // Scroll to element card with a small delay to allow expansion
      setTimeout(() => {
        const targetCard = document.getElementById(`element-card-${id}`);
        targetCard?.scrollIntoView({ behavior: "smooth", block: "center" });
        // Add highlight animation
        targetCard?.classList.add('ring-2', 'ring-primary', 'ring-offset-2', 'transition-all');
        setTimeout(() => {
          targetCard?.classList.remove('ring-2', 'ring-primary', 'ring-offset-2');
        }, 2000);
      }, 150);
    }
  }, []);

  const chatContent = (
    <div className="flex flex-1 flex-col min-h-0 bg-background/50">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-none px-4 py-6 space-y-1">
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

          {/* Finder Pass Review */}
          {finderReviewMode && finderPassCandidates.length > 0 && (
            <div className="py-2">
              <FinderPassReview
                candidates={finderPassCandidates}
                onComplete={(reviewed) => {
                  setFinderReviewMode(false);
                  setConfirmedFinderCandidates(reviewed);
                  const confirmed = reviewed.filter((r) => r.status !== "rejected");
                  const rejected = reviewed.filter((r) => r.status === "rejected");
                  toast.success(`Finder Pass review complete! ${confirmed.length} confirmed, ${rejected.length} rejected.`);
                }}
                onCancel={() => {
                  setFinderReviewMode(false);
                  setFinderPassCandidates([]);
                }}
                onSelectElement={(id) => {
                  setSelectedElementId(id);
                  if (!showBlueprintViewer) openBlueprintViewer();
                }}
              />
            </div>
          )}

          {/* Review Mode or Validation Results */}
          {validationData && reviewMode ? (
            <div className="py-2">
              <ElementReviewPanel
                elements={validationData.elements}
                onComplete={async (answers) => {
                  setReviewMode(false);
                  setReviewStatuses(new Map());
                  const newAnswers = answers
                    .filter((a) => a.correctedValue)
                    .map((a) => ({ element_id: a.element_id, field: a.field || "truth", value: a.correctedValue! }));
                  if (newAnswers.length > 0) {
                    setUserAnswers((prev) => [...prev, ...newAnswers]);
                    await runValidation(validationData.elements, [...userAnswers, ...newAnswers]);
                    toast.success(`Review complete! ${newAnswers.length} correction(s) applied.`);
                  } else {
                    toast.success("Review complete! All elements confirmed.");
                  }
                }}
                onCancel={() => {
                  setReviewMode(false);
                  setReviewStatuses(new Map());
                }}
                onSelectElement={(id) => {
                  setSelectedElementId(id);
                  if (!showBlueprintViewer) openBlueprintViewer();
                }}
                onAnswersChange={(answersMap) => {
                  // Build review statuses from answers + mark current as active
                  const statuses = new Map<string, ReviewStatus>();
                  for (const [elId, answer] of answersMap) {
                    statuses.set(elId, answer.confirmed ? "confirmed" : "rejected");
                  }
                  // The active element is handled by selectedElementId matching
                  // We set all non-answered as pending implicitly
                  setReviewStatuses(statuses);
                }}
              />
            </div>
          ) : (validationData || importedBarList) ? (() => {
            // Compute estimation group flags
            const elements = validationData?.elements || [];
            const hasLoose = elements.some((e: any) => !e.estimation_group || e.estimation_group === "LOOSE_REBAR");
            const hasCage = elements.some((e: any) => e.estimation_group === "CAGE_ASSEMBLY");
            const hasBothGroups = hasLoose && hasCage;

            // Filter elements by active group
            const filteredElements = estimationGroupFilter === "all"
              ? elements
              : elements.filter((e: any) =>
                  estimationGroupFilter === "cage"
                    ? e.estimation_group === "CAGE_ASSEMBLY"
                    : !e.estimation_group || e.estimation_group === "LOOSE_REBAR"
                );

            // Filter bar list by group
            const rawBarList = quoteResult?.quote?.bar_list || importedBarList || [];
            const filteredBarList = estimationGroupFilter === "all"
              ? rawBarList
              : rawBarList.filter((b: any) =>
                  estimationGroupFilter === "cage"
                    ? b.estimation_group === "CAGE_ASSEMBLY"
                    : !b.estimation_group || b.estimation_group === "LOOSE_REBAR"
                );

            // Recompute summary from filtered elements
            const filteredSummary = validationData?.summary
              ? {
                  ...validationData.summary,
                  total_elements: filteredElements.length,
                  total_weight_kg: filteredElements.reduce((sum: number, e: any) => sum + (e.weight_kg || 0), 0),
                }
              : null;

            const isCageOrBarListOnly = scopeData?.primaryCategory === "cage_only" || scopeData?.primaryCategory === "bar_list_only";
            const showCardsTab = !isCageOrBarListOnly && filteredElements.some((e: any) => !e.estimation_group || e.estimation_group === "LOOSE_REBAR");
            const showBarListTab = filteredBarList.length > 0;
            const showBendingTab = filteredBarList.some((b: any) => b.shape_code && b.shape_code !== "straight" && b.shape_code !== "closed");

            const defaultTab = isCageOrBarListOnly ? "barlist" : (showCardsTab ? "cards" : "barlist");

            return (
              <div className="py-2">
                {/* Estimation group filter chips */}
                {hasBothGroups && (
                  <div className="flex gap-2 mb-3">
                    {(["all", "loose", "cage"] as const).map((group) => (
                      <button
                        key={group}
                        onClick={() => setEstimationGroupFilter(group)}
                        className={`px-3 py-1 text-xs font-medium rounded-full border transition-colors ${
                          estimationGroupFilter === group
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-muted text-muted-foreground border-border hover:bg-accent"
                        }`}
                      >
                        {group === "all" ? "All" : group === "loose" ? "Loose Rebar" : "Cage Assembly"}
                      </button>
                    ))}
                  </div>
                )}

                <Tabs defaultValue={defaultTab} className="w-full">
                  <TabsList className="w-full mb-3 h-9 rounded-xl bg-muted p-1">
                    {showCardsTab && (
                      <TabsTrigger value="cards" className="flex-1 text-xs rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm">
                        Cards
                      </TabsTrigger>
                    )}
                    {showBarListTab && (
                      <TabsTrigger value="barlist" className="flex-1 text-xs rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm">
                        Bar List
                      </TabsTrigger>
                    )}
                    {showBendingTab && (
                      <TabsTrigger value="bending" className="flex-1 text-xs rounded-lg data-[state=active]:bg-card data-[state=active]:shadow-sm">
                        Bending
                      </TabsTrigger>
                    )}
                  </TabsList>
                  {showCardsTab && validationData && (
                    <TabsContent value="cards">
                      <ValidationResults
                        elements={filteredElements}
                        summary={filteredSummary}
                        questions={validationData.questions || []}
                        quoteResult={quoteResult}
                        onAnswerQuestion={handleAnswerQuestion}
                        onRequestQuote={handleRequestQuote}
                        scopeData={scopeData}
                        onShowOnDrawing={handleShowOnDrawing}
                        onToggleViewer={() => openBlueprintViewer()}
                        showViewer={showBlueprintViewer}
                        selectedElementId={selectedElementId}
                        hasDrawingData={hasDrawingData}
                        onStartReview={() => {
                          setReviewMode(true);
                          openBlueprintViewer();
                        }}
                      />
                    </TabsContent>
                  )}
                  {showBarListTab && (
                    <TabsContent value="barlist">
                      <BarListTable
                        barList={filteredBarList}
                        onShowOnDrawing={handleShowOnDrawing}
                        selectedElementId={selectedElementId}
                        onImport={(data) => setImportedBarList(data)}
                      />
                    </TabsContent>
                  )}
                  {showBendingTab && (
                    <TabsContent value="bending">
                      <BendingScheduleTable
                        barList={filteredBarList}
                        onShowOnDrawing={handleShowOnDrawing}
                        selectedElementId={selectedElementId}
                      />
                    </TabsContent>
                  )}
                </Tabs>

                {/* Quote Result - Always visible after tabs */}
                {quoteResult && quoteResult.quote && (
                  <div className="p-5 rounded-xl border-2 border-primary bg-primary/5">
                    <div className="flex items-center gap-2 mb-4">
                      {quoteResult.mode === "ai_express" ? <Zap className="h-5 w-5 text-primary" /> : <FileCheck className="h-5 w-5 text-primary" />}
                      <span className="text-sm font-bold text-foreground">{quoteResult.mode === "ai_express" ? "AI Express" : "Verified"} Quote</span>
                    </div>
                    {(() => {
                      const q = quoteResult.quote;
                      const totalLbs = q.total_weight_lbs || 0;
                      const totalKg = q.total_weight_kg || (totalLbs * 0.453592);
                      const totalTonnes = q.total_weight_tonnes ?? q.total_tonnes ?? (totalKg > 0 ? totalKg / 1000 : 0);
                      const totalTons = q.total_weight_tons ?? (totalLbs > 0 ? totalLbs / 2000 : 0);
                      const showKg = totalKg > 0;
                      return (
                        <>
                          <div className="grid grid-cols-2 gap-4 text-center">
                            <div className="rounded-xl bg-card border border-border p-4">
                              <p className="text-2xl font-bold text-primary">
                                {showKg
                                  ? `${totalKg.toLocaleString(undefined, {maximumFractionDigits: 1})} kg`
                                  : `${totalLbs.toLocaleString(undefined, {maximumFractionDigits: 1})} lbs`}
                              </p>
                              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mt-1">Total Weight</p>
                            </div>
                            <div className="rounded-xl bg-card border border-border p-4">
                              <p className="text-2xl font-bold text-primary">
                                {showKg
                                  ? `${totalTonnes.toLocaleString(undefined, {maximumFractionDigits: 2})} tonnes`
                                  : `${totalTons.toLocaleString(undefined, {maximumFractionDigits: 2})} tons`}
                              </p>
                              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mt-1">Total Tonnes</p>
                            </div>
                          </div>
                          {showKg && totalLbs > 0 && (
                            <div className="grid grid-cols-2 gap-4 text-center mt-2">
                              <div className="rounded-lg bg-accent/30 border border-border p-2">
                                <p className="text-sm font-semibold text-muted-foreground">{totalLbs.toLocaleString()} lbs</p>
                              </div>
                              <div className="rounded-lg bg-accent/30 border border-border p-2">
                                <p className="text-sm font-semibold text-muted-foreground">{totalTons.toLocaleString(undefined, {maximumFractionDigits: 2})} tons</p>
                              </div>
                            </div>
                          )}
                        </>
                      );
                    })()}
                    <SizeBreakdownTable sizeBreakdown={quoteResult.quote.size_breakdown} sizeBreakdownKg={quoteResult.quote.size_breakdown_kg} />
                    {quoteResult.excluded && quoteResult.excluded.length > 0 && (
                      <div className="mt-3 text-xs text-muted-foreground">
                        <p className="font-semibold">Excluded ({quoteResult.excluded_count}):</p>
                        {quoteResult.excluded.map((ex: any, i: number) => <p key={i}>• {ex.element_id}: {ex.reason}</p>)}
                      </div>
                    )}
                    <ExportButtons quoteResult={quoteResult} elements={validationData?.elements || []} scopeData={scopeData} />
                  </div>
                )}

                {/* Approval Workflow - shown when quote result exists */}
                {quoteResult && (
                  <ApprovalWorkflow
                    projectId={projectId}
                    quoteResult={quoteResult}
                    elements={validationData?.elements || []}
                    scopeData={scopeData}
                  />
                )}
              </div>
            );
          })() : null}

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

          {/* Sub-step progress indicator */}
          {subStep && (
            <div className="py-2 px-1">
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                {["parsing", "validating", "ready"].map((step, i) => {
                  const isDone = step === "ready" ? subStep === "ready" : (["parsing", "validating", "ready"].indexOf(subStep) > i);
                  const isActive = subStep === step;
                  return (
                    <span key={step} className={`flex items-center gap-1 ${isActive ? "text-primary font-medium" : isDone ? "text-primary/70" : "text-muted-foreground/50"}`}>
                      {isDone ? <CheckCircle className="h-3 w-3" /> : isActive ? <Loader2 className="h-3 w-3 animate-spin" /> : <span className="h-3 w-3 rounded-full border border-current inline-block" />}
                      {step === "parsing" ? "Parsing" : step === "validating" ? "Validating" : "Ready"}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input Bar */}
      <div className="border-t border-border bg-background/80 backdrop-blur-sm p-2 sm:p-3">
        <div className="mx-auto max-w-none">
          {/* Suggestion Idea Cards */}
          {!input.trim() && !loading && (
            <div className="flex gap-2 overflow-x-auto pb-2 mb-1 scrollbar-none">
              {(() => {
                const lastMsg = messages.filter(m => m.role === 'assistant').slice(-1)[0];
                const hasConfirmQuestion = lastMsg?.content?.match(/do you agree|confirm|proceed\?|is this correct/i);

                type IdeaCard = { icon: string; title: string; description: string; sendText: string; autoSend?: boolean; action?: 'upload' | 'exportPdf' | 'exportExcel' };

                let cards: IdeaCard[] = [];

                if (hasConfirmQuestion) {
                  cards = [
                    { icon: 'CheckCircle', title: 'Yes, Proceed', description: 'Continue to next step', sendText: 'Yes, proceed to next stage', autoSend: true },
                    { icon: 'SlidersHorizontal', title: 'Adjust Scope', description: 'Change element types', sendText: 'I need to adjust the scope', autoSend: true },
                    { icon: 'Plus', title: 'Add More', description: 'Include more elements', sendText: 'Add more element types', autoSend: true },
                    ...(quoteResult?.quote ? [
                      { icon: 'FileText', title: 'Download PDF', description: 'Export PDF report', sendText: '', action: 'exportPdf' as const },
                      { icon: 'FileSpreadsheet', title: 'Download Excel', description: 'Export spreadsheet', sendText: '', action: 'exportExcel' as const },
                    ] : []),
                  ];
                } else if (validationData || quoteResult) {
                  cards = [
                    { icon: 'Table', title: 'Bar List', description: 'View full rebar table', sendText: 'Show me the bar list' },
                    ...(quoteResult?.quote ? [
                      { icon: 'FileText', title: 'Download PDF', description: 'Export PDF report', sendText: '', action: 'exportPdf' as const },
                      { icon: 'FileSpreadsheet', title: 'Download Excel', description: 'Export spreadsheet', sendText: '', action: 'exportExcel' as const },
                    ] : []),
                    { icon: 'AlertTriangle', title: 'Review Flags', description: 'Check flagged items', sendText: 'Review flagged elements' },
                    { icon: 'RefreshCw', title: 'Recalculate', description: 'Update with your edits', sendText: 'Recalculate with edits' },
                  ];
                } else if (uploadedFiles.length > 0 && !calculationMode) {
                  cards = [
                    { icon: 'Zap', title: 'Smart Analysis', description: 'Auto-detect and estimate', sendText: 'Start step-by-step analysis', autoSend: true },
                    { icon: 'ListChecks', title: 'Step-by-Step', description: 'Review each element', sendText: 'What elements can you detect?' },
                    { icon: 'HelpCircle', title: "What's Detected?", description: 'Preview element types', sendText: 'Explain the estimation process' },
                  ];
                } else if (uploadedFiles.length === 0) {
                  cards = [
                    { icon: 'Upload', title: 'Upload PDF', description: 'Drop your blueprint here', sendText: '', action: 'upload' },
                    { icon: 'FileQuestion', title: 'File Types', description: 'See supported formats', sendText: 'What file types are supported?' },
                    { icon: 'Sparkles', title: 'How It Works', description: 'Learn about AI detection', sendText: 'How does the AI detection work?' },
                  ];
                }

                const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
                  CheckCircle, SlidersHorizontal, Plus, Table, Download,
                  AlertTriangle, RefreshCw, Zap, ListChecks, HelpCircle,
                  Upload, FileQuestion, Sparkles, FileText, FileSpreadsheet,
                };

                return cards.map((card) => {
                  const IconComp = iconMap[card.icon];
                  return (
                    <button
                      key={card.title}
                      onClick={async () => {
                        if (card.action === 'upload') {
                          fileInputRef.current?.click();
                        } else if (card.action === 'exportExcel') {
                          if (!quoteResult?.quote) {
                            toast.error("Complete estimation first to export");
                            return;
                          }
                          await exportExcelFile({ quoteResult, elements: validationData?.elements || [], scopeData });
                          toast.success("Excel exported");
                        } else if (card.action === 'exportPdf') {
                          if (!quoteResult?.quote) {
                            toast.error("Complete estimation first to export");
                            return;
                          }
                          await exportPdfFile({ quoteResult, elements: validationData?.elements || [], scopeData, projectId });
                          toast.success("PDF exported");
                        } else if (card.sendText) {
                          sendMessage(card.sendText);
                        }
                      }}
                      className="flex-shrink-0 flex flex-col items-start gap-1 rounded-xl border border-border p-3 min-w-[110px] sm:min-w-[130px] max-w-[140px] sm:max-w-[160px] text-left hover:border-primary/50 hover:bg-primary/5 transition-colors group"
                    >
                      {IconComp && <IconComp className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />}
                      <span className="text-xs font-semibold text-foreground">{card.title}</span>
                      <span className="text-[10px] text-muted-foreground leading-tight">{card.description}</span>
                    </button>
                  );
                });
              })()}
            </div>
          )}
          {stagedFiles.length > 0 && (
            <div className="flex flex-wrap gap-2 rounded-xl border border-border bg-muted/30 p-2">
              {stagedFiles.map((file, i) => (
                <div key={i} className="relative group flex items-center gap-1.5 rounded-lg bg-background border border-border px-2 py-1.5 text-xs cursor-pointer hover:ring-1 hover:ring-primary/40 transition-all" onClick={() => setPreviewFile(file)}>
                  {file.type.startsWith("image/") ? (
                    <img src={URL.createObjectURL(file)} alt={file.name} className="h-10 w-10 rounded object-cover flex-shrink-0" />
                  ) : (
                    <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  )}
                  <span className="truncate max-w-[120px] text-foreground">{file.name}</span>
                  <button onClick={(e) => { e.stopPropagation(); removeStagedFile(i); }} className="ml-1 text-muted-foreground hover:text-destructive">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <Dialog open={!!previewFile} onOpenChange={(open) => !open && setPreviewFile(null)}>
            <DialogContent className="max-w-[90vw] max-h-[90vh] p-2 sm:p-4">
              {previewFile && previewFile.type.startsWith("image/") ? (
                <img src={URL.createObjectURL(previewFile)} alt={previewFile.name} className="max-h-[80vh] w-auto mx-auto rounded object-contain" />
              ) : previewFile ? (
                <div className="flex flex-col items-center gap-3 py-10">
                  <FileText className="h-12 w-12 text-muted-foreground" />
                  <p className="text-sm font-medium text-foreground">{previewFile.name}</p>
                  <p className="text-xs text-muted-foreground">{(previewFile.size / 1024).toFixed(1)} KB</p>
                </div>
              ) : null}
            </DialogContent>
          </Dialog>
          <div
            className={`relative flex items-end gap-2 rounded-2xl border bg-chat-input p-2 shadow-sm transition-colors ${isDragging ? "border-primary ring-2 ring-primary/30" : "border-border"}`}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragEnter={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
          >
            {isDragging && (
              <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-primary/10 backdrop-blur-[2px]">
                <div className="flex items-center gap-2 text-sm font-medium text-primary">
                  <Upload className="h-4 w-4" />
                  Drop files here
                </div>
              </div>
            )}
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
              onPaste={handlePaste}
              placeholder="Message Rebar Estimator..."
              rows={1}
              className="flex-1 resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none min-h-[36px] max-h-[200px] py-2"
            />
            {loading ? (
              <Button
                onClick={() => {
                  abortControllerRef.current?.abort();
                  setLoading(false);
                  setSubStep(null);
                }}
                size="icon"
                variant="destructive"
                className="h-9 w-9 flex-shrink-0 rounded-xl"
                title="Stop generation"
              >
                <Square className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                onClick={() => {
                  if (stagedFiles.length > 0) uploadStagedFiles(input.trim());
                  else sendMessage();
                }}
                disabled={!input.trim() && !showModePicker && stagedFiles.length === 0}
                size="icon"
                className="h-9 w-9 flex-shrink-0 rounded-xl"
              >
                <Send className="h-4 w-4" />
              </Button>
            )}
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

  return chatContent;
};

export default ChatArea;
