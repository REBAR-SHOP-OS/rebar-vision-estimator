import React from "react";
import ReactMarkdown from "react-markdown";
import { Bot, User } from "lucide-react";

interface ChatMessageProps {
  message: {
    role: "user" | "assistant" | "system";
    content: string;
  };
}

const ChatMessage: React.FC<ChatMessageProps> = ({ message }) => {
  const isUser = message.role === "user";

  const displayContent = message.content
    .replace(/#{1,4}\s*Section\s*2[:\s]*Structured\s*JSON\s*Block[^\n]*/gi, "")
    .replace(/%%%ATOMIC_TRUTH_JSON_START%%%.+?%%%ATOMIC_TRUTH_JSON_END%%%/gs, "")
    .replace(/```\s*```/g, "")
    .trim();

  return (
    <div
      className={`flex gap-3 py-4 px-3 rounded-xl transition-colors ${
        isUser ? "bg-chat-user" : "bg-chat-assistant border-l-2 border-primary/20"
      }`}
    >
      <div
        className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg ${
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-secondary text-secondary-foreground"
        }`}
      >
        {isUser ? <User className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
      </div>
      <div className="min-w-0 flex-1 text-sm leading-relaxed text-foreground pt-0.5 break-words">
        <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-0.5 prose-ul:my-0.5 prose-ol:my-0.5 prose-li:my-0 prose-headings:my-1 prose-pre:bg-secondary prose-pre:text-secondary-foreground prose-pre:rounded-lg prose-code:text-primary prose-code:bg-primary/10 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-code:before:content-none prose-code:after:content-none">
          <ReactMarkdown>{displayContent}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
};

export default ChatMessage;
