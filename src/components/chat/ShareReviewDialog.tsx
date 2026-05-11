import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Copy, Check, Send, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface ShareReviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId?: string;
  reviewType?: "estimation_review" | "quote_approval" | "customer_quote";
  reviewData?: Record<string, unknown>;
  defaultEmail?: string;
  defaultName?: string;
}

const ShareReviewDialog: React.FC<ShareReviewDialogProps> = ({
  open, onOpenChange, projectId,
  reviewType = "estimation_review",
  reviewData,
  defaultEmail = "",
  defaultName = "",
}) => {
  const [email, setEmail] = useState(defaultEmail);
  const [name, setName] = useState(defaultName);
  const [loading, setLoading] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Reset defaults when dialog opens with new defaults
  React.useEffect(() => {
    if (open) {
      setEmail(defaultEmail);
      setName(defaultName);
      setShareUrl(null);
      setCopied(false);
    }
  }, [open, defaultEmail, defaultName]);

  const handleSend = async () => {
    if (!email.trim() || !projectId) return;
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-review-invite`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({
            project_id: projectId,
            reviewer_email: email.trim(),
            reviewer_name: name.trim() || null,
            review_type: reviewType,
            review_data: reviewData || {},
          }),
        }
      );
      const result = await resp.json();
      if (!resp.ok) throw new Error(result.error || "Failed to create share");
      setShareUrl(result.shareUrl);
      toast.success("Review link created!");
    } catch (err) {
      toast.error((err as Error).message || "Failed to share");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    if (!shareUrl) return;
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    toast.success("Link copied!");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleClose = (open: boolean) => {
    if (!open) {
      setEmail("");
      setName("");
      setShareUrl(null);
      setCopied(false);
    }
    onOpenChange(open);
  };

  const reviewTypeLabel = reviewType === "quote_approval"
    ? "Quote Approval"
    : reviewType === "customer_quote"
    ? "Customer Quote"
    : "Estimation Review";

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share for {reviewTypeLabel}</DialogTitle>
          <DialogDescription>
            {reviewType === "quote_approval"
              ? "Send this quotation for internal approval before sending to the customer."
              : reviewType === "customer_quote"
              ? "Send the approved quotation to the customer."
              : "Send this estimation to a reviewer for feedback and comments."}
          </DialogDescription>
        </DialogHeader>

        {!shareUrl ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="reviewer-email">Reviewer Email *</Label>
              <Input
                id="reviewer-email"
                type="email"
                placeholder="ben@rebar.shop"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="reviewer-name">Reviewer Name</Label>
              <Input
                id="reviewer-name"
                placeholder="Ben"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <Button
              onClick={handleSend}
              disabled={!email.trim() || loading}
              className="w-full gap-2"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {loading ? "Creating link..." : "Create Review Link"}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg bg-muted p-3 text-sm break-all font-mono">
              {shareUrl}
            </div>
            <Button onClick={handleCopy} className="w-full gap-2" variant="outline">
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? "Copied!" : "Copy Link"}
            </Button>
            <p className="text-xs text-muted-foreground text-center">
              Share this link with {name || email} to get their feedback.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default ShareReviewDialog;
