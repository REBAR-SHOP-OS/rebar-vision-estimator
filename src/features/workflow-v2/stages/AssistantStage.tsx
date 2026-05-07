/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { AlertTriangle, Bot, CheckCircle2, FileText, Loader2, Paperclip, RefreshCw, Send, Sparkles, Square, Upload, User, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  createProjectFileWithCanonicalBridge,
  ensureCurrentProjectRebarBridge,
  inferRebarFileKind,
} from "@/lib/rebar-intake";
import { loadWorkflowQaIssues, loadWorkflowTakeoffRows } from "../takeoff-data";
import { StageHeader, EmptyState, Pill, type StageProps } from "./_shared";
import {
  applyAssistantSuggestion,
  buildAssistantSuggestion,
  buildFinishEstimationAgentResponse,
  buildNextEstimationAgentResponse,
  buildWorkingSteps,
  isAssistantConfirmationIntent,
  isFinishAuditIntent,
  parseAssistantAnswerValues,
  type AssistantMessageMetadata,
  type AssistantSuggestion,
} from "./assistant-logic";
import type { ExtractionAuditResult, ExtractionAuditStatus } from "../accuracy-audit";

type AssistantMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
  metadata?: AssistantMessageMetadata | null;
};

type StagedUpload = {
  file: File;
  previewUrl?: string;
};

const CHANNEL = "workflow_v2_assistant";

async function loadExtractionAudit(projectId: string): Promise<ExtractionAuditResult | null> {
  const { data, error } = await supabase
    .from("document_versions")
    .select("pdf_metadata,page_count,parse_status")
    .eq("project_id", projectId);
  if (error) {
    console.warn("Failed to load extraction audit:", error);
    return null;
  }

  const audits = ((data || []) as any[])
    .map((row) => row.pdf_metadata?.extraction_audit)
    .filter(Boolean) as ExtractionAuditResult[];
  if (audits.length === 0) return null;

  const statusRank: Record<ExtractionAuditStatus, number> = {
    ready: 0,
    needs_engineer_review: 1,
    needs_ocr_rerun: 2,
  };
  const status = audits.reduce<ExtractionAuditStatus>(
    (worst, audit) => statusRank[audit.status] > statusRank[worst] ? audit.status : worst,
    "ready",
  );
  const flags = Array.from(new Set(audits.flatMap((audit) => audit.flags || [])));
  const indexedPages = audits.reduce((sum, audit) => sum + Number(audit.indexedPages || 0), 0);
  const pageCount = audits.reduce((sum, audit) => sum + Number(audit.pageCount || audit.indexedPages || 0), 0);
  const sparsePages = audits.reduce((sum, audit) => sum + Number(audit.sparsePages || 0), 0);
  const score = audits.length
    ? Math.min(...audits.map((audit) => Number(audit.score || 0)))
    : 0;

  return { status, score, flags, indexedPages, pageCount, sparsePages };
}

