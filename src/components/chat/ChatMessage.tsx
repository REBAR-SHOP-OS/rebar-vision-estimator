import React from "react";
import ReactMarkdown from "react-markdown";
import { Bot, User } from "lucide-react";

interface ChatMessageProps {
  message: {
    role: "user" | "assistant" | "system";
    content: string;
    files?: { name: string; url: string; type: string }[];
  };
}

const ChatMessage: React.FC<ChatMessageProps> = ({ message }) => {
  const isUser = message.role === "user";

  const displayContent = message.content
    .replace(/#{1,4}\s*Section\s*2[:\s]*Structured\s*JSON\s*Block[^\n]*/gi, "")
    .replace(/#{1,4}\s*Section\s*1[:\s]*Human[- ]Readable\s*Analysis[^\n]*/gi, "")
    .replace(/%%%ATOMIC_TRUTH_JSON_START%%%.+?%%%ATOMIC_TRUTH_JSON_END%%%/gs, "")
    .replace(/%%%ATOMIC_TRUTH_JSON_START%%%[\s\S]*/g, "")
    .replace(/```json[\s\S]*?```/g, "")
    .replace(/\{[^}]*"(?:Estimation Group|Element Type|element_type|element_id|Rebar Size|bar_lines)"[\s\S]*$/gs, "")
    .replace(/```\s*```/g, "")
    .replace(/\n{3,}/g, "\n\n")
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
        {message.files && message.files.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {message.files.map((file, i) =>
              file.type.startsWith("image/") ? (
                <img
                  key={i}
                  src={file.url}
                  alt={file.name}
                  className="h-16 w-16 rounded-lg object-cover border border-border"
                />
              ) : (
                <div key={i} className="flex items-center gap-1.5 rounded-lg border border-border bg-muted px-2 py-1 text-xs text-muted-foreground">
                  📎 {file.name}
                </div>
              )
            )}
          </div>
        )}
        <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-headings:my-2 prose-headings:font-semibold prose-pre:bg-secondary prose-pre:text-secondary-foreground prose-pre:rounded-lg prose-code:text-primary prose-code:bg-primary/10 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-code:before:content-none prose-code:after:content-none prose-strong:text-foreground">
          <ReactMarkdown
            components={{
              table: ({ children }) => (
                <div className="my-3 overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-xs">{children}</table>
                </div>
              ),
              thead: ({ children }) => (
                <thead className="bg-muted/50 border-b border-border">{children}</thead>
              ),
              tbody: ({ children }) => <tbody>{children}</tbody>,
              tr: ({ children }) => (
                <tr className="border-b border-border/50 even:bg-muted/20">{children}</tr>
              ),
              th: ({ children }) => (
                <th className="px-3 py-2 text-left text-[11px] font-semibold text-muted-foreground whitespace-nowrap">{children}</th>
              ),
              td: ({ children }) => (
                <td className="px-3 py-2 text-xs text-foreground whitespace-nowrap">{children}</td>
              ),
              strong: ({ children }) => (
                <strong className="font-semibold text-foreground">{children}</strong>
              ),
              p: ({ children }) => <p className="my-1">{children}</p>,
            }}
          >
            {displayContent}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
};

export default ChatMessage;
