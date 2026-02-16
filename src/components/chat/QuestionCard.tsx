import React, { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HelpCircle } from "lucide-react";

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

const severityColors: Record<string, string> = {
  LOW: "bg-muted text-muted-foreground",
  MED: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  HIGH: "bg-destructive/10 text-destructive",
  BLOCKING: "bg-destructive text-destructive-foreground",
};

const issueLabels: Record<string, string> = {
  CONFLICT: "⚔️ Conflict",
  LOW_CONFIDENCE: "📉 Low Confidence",
  MISSING: "❓ Missing",
};

const QuestionCard: React.FC<QuestionCardProps> = ({ question, onAnswer }) => {
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [answered, setAnswered] = useState(false);

  const handleSelect = (option: string) => {
    setSelectedOption(option);
    setAnswered(true);
    onAnswer?.(question.element_id, question.field, option);
  };

  return (
    <div className={`p-3 rounded-lg border ${answered ? "border-primary/30 bg-primary/5" : "border-amber-500/30 bg-amber-500/5"}`}>
      <div className="flex items-start gap-2 mb-2">
        <HelpCircle className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-xs font-semibold text-foreground">{question.element_id}</span>
            <Badge variant="outline" className="text-[10px]">{question.field}</Badge>
            <span className="text-[10px]">{issueLabels[question.issue] || question.issue}</span>
            <Badge className={`text-[10px] px-1.5 py-0 ${severityColors[question.severity]}`}>
              {question.severity}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">{question.prompt}</p>
        </div>
      </div>

      {!answered ? (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {question.options.map((option, i) => (
            <Button
              key={i}
              variant="outline"
              size="sm"
              className="text-xs h-7 px-2.5"
              onClick={() => handleSelect(option)}
            >
              {option}
            </Button>
          ))}
        </div>
      ) : (
        <p className="text-xs text-primary mt-1">✓ Answered: {selectedOption}</p>
      )}
    </div>
  );
};

export default QuestionCard;