export default function AssistantStage({ projectId, state, goToStage }: StageProps) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(true);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [workingSteps, setWorkingSteps] = useState<string[]>([]);
  const [staged, setStaged] = useState<StagedUpload[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [latestSuggestion, setLatestSuggestion] = useState<AssistantSuggestion | null>(null);
  const [uploadLabel, setUploadLabel] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const stagedRef = useRef<StagedUpload[]>([]);

  const assistantMessages = useMemo(
    () => messages.filter((message) => message.metadata?.channel === CHANNEL || message.role === "user"),
    [messages],
  );

  const loadMessages = useCallback(async () => {
    setLoadingMessages(true);
    const { data, error } = await supabase
      .from("messages")
      .select("id,role,content,created_at,metadata")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true })
      .limit(200);
    if (error) {
      console.warn("Failed to load assistant messages:", error);
      toast.error("Assistant chat history could not be loaded.");
    } else {
      const rows = ((data || []) as any[])
        .filter((row) => row.metadata?.channel === CHANNEL)
        .map((row) => ({
          id: row.id,
          role: (row.role === "user" ? "user" : row.role === "system" ? "system" : "assistant") as AssistantMessage["role"],
          content: row.content,
          created_at: row.created_at,
          metadata: row.metadata || null,
        }));
      setMessages(rows);
      const lastSuggestion = [...rows].reverse().find((row) => row.metadata?.suggestion)?.metadata?.suggestion || null;
      setLatestSuggestion(lastSuggestion);
    }
    setLoadingMessages(false);
  }, [projectId]);

  useEffect(() => { loadMessages(); }, [loadMessages]);
  useEffect(() => {
    if (typeof bottomRef.current?.scrollIntoView === "function") {
      bottomRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [assistantMessages, workingSteps]);
  useEffect(() => { stagedRef.current = staged; }, [staged]);
  useEffect(() => () => stagedRef.current.forEach((item) => item.previewUrl && URL.revokeObjectURL(item.previewUrl)), []);

  const insertMessage = useCallback(async (
    role: AssistantMessage["role"],
    content: string,
    metadata: Partial<AssistantMessageMetadata> = {},
  ) => {
    if (!user) throw new Error("Sign in before using the assistant.");
    const local: AssistantMessage = {
      id: crypto.randomUUID(),
      role,
      content,
      created_at: new Date().toISOString(),
      metadata: { channel: CHANNEL, kind: "progress", ...metadata } as AssistantMessageMetadata,
    };
    setMessages((current) => [...current, local]);
    const { error } = await supabase.from("messages").insert({
      project_id: projectId,
      user_id: user.id,
      role,
      content,
      metadata: local.metadata as any,
    });
    if (error) console.warn("Assistant message persistence failed:", error);
    return local;
  }, [projectId, user]);

  const loadSnapshot = useCallback(async () => {
    const [qaIssues, takeoffRows, extractionAudit] = await Promise.all([
      loadWorkflowQaIssues(projectId),
      loadWorkflowTakeoffRows(projectId, state.files),
      loadExtractionAudit(projectId),
    ]);
    return {
      files: state.files,
      qaIssues,
      takeoffRows,
      extractionAudit,
      estimatorConfirmed: Boolean((state as any).estimatorConfirmed),
    };
  }, [projectId, state]);

  const uploadStagedFiles = useCallback(async () => {
    if (!user || staged.length === 0) return [];
    setUploadLabel(`Uploading ${staged.length} file${staged.length === 1 ? "" : "s"}`);
    await ensureCurrentProjectRebarBridge(supabase, projectId);
    const attachments: NonNullable<AssistantMessageMetadata["attachments"]> = [];
    for (const item of staged) {
      const file = item.file;
      const path = `${user.id}/${projectId}/${Date.now()}_${file.name}`;
      const { error: uploadError } = await supabase.storage.from("blueprints").upload(path, file, { upsert: true });
      if (uploadError) throw uploadError;
      await createProjectFileWithCanonicalBridge(supabase, {
        projectId,
        userId: user.id,
        fileName: file.name,
        filePath: path,
        fileType: file.type || null,
        fileSize: file.size,
        fileKind: inferRebarFileKind(file.name, file.type || null),
      });
      attachments.push({ name: file.name, type: file.type || "application/octet-stream", file_path: path });
    }
    setUploadLabel(null);
    staged.forEach((item) => item.previewUrl && URL.revokeObjectURL(item.previewUrl));
    setStaged([]);
    state.refresh();
    return attachments;
  }, [projectId, staged, state, user]);

  const respondWithSuggestion = useCallback(async (prompt: string) => {
    const snapshot = await loadSnapshot();
    const steps = buildWorkingSteps(snapshot);
    setWorkingSteps(steps);
    if (isFinishAuditIntent(prompt)) {
      const agentResult = buildFinishEstimationAgentResponse(snapshot);
      setLatestSuggestion(agentResult.suggestion);
      await insertMessage("assistant", agentResult.content, {
        kind: "audit",
        confidence: agentResult.confidence,
        working_steps: agentResult.workingSteps,
        suggestion: agentResult.suggestion,
        linked_issue_id: agentResult.suggestion?.issueId || null,
        linked_estimate_item_id: agentResult.suggestion?.linkedEstimateItemId || null,
      });
      return;
    }
    const suggestion = buildAssistantSuggestion(prompt, snapshot);
    if (!suggestion) {
      setLatestSuggestion(null);
      await insertMessage(
        "assistant",
        "I checked the project and there are no open QA issues to answer right now. If you upload another drawing or re-run takeoff, I can inspect the new blockers here.",
        { kind: "question", working_steps: steps },
      );
      return;
    }
    setLatestSuggestion(suggestion);
    const content = [
      `**Found Answer / Confirmation Needed**`,
      "",
      suggestion.answerText,
      "",
      `**Question:** ${suggestion.question}`,
      "",
      suggestion.linkedTakeoffMark ? `Linked row: ${suggestion.linkedTakeoffMark}` : null,
      `Evidence quality: ${suggestion.confidence}`,
      "Reply with the corrected answer, or say **apply** to save this suggestion.",
    ].filter(Boolean).join("\n");
    await insertMessage("assistant", content, {
      kind: "suggestion",
      linked_issue_id: suggestion.issueId,
      linked_estimate_item_id: suggestion.linkedEstimateItemId || null,
      confidence: suggestion.confidence,
      working_steps: steps,
      suggestion,
    });
  }, [insertMessage, loadSnapshot]);

  const applySuggestion = useCallback(async (suggestion: AssistantSuggestion, responseText?: string) => {
    const answer = responseText?.trim() || suggestion.answerText;
    const parsed = parseAssistantAnswerValues(answer, suggestion.structuredValues);
    const status = parsed.quantity || parsed.totalLengthM ? "resolved" : "answered";
    setWorkingSteps([
      "Saving engineer answer to QA issue",
      "Updating linked takeoff row when values are computable",
      "Refreshing workflow counts",
    ]);
    const result = await applyAssistantSuggestion(supabase, suggestion, answer, status);
    state.refresh();
    await insertMessage(
      "assistant",
      result.estimateUpdated
        ? `Applied. QA is marked **${result.issueStatus}** and the linked takeoff row was updated with computable values.`
        : `Saved. QA is marked **${result.issueStatus}**. I did not update a takeoff row because the answer still needs quantity or length.`,
      {
        kind: "applied_fix",
        linked_issue_id: suggestion.issueId,
        linked_estimate_item_id: suggestion.linkedEstimateItemId || null,
        working_steps: ["QA answer saved", result.estimateUpdated ? "Takeoff row updated" : "Takeoff row left for confirmation"],
      },
    );
    setWorkingSteps([
      "Refreshing project after apply",
      "Scanning for the next unresolved QA issue",
      "Preparing the next suggested answer",
    ]);
    const snapshot = await loadSnapshot();
    const next = buildNextEstimationAgentResponse(snapshot, { skipIssueIds: [suggestion.issueId] });
    setLatestSuggestion(next.suggestion);
    await insertMessage(
      "assistant",
      next.suggestion
        ? [
          "**Moving to next blocker**",
          "",
          next.suggestion.answerText,
          "",
          `**Next question:** ${next.suggestion.question}`,
          `Evidence quality: ${next.suggestion.confidence}`,
          "Say **apply** to save this answer, or correct it in chat.",
        ].join("\n")
        : "I re-checked the project after applying that answer. I do not see another applyable QA answer right now. Run **Finish estimation audit** to review remaining OCR/takeoff blockers.",
      {
        kind: next.suggestion ? "suggestion" : "audit",
        confidence: next.confidence,
        working_steps: next.workingSteps,
        suggestion: next.suggestion,
        linked_issue_id: next.suggestion?.issueId || null,
        linked_estimate_item_id: next.suggestion?.linkedEstimateItemId || null,
      },
    );
  }, [insertMessage, loadSnapshot, state]);

  const send = useCallback(async (override?: string) => {
    const text = (override ?? input).trim();
    if (busy || (!text && staged.length === 0)) return;
    if (!user) {
      toast.error("Sign in before using the assistant.");
      return;
    }
    setBusy(true);
    setInput("");
    try {
      const attachments = await uploadStagedFiles();
      const userText = text || `Uploaded ${attachments.map((file) => file.name).join(", ")}`;
      await insertMessage("user", userText, { kind: "question", attachments });
      if (attachments.length > 0 && !text) {
        await insertMessage("assistant", "Files are uploaded and registered. I can inspect the QA blockers or you can ask what to run next.", {
          kind: "question",
          attachments,
          working_steps: ["Registered uploaded files", "Refreshing project state"],
        });
      } else if (latestSuggestion && isAssistantConfirmationIntent(text)) {
        await applySuggestion(latestSuggestion, /apply|yes|confirm|use this|looks good/i.test(text) ? latestSuggestion.answerText : text);
      } else {
        await respondWithSuggestion(text || "Inspect current QA blockers and suggest the next answer.");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Assistant action failed.";
      toast.error(message);
      await insertMessage("assistant", `I could not complete that action: ${message}`, { kind: "error" }).catch(() => {});
    } finally {
      setBusy(false);
      setWorkingSteps([]);
      setUploadLabel(null);
      inputRef.current?.focus();
    }
  }, [applySuggestion, busy, input, insertMessage, latestSuggestion, respondWithSuggestion, staged.length, uploadStagedFiles, user]);

  const addFiles = (files: FileList | File[]) => {
    const next = Array.from(files).map((file) => ({
      file,
      previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined,
    }));
    setStaged((current) => [...current, ...next]);
  };

  return (
    <div className="grid grid-cols-12 h-full">
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="*"
        className="hidden"
        onChange={(event) => {
          if (event.target.files) addFiles(event.target.files);
          event.target.value = "";
        }}
      />
      <div className="col-span-8 border-r border-border flex flex-col min-h-0">
        <StageHeader
          kicker="Stage 05"
          title="Parallel Assistant"
          subtitle="Conversational project help with visible work steps and confirm-before-apply fixes."
          right={
            <div className="flex items-center gap-2">
              <button onClick={() => goToStage?.("qa")} className="h-8 px-3 border border-border text-[10px] uppercase tracking-[0.12em] hover:bg-accent/40">Open QA</button>
              <button onClick={() => goToStage?.("takeoff")} className="h-8 px-3 border border-primary/50 text-primary text-[10px] uppercase tracking-[0.12em] hover:bg-primary/10">Open Takeoff</button>
            </div>
          }
        />
        <div
          className={`flex-1 min-h-0 overflow-auto p-4 space-y-3 ${isDragging ? "ring-2 ring-primary/40 ring-inset" : ""}`}
          onDragOver={(event) => { event.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setIsDragging(false);
            if (event.dataTransfer.files.length) addFiles(event.dataTransfer.files);
          }}
        >
          {loadingMessages ? (
            <EmptyState title="Loading assistant chat" />
          ) : assistantMessages.length === 0 ? (
            <div className="h-full grid place-items-center">
              <div className="max-w-xl border border-border bg-card p-5 text-center">
                <Sparkles className="w-7 h-7 mx-auto text-primary mb-3" />
                <div className="text-sm font-semibold">Ask the assistant to inspect blockers.</div>
                <p className="text-xs text-muted-foreground mt-2">
                  Try: "check unresolved QA", "finish estimation audit", or upload another drawing directly into this chat.
                </p>
              </div>
            </div>
          ) : (
            assistantMessages.map((message) => (
              <AssistantBubble key={message.id} message={message} onApply={message.metadata?.suggestion ? () => applySuggestion(message.metadata!.suggestion!) : undefined} busy={busy} />
            ))
          )}
          {(workingSteps.length > 0 || uploadLabel) && <WorkingSteps label={uploadLabel} steps={workingSteps} />}
          <div ref={bottomRef} />
        </div>
        <div className="border-t border-border bg-card p-3">
          {staged.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {staged.map((item, index) => (
                <div key={`${item.file.name}-${index}`} className="flex items-center gap-2 border border-border bg-background px-2 py-1 text-[11px]">
                  {item.previewUrl ? <img src={item.previewUrl} alt={item.file.name} className="h-7 w-7 object-cover" /> : <FileText className="w-3.5 h-3.5 text-muted-foreground" />}
                  <span className="max-w-[180px] truncate">{item.file.name}</span>
                  <button onClick={() => setStaged((current) => current.filter((_, i) => i !== index))} aria-label="Remove file"><X className="w-3 h-3" /></button>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2 items-end border border-border bg-background p-2">
            <button onClick={() => fileInputRef.current?.click()} className="h-9 w-9 grid place-items-center text-muted-foreground hover:text-primary" title="Attach files">
              <Paperclip className="w-4 h-4" />
            </button>
            <textarea
              ref={inputRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  send();
                }
              }}
              onPaste={(event) => {
                const files = Array.from(event.clipboardData.items).map((item) => item.kind === "file" ? item.getAsFile() : null).filter((file): file is File => !!file);
                if (files.length) {
                  event.preventDefault();
                  addFiles(files);
                }
              }}
              rows={1}
              placeholder="Ask the assistant, paste a file, or say apply..."
              className="min-h-9 max-h-32 flex-1 resize-none bg-transparent py-2 text-sm outline-none placeholder:text-muted-foreground"
            />
            <button
              onClick={() => send()}
              disabled={busy || (!input.trim() && staged.length === 0)}
              className="h-9 w-9 grid place-items-center bg-primary text-primary-foreground disabled:opacity-40"
              title={busy ? "Working" : "Send"}
            >
              {busy ? <Square className="w-4 h-4" /> : <Send className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>
      <aside className="col-span-4 min-h-0 flex flex-col bg-card">
        <StageHeader kicker="Assistant Context" title="Project Snapshot" />
        <div className="p-4 space-y-4 overflow-auto">
          <div className="grid grid-cols-2 gap-2">
            <Metric label="Files" value={state.fileCount} />
            <Metric label="Takeoff Rows" value={state.takeoffRows} />
            <Metric label="QA Open" value={state.qaOpen} tone={state.qaOpen > 0 ? "warn" : "ok"} />
            <Metric label="QA Critical" value={state.qaCriticalOpen} tone={state.qaCriticalOpen > 0 ? "bad" : "ok"} />
          </div>
          <section className="border border-border bg-background/50 p-3">
            <div className="ip-kicker mb-2">Current Mode</div>
            <div className="flex items-center gap-2 text-[12px]">
              <CheckCircle2 className="w-4 h-4 text-primary" />
              Confirm before apply
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              The assistant can suggest and save answers. It only updates linked takeoff rows after you confirm.
            </p>
          </section>
          {latestSuggestion && (
            <section className="border border-primary/40 bg-primary/5 p-3 space-y-2">
              <div className="ip-kicker">Latest Suggestion</div>
              <div className="text-[13px] font-semibold">{latestSuggestion.locationLabel}</div>
              <p className="text-[12px] text-muted-foreground">{latestSuggestion.answerText}</p>
              <div className="flex gap-2">
                <Pill tone={latestSuggestion.confidence === "high" ? "ok" : latestSuggestion.confidence === "medium" ? "warn" : "bad"}>Evidence {latestSuggestion.confidence}</Pill>
                {latestSuggestion.linkedTakeoffMark && <Pill tone="info">{latestSuggestion.linkedTakeoffMark}</Pill>}
              </div>
              <button
                disabled={busy}
                onClick={() => applySuggestion(latestSuggestion)}
                className="w-full h-8 bg-primary text-primary-foreground text-[10px] uppercase tracking-[0.12em] font-bold disabled:opacity-50"
              >
                Apply Suggested Answer
              </button>
            </section>
          )}
          <section className="border border-border bg-background/50 p-3">
            <div className="ip-kicker mb-2">Useful Prompts</div>
            {["Finish estimation audit", "Check unresolved QA", "Suggest answer for the next blocked row", "What still needs engineer confirmation?"].map((prompt) => (
              <button key={prompt} onClick={() => send(prompt)} disabled={busy} className="block w-full text-left px-2 py-2 text-[12px] border border-border mb-2 hover:bg-accent/40 disabled:opacity-50">
                {prompt}
              </button>
            ))}
          </section>
        </div>
      </aside>
    </div>
  );
}

function AssistantBubble({ message, onApply, busy }: { message: AssistantMessage; onApply?: () => void; busy: boolean }) {
  const isUser = message.role === "user";
  const Icon = isUser ? User : message.metadata?.kind === "error" ? AlertTriangle : Bot;
  const attachments = message.metadata?.attachments || [];
  return (
    <div className={`flex gap-3 ${isUser ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[760px] border ${isUser ? "border-primary/40 bg-primary/10" : "border-border bg-card"} p-3`}>
        <div className="flex items-center gap-2 mb-2">
          <span className={`h-7 w-7 grid place-items-center ${isUser ? "bg-primary text-primary-foreground" : "bg-background text-primary"}`}>
            <Icon className="w-3.5 h-3.5" />
          </span>
          <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{isUser ? "Estimator" : "Assistant"}</span>
          {message.metadata?.confidence && <Pill tone={message.metadata.confidence === "high" ? "ok" : message.metadata.confidence === "medium" ? "warn" : "bad"}>Evidence {message.metadata.confidence}</Pill>}
        </div>
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {attachments.map((file) => (
              <span key={`${file.file_path || file.name}`} className="inline-flex items-center gap-1 border border-border px-2 py-1 text-[11px] text-muted-foreground">
                <FileText className="w-3 h-3" /> {file.name}
              </span>
            ))}
          </div>
        )}
        <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-strong:text-foreground text-[13px]">
          <ReactMarkdown>{message.content}</ReactMarkdown>
        </div>
        {message.metadata?.working_steps && message.metadata.working_steps.length > 0 && (
          <div className="mt-3 border-t border-border pt-2 space-y-1">
            {message.metadata.working_steps.map((step) => (
              <div key={step} className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <CheckCircle2 className="w-3 h-3 text-primary" /> {step}
              </div>
            ))}
          </div>
        )}
        {onApply && (
          <button onClick={onApply} disabled={busy} className="mt-3 h-8 px-3 bg-primary text-primary-foreground text-[10px] uppercase tracking-[0.12em] font-bold disabled:opacity-50">
            Apply Suggested Answer
          </button>
        )}
      </div>
    </div>
  );
}

function WorkingSteps({ label, steps }: { label?: string | null; steps: string[] }) {
  return (
    <div className="border border-primary/40 bg-primary/5 p-3">
      <div className="flex items-center gap-2 text-[12px] font-semibold">
        <Loader2 className="w-4 h-4 animate-spin text-primary" />
        {label || "Assistant is working"}
      </div>
      <div className="mt-2 grid gap-1">
        {steps.map((step) => (
          <div key={step} className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <RefreshCw className="w-3 h-3" /> {step}
          </div>
        ))}
      </div>
    </div>
  );
}

function Metric({ label, value, tone = "default" }: { label: string; value: React.ReactNode; tone?: "default" | "ok" | "warn" | "bad" }) {
  const color = tone === "ok" ? "text-[hsl(var(--status-supported))]" : tone === "warn" ? "text-[hsl(var(--status-inferred))]" : tone === "bad" ? "text-[hsl(var(--status-blocked))]" : "text-foreground";
  return (
    <div className="border border-border bg-background px-3 py-2">
      <div className="ip-kicker">{label}</div>
      <div className={`mt-1 text-lg font-semibold tabular-nums ${color}`}>{value}</div>
    </div>
  );
}
