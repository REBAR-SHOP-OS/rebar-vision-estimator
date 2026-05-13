import React, { useMemo, useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { createClient } from "@supabase/supabase-js";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Send, Loader2, MessageSquare, CheckCircle } from "lucide-react";
import logoImg from "@/assets/logo.png";
import ReviewReport from "@/components/review/ReviewReport";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

function isExpired(expiresAt: string | null | undefined) {
  if (!expiresAt) return false;
  const ts = new Date(expiresAt).getTime();
  return Number.isFinite(ts) && ts <= Date.now();
}

const ReviewPage: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const reviewClient = useMemo(() => createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: token ? { "x-share-token": token } : {},
    },
  }), [token]);

  const [share, setShare] = useState<any>(null);
  const [comments, setComments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [authorName, setAuthorName] = useState("");
  const [authorEmail, setAuthorEmail] = useState("");
  const [commentText, setCommentText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const updateShareStatus = async (nextStatus: "viewed" | "commented") => {
    if (!token) return null;

    const { data, error } = await reviewClient.rpc("update_review_share_status", {
      p_share_token: token,
      p_next_status: nextStatus,
    });

    if (error) throw error;

    if (data) {
      setShare(data);
    }

    return data;
  };

  useEffect(() => {
    if (token) loadShareData();
  }, [token, reviewClient]);

  const loadShareData = async () => {
    setLoading(true);
    try {
      const { data: shareData, error: shareErr } = await reviewClient
        .from("review_shares")
        .select("*")
        .eq("share_token", token)
        .single();

      if (shareErr || !shareData || isExpired(shareData.expires_at)) {
        setError("This review link is invalid or has expired.");
        setLoading(false);
        return;
      }

      let activeShare = shareData;
      if (shareData.status === "pending") {
        const viewedShare = await updateShareStatus("viewed");
        if (viewedShare) {
          activeShare = viewedShare;
        }
      } else {
        setShare(shareData);
      }

      const { data: commentsData } = await reviewClient
        .from("review_comments")
        .select("*")
        .eq("share_id", activeShare.id)
        .order("created_at", { ascending: true });

      setComments(commentsData || []);
    } catch {
      setError("Failed to load review data.");
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitComment = async () => {
    if (!commentText.trim() || !authorName.trim() || !authorEmail.trim() || !share) return;
    setSubmitting(true);
    try {
      const { error: insertErr } = await reviewClient
        .from("review_comments")
        .insert({
          share_id: share.id,
          author_name: authorName.trim(),
          author_email: authorEmail.trim(),
          content: commentText.trim(),
        });

      if (insertErr) throw insertErr;

      await updateShareStatus("commented");

      setSubmitted(true);
      setCommentText("");

      const { data: commentsData } = await reviewClient
        .from("review_comments")
        .select("*")
        .eq("share_id", share.id)
        .order("created_at", { ascending: true });

      setComments(commentsData || []);
    } catch (err: any) {
      console.error("Comment error:", err);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4 max-w-md px-4">
          <img src={logoImg} alt="Logo" className="h-12 mx-auto" />
          <h1 className="text-xl font-bold text-foreground">Review Not Found</h1>
          <p className="text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  const reviewData = share?.review_data;
  const reviewType = share?.review_type || "estimation_review";
  const reviewTypeLabel = reviewType === "quote_approval"
    ? "Quote Approval"
    : reviewType === "customer_quote"
    ? "Customer Quotation"
    : "Estimation Review";

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card px-4 py-3">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <img src={logoImg} alt="Logo" className="h-8" />
          <div>
            <h1 className="text-lg font-bold text-foreground">{reviewTypeLabel}</h1>
            <p className="text-xs text-muted-foreground">
              Shared by the project owner for your feedback
            </p>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        <div className="rounded-xl border border-border bg-card p-4 space-y-2">
          <h2 className="font-semibold text-foreground">Review Details</h2>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <span className="text-muted-foreground">Reviewer: </span>
              <span className="font-medium">{share?.reviewer_name || share?.reviewer_email}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Status: </span>
              <span className="font-medium capitalize">{share?.status}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Shared: </span>
              <span className="font-medium">
                {new Date(share?.created_at).toLocaleDateString()}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">Type: </span>
              <span className="font-medium">{reviewTypeLabel}</span>
            </div>
          </div>
        </div>

        {reviewData && Object.keys(reviewData).length > 0 && (
          <ReviewReport reviewData={reviewData} />
        )}

        {comments.length > 0 && (
          <div className="space-y-3">
            <h2 className="font-semibold text-foreground flex items-center gap-2">
              <MessageSquare className="h-4 w-4" />
              Comments ({comments.length})
            </h2>
            {comments.map((c) => (
              <div key={c.id} className="rounded-lg border border-border bg-card p-3 space-y-1">
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-semibold text-foreground">{c.author_name}</span>
                  <span className="text-muted-foreground text-xs">
                    {new Date(c.created_at).toLocaleString()}
                  </span>
                </div>
                <p className="text-sm text-foreground">{c.content}</p>
              </div>
            ))}
          </div>
        )}

        <div className="rounded-xl border border-border bg-card p-4 space-y-4">
          <h2 className="font-semibold text-foreground">Leave a Comment</h2>

          {submitted && (
            <div className="flex items-center gap-2 text-sm text-primary bg-primary/10 rounded-lg p-3">
              <CheckCircle className="h-4 w-4" />
              Comment submitted! You can add more below.
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="name">Your Name *</Label>
              <Input
                id="name"
                placeholder="Ben"
                value={authorName}
                onChange={(e) => setAuthorName(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="email">Your Email *</Label>
              <Input
                id="email"
                type="email"
                placeholder="ben@rebar.shop"
                value={authorEmail}
                onChange={(e) => setAuthorEmail(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="comment">Comment *</Label>
            <Textarea
              id="comment"
              placeholder="Your feedback on this estimation..."
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              rows={4}
            />
          </div>
          <Button
            onClick={handleSubmitComment}
            disabled={!commentText.trim() || !authorName.trim() || !authorEmail.trim() || submitting}
            className="gap-2"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {submitting ? "Submitting..." : "Submit Comment"}
          </Button>
        </div>
      </main>
    </div>
  );
};

export default ReviewPage;
