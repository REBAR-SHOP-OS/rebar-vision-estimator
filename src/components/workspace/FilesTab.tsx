import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileText, Loader2, AlertTriangle, CheckCircle2, Clock, Archive, Upload, Eye, CheckCircle } from "lucide-react";
import { computeSHA256 } from "@/lib/file-hash";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { logAuditEvent } from "@/lib/audit-logger";
import { renderPdfPagesToImages } from "@/lib/pdf-to-images";
import {
  createProjectFileWithCanonicalBridge,
  detectDiscipline,
  ensureCurrentProjectRebarBridge,
  ensureRebarProjectFileBridge,
  inferRebarFileKind,
} from "@/lib/rebar-intake";
import { getCanonicalProjectFiles, type CanonicalProjectFileView } from "@/lib/rebar-read-model";
import { supersedePreviousActiveFile } from "@/lib/revision-lifecycle";

interface FileRow {
  id: string;
  legacy_file_id?: string | null;
  file_name: string;
  file_type: string | null;
  file_size: number | null;
  file_path: string;
  created_at: string;
  discipline?: string;
  revision_label?: string;
  parse_status?: string;
  is_superseded?: boolean;
  is_active?: boolean;
}

export default function FilesTab({ projectId, onProjectRefresh }: { projectId: string; onProjectRefresh?: () => void }) {
  const { user } = useAuth();
  const [files, setFiles] = useState<FileRow[]>([]);
  const [segmentCounts, setSegmentCounts] = useState<Record<string, number>>({});
  const [issueCounts, setIssueCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [uploadProgress, setUploadProgress] = useState("");

  useEffect(() => { loadFiles(); }, [projectId]);

  const classifyUploadedFile = (fileName: string, mime: string | null): string => {
    const n = fileName.toLowerCase();
    if (/\.(xlsx|xls|csv)$/.test(n)) {
      if (/answer|correct|reference|benchmark/.test(n)) return "reference_estimate_xlsx";
      return "unknown";
    }
    if (/\.pdf$/.test(n) || (mime || "").includes("pdf")) {
      if (/shop|fab|placing/.test(n)) return "reference_shop_drawing_pdf";
      const d = detectDiscipline(fileName);
      if (d === "Structural") return "structural_pdf";
      if (d === "Architectural") return "architectural_pdf";
      return "unknown";
    }
    return "unknown";
  };

  const parseFile = async (fileId: string, fileName: string, filePath: string, onProgress?: (msg: string) => void) => {
    try {
      const { data: existingDv } = await supabase
        .from("document_versions")
        .select("id")
        .eq("file_id", fileId)
        .maybeSingle();

      let dvId = existingDv?.id;
      if (!dvId) {
        const hash = `pending_${Date.now()}_${fileId}`;
        const discipline = detectDiscipline(fileName);
        const { data: newDv } = await supabase.from("document_versions").insert({
          project_id: projectId,
          user_id: user!.id,
          file_id: fileId,
          file_name: fileName,
          file_path: filePath,
          sha256: hash,
          source_system: "upload",
          pdf_metadata: discipline ? { discipline } : {},
        }).select("id").single();
        dvId = newDv?.id;
      }

      const { data: urlData } = await supabase.storage
        .from("blueprints")
        .createSignedUrl(filePath, 3600);
      if (!urlData?.signedUrl) return false;

      const { data: extraction, error: extractErr } = await supabase.functions.invoke("extract-pdf-text", {
        body: { pdf_url: urlData.signedUrl, project_id: projectId },
      });

      const hasText = extraction?.pages?.some((p: any) => p.raw_text && p.raw_text.trim().length > 20);

      let pages = extraction?.pages || [];
      let totalPages = extraction?.total_pages || 0;
      const sha256 = extraction?.sha256 || `file_${fileId}`;

      if (extractErr || !hasText) {
        import.meta.env.DEV && console.log(`[FilesTab] Server extraction empty for ${fileName}, falling back to client-side OCR`);
        onProgress?.("Rendering pages...");

        try {
          const pageImages = await renderPdfPagesToImages(urlData.signedUrl, projectId, {
            maxPages: 50,
            scale: 1.5,
            onProgress: (current, total) => onProgress?.(`Rendering page ${current}/${total}`),
          });

          if (pageImages.length === 0) {
            console.warn(`[FilesTab] No page images rendered for ${fileName}`);
            return false;
          }

          totalPages = pageImages.length;
          pages = [];

          for (let i = 0; i < pageImages.length; i += 4) {
            const batch = pageImages.slice(i, i + 4);
            const batchResults = await Promise.allSettled(
              batch.map(async (img) => {
                onProgress?.(`OCR page ${img.pageNumber}/${totalPages}`);
                const { data: ocrData, error: ocrErr } = await supabase.functions.invoke("ocr-image", {
                  body: { image_url: img.signedUrl },
                });
                if (ocrErr || !ocrData?.ocr_results) return { pageNumber: img.pageNumber, raw_text: "" };
                const fullText = ocrData.ocr_results
                  .map((r: any) => r.fullText || "")
                  .filter((t: string) => t.length > 0)
                  .sort((a: string, b: string) => b.length - a.length)[0] || "";
                return { pageNumber: img.pageNumber, raw_text: fullText };
              })
            );

            for (const result of batchResults) {
              if (result.status === "fulfilled") {
                pages.push({
                  page_number: result.value.pageNumber,
                  raw_text: result.value.raw_text,
                });
              }
            }
          }

          import.meta.env.DEV && console.log(`[FilesTab] OCR completed: ${pages.filter((p: any) => p.raw_text?.length > 0).length}/${totalPages} pages with text`);
        } catch (ocrErr) {
          console.error(`[FilesTab] Client-side OCR failed for ${fileName}:`, ocrErr);
          return false;
        }
      }

      onProgress?.("Indexing...");
      const { error: indexErr } = await supabase.functions.invoke("populate-search-index", {
        body: {
          project_id: projectId,
          document_version_id: dvId,
          pages,
          file_name: fileName,
          sha256,
          pipeline_file_id: fileId,
        },
      });

      if (dvId) {
        await supabase.from("document_versions").update({
          sha256,
          page_count: totalPages || pages.length,
          is_scanned: !hasText,
        }).eq("id", dvId);
      }

      try {
        await ensureRebarProjectFileBridge(supabase, {
          legacyFileId: fileId,
          legacyProjectId: projectId,
          storagePath: filePath,
          originalFilename: fileName,
          fileKind: inferRebarFileKind(fileName, null),
          checksumSha256: sha256,
          pageCount: totalPages || pages.length,
        });
      } catch (bridgeErr) {
        console.warn("Canonical file bridge sync failed after parsing:", bridgeErr);
      }

      if (!indexErr) {
        try {
          await (supabase as any)
            .from("document_registry")
            .update({ parse_status: "parsed", extraction_status: "indexed" })
            .eq("file_id", fileId)
            .eq("project_id", projectId);
        } catch {
          /* optional table */
        }
      }

      return !indexErr;
    } catch (error) {
      console.warn(`Parse pipeline failed for ${fileName}:`, error);
      return false;
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0 || !user) return;
    const files = Array.from(fileList);
    setUploading(true);

    try {
      await ensureCurrentProjectRebarBridge(supabase, projectId);
    } catch (bridgeErr) {
      console.warn("Canonical project bridge check failed before upload:", bridgeErr);
      toast.error("Upload blocked until the canonical rebar project bridge is healthy.");
      setUploading(false);
      setUploadProgress("");
      e.target.value = "";
      return;
    }

    const uploadedFiles: { id: string; name: string; path: string; type: string | null }[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setUploadProgress(`Uploading ${i + 1}/${files.length}`);
      const path = `${user.id}/${projectId}/${Date.now()}_${file.name}`;
      const { error: storageErr } = await supabase.storage.from("blueprints").upload(path, file);
      if (storageErr) {
        toast.error(`Upload failed: ${file.name}`);
        continue;
      }

      const discipline = detectDiscipline(file.name);
      let checksumSha256: string | null = null;
      try {
        checksumSha256 = await computeSHA256(file);
      } catch (hashErr) {
        console.warn(`Checksum generation failed for ${file.name}:`, hashErr);
      }

      let legacyFileId: string;
      try {
        const fileRow = await createProjectFileWithCanonicalBridge(supabase, {
          projectId,
          userId: user.id,
          fileName: file.name,
          filePath: path,
          fileType: file.type || null,
          fileSize: file.size,
          fileKind: inferRebarFileKind(file.name, file.type || null),
          checksumSha256,
        });
        legacyFileId = fileRow.id;
      } catch (bridgeErr) {
        console.warn(`Canonical file intake failed for ${file.name}:`, bridgeErr);
        toast.error(`Canonical file intake failed: ${file.name}`);
        continue;
      }

      try {
        await supabase.from("document_versions").insert({
          project_id: projectId,
          user_id: user.id,
          file_id: legacyFileId,
          file_name: file.name,
          file_path: path,
          sha256: checksumSha256 || `pending_${Date.now()}_${legacyFileId}`,
          source_system: "upload",
          pdf_metadata: discipline ? { discipline } : {},
        });
      } catch (docVersionErr) {
        console.warn(`document_versions insert failed for ${file.name}:`, docVersionErr);
      }

      await logAuditEvent(user.id, "uploaded", "project_file", legacyFileId, projectId);
      const classification = classifyUploadedFile(file.name, file.type);
      try {
        await (supabase as any).from("document_registry").upsert(
          {
            project_id: projectId,
            user_id: user.id,
            file_id: legacyFileId,
            classification,
            validation_role: /answer|reference|correct|benchmark/i.test(file.name) ? "reference_answer" : "input",
            parse_status: "pending",
            extraction_status: "pending",
            detected_discipline: discipline,
            is_active: true,
          },
          { onConflict: "project_id,file_id" },
        );

        // Supersede any previously active file with the same classification + discipline
        await supersedePreviousActiveFile(supabase, {
          projectId,
          userId: user.id,
          newFileId: legacyFileId,
          classification,
          detectedDiscipline: discipline || null,
        });
      } catch {
        /* document_registry may not exist until migration applied */
      }
      uploadedFiles.push({ id: legacyFileId, name: file.name, path, type: file.type || null });
    }

    if (uploadedFiles.length > 0) {
      toast.success(`${uploadedFiles.length} file${uploadedFiles.length > 1 ? "s" : ""} uploaded`);
    } else {
      toast.error("No files were uploaded successfully");
    }

    let parsedCount = 0;
    for (let i = 0; i < uploadedFiles.length; i++) {
      setUploadProgress(`Parsing ${i + 1}/${uploadedFiles.length}`);
      const uf = uploadedFiles[i];
      const ok = await parseFile(uf.id, uf.name, uf.path, (msg) => setUploadProgress(`File ${i + 1}/${uploadedFiles.length}: ${msg}`));
      if (ok) parsedCount++;
    }
    if (parsedCount > 0) {
      toast.success(`Parsed ${parsedCount} of ${uploadedFiles.length} file(s)`);
    }

    loadFiles();
    const { error: pipelineErr } = await supabase.functions.invoke("process-pipeline", { body: { project_id: projectId } });
    if (pipelineErr) console.warn("process-pipeline failed after upload:", pipelineErr);
    else onProjectRefresh?.();
    setUploading(false);
    setUploadProgress("");
    e.target.value = "";
  };

  const handleViewFile = async (filePath: string) => {
    const { data } = await supabase.storage.from("blueprints").createSignedUrl(filePath, 3600);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
    else toast.error("Could not generate file URL");
  };

  const handleParseAll = async () => {
    if (!user) return;
    setParsing(true);
    const pendingFiles = files.filter((f) => f.parse_status === "pending" && f.legacy_file_id);
    let successCount = 0;

    try {
      for (let i = 0; i < pendingFiles.length; i++) {
        const f = pendingFiles[i];
        const ok = await parseFile(f.legacy_file_id!, f.file_name, f.file_path, (msg) => toast.info(`File ${i + 1}/${pendingFiles.length}: ${msg}`, { id: "parse-progress" }));
        if (ok) successCount++;
      }

      const { error: pipelineErr } = await supabase.functions.invoke("process-pipeline", { body: { project_id: projectId } });
      if (!pipelineErr) onProjectRefresh?.();

      if (successCount > 0) {
        toast.success(`Parsed & indexed ${successCount} of ${pendingFiles.length} file(s)`);
      } else if (pendingFiles.length > 0) {
        toast.warning("Files processed but no text extracted (scanned PDFs) or canonical sync failed.");
      }
      loadFiles();
    } catch (err) {
      toast.error("Failed to start parsing");
      console.error("Parse all error:", err);
    } finally {
      setParsing(false);
    }
  };

  const mergeCanonicalFiles = (
    canonicalFiles: CanonicalProjectFileView[],
    legacyFiles: any[],
    versions: any[],
  ): FileRow[] => {
    const legacyById = new Map<string, any>();
    legacyFiles.forEach((file: any) => legacyById.set(file.id, file));

    const versionByLegacyFileId = new Map<string, any>();
    versions.forEach((version: any) => {
      if (version.file_id) versionByLegacyFileId.set(version.file_id, version);
    });

    const canonicalRows = canonicalFiles.map((file) => {
      const legacyFile = file.legacyFileId ? legacyById.get(file.legacyFileId) : null;
      const version = file.legacyFileId ? versionByLegacyFileId.get(file.legacyFileId) : null;
      const discipline = file.detectedDisciplines[0] || version?.pdf_metadata?.discipline || undefined;

      return {
        id: file.rebarProjectFileId,
        legacy_file_id: file.legacyFileId,
        file_name: file.originalFilename,
        file_type: legacyFile?.file_type || null,
        file_size: legacyFile?.file_size || null,
        file_path: file.storagePath,
        created_at: legacyFile?.created_at || file.uploadedAt,
        discipline,
        revision_label: file.revisionLabel || version?.pdf_metadata?.revision_label || undefined,
        parse_status: file.parsedStatus,
        is_superseded: version?.pdf_metadata?.is_superseded || false,
      };
    });

    const linkedLegacyIds = new Set(
      canonicalFiles.map((file) => file.legacyFileId).filter((fileId): fileId is string => Boolean(fileId)),
    );

    const legacyOnlyRows = legacyFiles
      .filter((file: any) => !linkedLegacyIds.has(file.id))
      .map((file: any) => {
        const version = versionByLegacyFileId.get(file.id);
        const isParsed = version?.page_count !== null && version?.page_count !== undefined;

        return {
          ...file,
          legacy_file_id: file.id,
          discipline: version?.pdf_metadata?.discipline || undefined,
          revision_label: version?.pdf_metadata?.revision_label || undefined,
          parse_status: isParsed ? "parsed" : "pending",
          is_superseded: version?.pdf_metadata?.is_superseded || false,
        };
      });

    return [...canonicalRows, ...legacyOnlyRows];
  };

  const loadFiles = () => {
    setLoading(true);
    Promise.all([
      getCanonicalProjectFiles(supabase, projectId).catch((error) => {
        console.warn("Failed to load canonical project files:", error);
        return [] as CanonicalProjectFileView[];
      }),
      supabase.from("project_files").select("id, file_name, file_type, file_size, file_path, created_at").eq("project_id", projectId).order("created_at", { ascending: false }),
      supabase.from("document_versions").select("file_id, source_system, pdf_metadata, page_count, is_scanned").eq("project_id", projectId),
      supabase.from("segments").select("id").eq("project_id", projectId),
      supabase.from("validation_issues").select("source_file_id, status").eq("project_id", projectId),
      (supabase as any).from("document_registry").select("file_id, is_active").eq("project_id", projectId).catch(() => ({ data: [] })),
    ]).then(async ([canonicalFiles, filesRes, versionsRes, segmentsRes, issuesRes, registryRes]) => {
      const rawFiles = filesRes.data || [];
      const versions = versionsRes.data || [];
      const versionMap = new Map<string, any>();
      versions.forEach((v: any) => { if (v.file_id) versionMap.set(v.file_id, v); });

      // Build a map of file_id -> is_active from document_registry
      const registryActiveMap = new Map<string, boolean>();
      ((registryRes as any)?.data || []).forEach((r: any) => {
        if (r.file_id != null) registryActiveMap.set(r.file_id, r.is_active !== false);
      });

      const segmentIds = (segmentsRes.data || []).map((segment: any) => segment.id);
      const linksRes = segmentIds.length > 0
        ? await supabase.from("segment_source_links").select("file_id, segment_id").in("segment_id", segmentIds)
        : { data: [], error: null };

      const segCounts: Record<string, number> = {};
      (linksRes.data || []).forEach((link: any) => {
        if (link.file_id) segCounts[link.file_id] = (segCounts[link.file_id] || 0) + 1;
      });
      setSegmentCounts(segCounts);

      const issCounts: Record<string, number> = {};
      (issuesRes.data || []).forEach((iss: any) => {
        if (iss.source_file_id && iss.status === "open") issCounts[iss.source_file_id] = (issCounts[iss.source_file_id] || 0) + 1;
      });
      setIssueCounts(issCounts);

      const applyRegistryActive = (row: FileRow, legacyId: string | null | undefined): FileRow => {
        if (legacyId && registryActiveMap.has(legacyId)) {
          const active = registryActiveMap.get(legacyId)!;
          return { ...row, is_active: active, is_superseded: !active || row.is_superseded };
        }
        // No registry row: default to active (backwards compatible)
        return { ...row, is_active: row.is_active ?? true };
      };

      const enriched: FileRow[] = canonicalFiles.length > 0
        ? mergeCanonicalFiles(canonicalFiles, rawFiles, versions).map((r) =>
            applyRegistryActive(r, r.legacy_file_id),
          )
        : rawFiles.map((f: any) => {
            const ver = versionMap.get(f.id);
            const isParsed = ver?.page_count !== null && ver?.page_count !== undefined;
            const base: FileRow = {
              ...f,
              legacy_file_id: f.id,
              discipline: ver?.pdf_metadata?.discipline || undefined,
              revision_label: ver?.pdf_metadata?.revision_label || undefined,
              parse_status: isParsed ? "parsed" : "pending",
              is_superseded: ver?.pdf_metadata?.is_superseded || false,
            };
            return applyRegistryActive(base, f.id);
          });

      // Active files first, then superseded/inactive
      enriched.sort((a, b) => {
        const aActive = a.is_active !== false;
        const bActive = b.is_active !== false;
        if (aActive === bActive) return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        return aActive ? -1 : 1;
      });

      setFiles(enriched);
      setLoading(false);
    });
  };

  if (loading) {
    return <div className="flex items-center justify-center h-40"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>;
  }

  if (files.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-40 text-muted-foreground gap-3">
        <FileText className="h-8 w-8" />
        <p className="text-sm">No files uploaded yet.</p>
        <p className="text-[10px]">Upload structural drawings to begin estimation.</p>
        <Button size="sm" variant="outline" className="gap-1.5 h-7 text-xs relative" disabled={uploading}>
          {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
          {uploading ? `${uploadProgress}...` : "Upload Files"}
          <input type="file" multiple className="absolute inset-0 opacity-0 cursor-pointer" onChange={handleUpload} accept="*" />
        </Button>
      </div>
    );
  }

  const parseablePendingFiles = files.filter((f) => f.parse_status === "pending" && f.legacy_file_id);
  const activeFileCount = files.filter((f) => f.is_active !== false).length;

  const fmtSize = (bytes: number | null) => {
    if (!bytes) return "-";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  };

  const parseIcon = (status: string) => {
    if (status === "parsed") return <CheckCircle2 className="h-3 w-3 text-[hsl(var(--status-approved))]" />;
    if (status === "review_needed") return <AlertTriangle className="h-3 w-3 text-[hsl(var(--status-review))]" />;
    if (status === "failed") return <AlertTriangle className="h-3 w-3 text-destructive" />;
    return <Clock className="h-3 w-3 text-muted-foreground" />;
  };

  const revisionBadge = (f: FileRow) => {
    const isActive = f.is_active !== false;
    const isSuperseded = !isActive || f.is_superseded;
    if (!isSuperseded) {
      return (
        <Badge variant="outline" className="text-[8px] border-green-500/40 text-green-600 flex-shrink-0">
          <CheckCircle className="h-2.5 w-2.5 mr-0.5" />Current
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="text-[8px] border-destructive/30 text-destructive flex-shrink-0">
        <Archive className="h-2.5 w-2.5 mr-0.5" />Superseded
      </Badge>
    );
  };

  return (
    <div className="p-4 md:p-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-foreground">Files & Revisions</h3>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="text-[10px]">
            {activeFileCount} active{files.length !== activeFileCount ? ` / ${files.length} total` : ""}
          </Badge>
          {parseablePendingFiles.length > 0 && (
            <Button size="sm" variant="default" className="gap-1.5 h-7 text-xs" disabled={parsing} onClick={handleParseAll}>
              {parsing ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileText className="h-3 w-3" />}
              {parsing ? "Parsing..." : "Parse All"}
            </Button>
          )}
          <Button size="sm" variant="outline" className="gap-1.5 h-7 text-xs relative" disabled={uploading}>
            {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
            {uploading ? `${uploadProgress}...` : "Upload"}
            <input type="file" multiple className="absolute inset-0 opacity-0 cursor-pointer" onChange={handleUpload} accept=".pdf,.dwg,.dxf,.xlsx,.csv,.png,.jpg" />
          </Button>
        </div>
      </div>
      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-muted/60">
            <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="text-left px-4 py-2.5 font-semibold">File</th>
              <th className="text-left px-3 py-2.5 font-semibold">Discipline</th>
              <th className="text-left px-3 py-2.5 font-semibold">Rev</th>
              <th className="text-center px-3 py-2.5 font-semibold">Parse</th>
              <th className="text-right px-3 py-2.5 font-semibold">Size</th>
              <th className="text-center px-3 py-2.5 font-semibold">Links</th>
              <th className="text-center px-3 py-2.5 font-semibold">Issues</th>
              <th className="text-right px-3 py-2.5 font-semibold">Uploaded</th>
              <th className="text-center px-3 py-2.5 font-semibold">View</th>
            </tr>
          </thead>
          <tbody>
            {files.map((f) => {
              const isActive = f.is_active !== false;
              return (
                <tr key={f.id} className={`border-t border-border/50 hover:bg-muted/20 transition-colors ${!isActive ? "opacity-50" : ""}`}>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <FileText className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                      <span className="font-medium text-foreground truncate max-w-[250px]">{f.file_name}</span>
                      {revisionBadge(f)}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    {f.discipline ? <Badge variant="outline" className="text-[9px]">{f.discipline}</Badge> : <span className="text-muted-foreground">-</span>}
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground font-mono">{f.revision_label || "-"}</td>
                  <td className="px-3 py-2.5 text-center">
                    <div className="flex items-center justify-center gap-1">
                      {parseIcon(f.parse_status || "pending")}
                      <span className="text-[9px] text-muted-foreground capitalize">{f.parse_status || "pending"}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right text-muted-foreground">{fmtSize(f.file_size)}</td>
                  <td className="px-3 py-2.5 text-center">
                    {(segmentCounts[f.legacy_file_id || f.id] || 0) > 0 ? (
                      <Badge variant="secondary" className="text-[9px]">{segmentCounts[f.legacy_file_id || f.id]} seg</Badge>
                    ) : <span className="text-muted-foreground">-</span>}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    {(issueCounts[f.legacy_file_id || f.id] || 0) > 0 ? (
                      <Badge variant="destructive" className="text-[9px]">{issueCounts[f.legacy_file_id || f.id]}</Badge>
                    ) : <span className="text-muted-foreground">-</span>}
                  </td>
                  <td className="px-3 py-2.5 text-right text-muted-foreground">{new Date(f.created_at).toLocaleDateString()}</td>
                  <td className="px-3 py-2.5 text-center">
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleViewFile(f.file_path)} title="View file">
                      <Eye className="h-3 w-3" />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
