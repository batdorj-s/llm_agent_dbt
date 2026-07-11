"use client";

import { useState, useRef } from "react";
import type { Message } from "../components/types";

export function useChat(threadId: string, isGraphicModeEnabled: boolean, onDone: () => void) {
  const [messages, setMessages]         = useState<Message[]>([]);
  const [input, setInput]               = useState("");
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [streamEnabled, setStreamEnabled] = useState(true);
  const [lastAgentType, setLastAgentType] = useState<string | null>(null);
  const [activeRoutingState, setActiveRoutingState] = useState<"idle" | "routing" | "finance" | "tech" | "done">("idle");
  const [feedbackState, setFeedbackState] = useState<Record<string, "positive" | "negative" | null>>({});
  const [feedbackSentMsgs, setFeedbackSentMsgs] = useState<Record<string, string>>({});

  const abortControllerRef = useRef<AbortController | null>(null);

  const addWelcomeMessage = () => {
    setMessages([{
      id: "welcome", sender: "agent", timestamp: new Date(), agentName: "Шинжээч.ai",
      text: "Сайн уу? Би **Шинжээч.ai** — таны өгөгдлийн шинжилгээний туслах. Надаас дата шинжилгээ, forecast, dashboard, эсвэл ерөнхий асуулт асууж болно.",
    }]);
  };

  const clearMessages = () => setMessages([]);

  const handleSendMessage = async (e?: React.FormEvent, customInput?: string) => {
    if (e) e.preventDefault();
    const query = customInput || input;
    if (!query.trim() || isChatLoading) return;
    if (!customInput) setInput("");

    const userMsg: Message = { id: `user_${Date.now()}`, sender: "user", text: query, timestamp: new Date() };
    setMessages(p => [...p, userMsg]);
    setIsChatLoading(true);
    setActiveRoutingState("routing");

    const agentMsgId = `agent_${Date.now()}`;
    setMessages(p => [...p, { id: agentMsgId, sender: "agent", text: "", timestamp: new Date(), agentName: "Шинжээч.ai" }]);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      if (streamEnabled) {
        const response = await fetch("/api/chat/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: query, threadId, visualRequest: isGraphicModeEnabled }),
          signal: controller.signal,
        });
        if (!response.ok) { const err = await response.json(); throw new Error(err.error || "Failed to initiate agent stream"); }

        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        if (!reader) throw new Error("Response body is not readable");

        let buffer = "", fullResponse = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            if (!line.trim().startsWith("data: ")) continue;
            const jsonStr = line.replace("data: ", "").trim();
            try {
              const data = JSON.parse(jsonStr);
              if (data.type === "delta") {
                fullResponse += data.chunk;
                let detectedAgent = "Шинжээч.ai";
                let nodeState: typeof activeRoutingState = "routing";
                if (fullResponse.includes("(Finance Agent)"))     { detectedAgent = "Finance Agent";      nodeState = "finance"; }
                else if (fullResponse.includes("(Tech Agent)"))   { detectedAgent = "Tech Agent";         nodeState = "tech"; }
                else if (fullResponse.includes("Security Alert")) { detectedAgent = "Security Manager";   nodeState = "idle"; }
                setActiveRoutingState(nodeState);
                setLastAgentType(detectedAgent);
                setMessages(p => p.map(m => m.id === agentMsgId ? { ...m, text: fullResponse, agentName: detectedAgent } : m));
              } else if (data.type === "done") {
                setActiveRoutingState("done");
                onDone();
              } else if (data.type === "error") {
                throw new Error(data.error || "Streaming error occurred");
              }
            } catch {}
          }
        }
      } else {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: query, threadId, visualRequest: isGraphicModeEnabled }),
          signal: controller.signal,
        });
        if (!res.ok) { const err = await res.json(); throw new Error(err.error || "Failed to get agent response"); }
        await res.json();
        setMessages(p => p.map(m => m.id === agentMsgId ? { ...m, text: "Execution complete.", agentName: "Agent System" } : m));
        setActiveRoutingState("done");
        onDone();
      }
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === "AbortError") {
        setActiveRoutingState("idle");
        setMessages(p => {
          const last = p[p.length - 1];
          return last?.sender === "agent"
            ? p.map(m => m.id === last.id ? { ...m, text: (m.text ? m.text + "\n\n" : "") + "*Хүсэлтийг цуцаллаа.*" } : m)
            : p;
        });
        return;
      }
      const errorMessage = e instanceof Error ? e.message : "An error occurred.";
      setActiveRoutingState("idle");
      setMessages(p => p.map(m => m.id === agentMsgId ? { ...m, text: errorMessage, agentName: "System Error Handler", isError: true } : m));
    } finally {
      setIsChatLoading(false);
      abortControllerRef.current = null;
    }
  };

  const handleCancelMessage = () => { abortControllerRef.current?.abort(); };

  const handleFeedback = async (msgId: string, rating: "positive" | "negative") => {
    if (feedbackState[msgId]) return;
    setFeedbackState(p => ({ ...p, [msgId]: rating }));
    const msgIndex = messages.findIndex(m => m.id === msgId);
    const agentMsg = messages[msgIndex];
    const userMsg  = msgIndex > 0 ? messages.slice(0, msgIndex).reverse().find(m => m.sender === "user") : null;
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMsg?.text || agentMsg?.text || "", response: agentMsg?.text || "", rating, threadId }),
      });
      if (!res.ok) { setFeedbackState(p => ({ ...p, [msgId]: null })); return; }
      const icon = rating === "positive" ? "✓" : "✗";
      setFeedbackSentMsgs(p => ({ ...p, [msgId]: icon }));
      setTimeout(() => setFeedbackSentMsgs(p => { const n = { ...p }; delete n[msgId]; return n; }), 2000);
    } catch { setFeedbackState(p => ({ ...p, [msgId]: null })); }
  };

  return {
    messages, input, setInput, isChatLoading, streamEnabled, setStreamEnabled,
    lastAgentType, activeRoutingState, feedbackState, feedbackSentMsgs,
    handleSendMessage, handleCancelMessage, handleFeedback,
    addWelcomeMessage, clearMessages,
  };
}
