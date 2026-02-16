import React, { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HelpCircle, CheckCircle2 } from "lucide-react";

interface Question {
  element_id: string;
  field: string;
  issue: "CONFLICT" | "LOW_CONFIDENCE" | "MISSING";
  prompt: string;
  options: string[];
  severity: "LOW" | "MED" | "HIGH" | "BLOCKING";
}

interface QuestionCardProps {
  question: Question;
  onAnswer?: (elementId: string, field: string, value: string) => void;
}

const severityConfig: Record<string, { bg: string; text: string; border: string }> = {
  LOW: { bg: "bg-muted", text: "text-muted-foreground", border: "border-border" },
  MED: { bg: "bg-amber-500/10", text: "text-amber-600 dark:text-amber-400", border: "border-amber-500/30" },
  HIGH: { bg: "bg-destructive/10", text: "text-destructive", border: "border-destructive/30" },
  BLOCKING: { bg: "bg-destructive", text: "text-destructive-foreground", border: "border-destructive" },
};

const issueLabels: Record<string, string> = {
  CONFLICT: "⚔️ Conflict",
  LOW_CONFIDENCE: "📉 Low Confidence",
  MISSING: "❓ Missing",
};

const QuestionCard: React.FC<QuestionCardProps> = ({ question, onAnswer }) => {
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [answered, setAnswered] = useState(false);
  const config = severityConfig[question.severity] || severityConfig.LOW;

  const handleSelect = (option: string) => {
    setSelectedOption(option);
    setAnswered(true);
    onAnswer?.(question.element_id, question.field, option);
  };

  return (
    <div className={`p-4 rounded-xl border-2 transition-all ${answered ? "border-primary/30 bg-primary/5" : config.border + " " + config.bg}`}>
      <div className="flex items-start gap-3 mb-3">
        {answered ? (
          <CheckCircle2 className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
        ) : (
          <HelpCircle className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-xs font-bold text-foreground">{question.element_id}</span>
            <Badge variant="outline" className="text-[10px] rounded-md">{question.field}</Badge>
            <span className="text-[10px]">{issueLabels[question.issue] || question.issue}</span>
            <Badge className={`text-[10px] px-2 py-0 rounded-md ${config.bg} ${config.text} border ${config.border}`}>
              {question.severity}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">{question.prompt}</p>
        </div>
      </div>

      {!answered ? (
        <div className="flex flex-wrap gap-2 ml-8">
          {question.options.map((option, i) => (
            <Button
              key={i}
              variant="outline"
              size="sm"
              className="text-xs h-8 px-3 rounded-lg hover:border-primary hover:bg-primary/5"
              onClick={() => handleSelect(option)}
            >
              {option}
            </Button>
          ))}
        </div>
      ) : (
        <p className="text-xs text-primary ml-8 font-medium">✓ Answered: {selectedOption}</p>
      )}
    </div>
  );
};

export default QuestionCard;
