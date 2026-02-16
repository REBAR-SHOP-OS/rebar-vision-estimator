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

  // Strip Atomic Truth JSON blocks AND "Section 2" header from displayed content
  const displayContent = message.content
    .replace(/#{1,4}\s*Section\s*2[:\s]*Structured\s*JSON\s*Block[^\n]*/gi, "")
    .replace(/%%%ATOMIC_TRUTH_JSON_START%%%.+?%%%ATOMIC_TRUTH_JSON_END%%%/gs, "")
    .replace(/```\s*```/g, "")
    .trim();

  return (
    <div className={`flex gap-4 py-4 px-2 rounded-xl ${isUser ? "bg-chat-user" : "bg-chat-assistant"}`}>
      <div
        className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full ${
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-secondary text-secondary-foreground"
        }`}
      >
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>
      <div className="min-w-0 flex-1 text-sm leading-relaxed text-foreground">
        <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-headings:my-2 prose-pre:bg-secondary prose-pre:text-secondary-foreground">
          <ReactMarkdown>{displayContent}</ReactMarkdown>
        </div>
      </div>
    </div>
  );
};

export default ChatMessage;
