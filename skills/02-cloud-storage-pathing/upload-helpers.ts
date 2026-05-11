import { supabase } from "@/integrations/supabase/client";

/**
 * Upload a file to the `uploads` bucket using the canonical
 * `${userId}/${projectId}/${kind}/${filename}` path so storage RLS
 * (storage.foldername(name)[1] = user id) accepts it.
 */
export async function uploadToProject(opts: {
  file: Blob | File;
  projectId: string;
  kind?: "files" | "pages" | "exports";
  filename: string;
  contentType?: string;
  bucket?: string;
}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) throw new Error("Not authenticated");
  const bucket = opts.bucket ?? "uploads";
  const kind = opts.kind ?? "files";
  const path = `${session.user.id}/${opts.projectId}/${kind}/${opts.filename}`;
  const { error } = await supabase.storage.from(bucket).upload(path, opts.file, {
    contentType: opts.contentType ?? (opts.file as File).type ?? undefined,
    upsert: true,
  });
  if (error) throw error;
  const { data } = await supabase.storage.from(bucket).createSignedUrl(path, 3600);
  return { path, signedUrl: data?.signedUrl ?? null };
}