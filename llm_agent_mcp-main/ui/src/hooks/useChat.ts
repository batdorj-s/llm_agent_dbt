"use client";

import { useState, useRef, useCallback } from "react";
import type { Message, ThinkingStep } from "../components/types";
import { generateFollowUpSuggestions } from "../lib/generateFollowUpSuggestions";

export function useChat(threadId: string, isGraphicModeEnabled: boolean, onDone: () => void, token?: string) {
  const [messages, setMessages]         = useState<Message[]>([]);
  const [input, setInput]               = useState("");
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [streamEnabled, setStreamEnabled] = useState(true);
  const [lastAgentType, setLastAgentType] = useState<string | null>(null);
  const [activeRoutingState, setActiveRoutingState] = useState<"idle" | "routing" | "finance" | "tech" | "done">("idle");
  const [feedbackState, setFeedbackState] = useState<Record<string, "positive" | "negative" | null>>({});
  const [feedbackSentMsgs, setFeedbackSentMsgs] = useState<Record<string, string>>({});
  const [isOffline, setIsOffline] = useState(false);
  const [isRecovering, setIsRecovering] = useState(false);
  // #6: Dynamic follow-up suggestions
  const [dynamicSuggestions, setDynamicSuggestions] = useState<{ label: string; query: string }[]>([]);
  const lastQueryRef = useRef<string>("");

  const abortControllerRef = useRef<AbortController | null>(null);

  // #2.3: Attempt to recover partial response from server after SSE disconnect
  const attemptRecovery = useCallback(async (agentMsgId: string, partialText: string) => {
    setIsRecovering(true);
    try {
      // Wait briefly for server to finish persisting
      await new Promise(r => setTimeout(r, 2000));
      // Poll up to 3 times with backoff
      for (let attempt = 0; attempt < 3; attempt++) {
        const res = await fetch(`/api/conversations?limit=1`, {
          headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        });
        const data = await res.json();
        if (data.success && data.data?.length > 0) {
          const latest = data.data[0];
          const msgRes = await fetch(`/api/conversations/${latest.id}/messages?limit=2`, {
            headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          });
          const msgData = await msgRes.json();
          if (msgData.success && msgData.data?.length > 0) {
            const lastAssistant = [...msgData.data].reverse().find((m: { role: string }) => m.role === "assistant");
            if (lastAssistant && lastAssistant.content && lastAssistant.content.length > partialText.length) {
              // Server has the full response — replace partial
              setMessages(p => p.map(m => m.id === agentMsgId ? { ...m, text: lastAssistant.content } : m));
              setIsRecovering(false);
              return;
            }
          }
        }
        await new Promise(r => setTimeout(r, 3000 * (attempt + 1)));
      }
    } catch { /* recovery is best-effort */ }
    setIsRecovering(false);
    // If recovery failed, keep the partial text and mark connection lost
    setMessages(p => p.map(m => m.id === agentMsgId ? {
      ...m,
      text: m.text + "\n\n*Холболт тасарсан. Дахин оролдохын тулд зүүн дээрх товчийг дарна уу.*",
    } : m));
  }, [token]);

  // #17: Monitor online/offline status
  const checkOnline = useCallback(() => {
    if (typeof navigator !== "undefined") {
      setIsOffline(!navigator.onLine);
    }
  }, []);

  // Register online/offline listeners once
  const listenersRegistered = useRef(false);
  if (typeof window !== "undefined" && !listenersRegistered.current) {
    listenersRegistered.current = true;
    window.addEventListener("online", checkOnline);
    window.addEventListener("offline", checkOnline);
    checkOnline();
  }

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
    lastQueryRef.current = query;

    const userMsg: Message = { id: `user_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, sender: "user", text: query, timestamp: new Date() };
    setMessages(p => [...p, userMsg]);
    setIsChatLoading(true);
    setActiveRoutingState("routing");

    const agentMsgId = `agent_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    setMessages(p => [...p, { id: agentMsgId, sender: "agent", text: "", timestamp: new Date(), agentName: "Шинжээч.ai" }]);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      if (streamEnabled) {
        const response = await fetch("/api/chat/stream", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { "Authorization": `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ message: query, threadId, visualRequest: isGraphicModeEnabled }),
          signal: controller.signal,
        });
        if (!response.ok) { const err = await response.json(); throw new Error(err.error || "Failed to initiate agent stream"); }

        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        if (!reader) throw new Error("Response body is not readable");

        let buffer = "", fullResponse = "";
        let gotDoneEvent = false;

        // #2.3: Inactivity timeout — abort if no data for 60s
        const INACTIVITY_MS = 60_000;
        let inactivityTimer: ReturnType<typeof setTimeout> = setTimeout(() => controller.abort(), INACTIVITY_MS);
        const resetInactivity = () => {
          clearTimeout(inactivityTimer);
          inactivityTimer = setTimeout(() => controller.abort(), INACTIVITY_MS);
        };
        resetInactivity();

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          resetInactivity();
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            if (!line.trim().startsWith("data: ")) continue;
            const jsonStr = line.replace("data: ", "").trim();
            // #12: Skip SSE heartbeat comments
            if (!jsonStr || jsonStr.startsWith(":")) continue;
            try {
              const data = JSON.parse(jsonStr);
              if (data.type === "delta") {
                fullResponse += data.chunk;
                // #13: Use server-sent agent metadata when available
                let detectedAgent = data.agent || "Шинжээч.ai";
                let nodeState: typeof activeRoutingState = "routing";
                if (data.agent) {
                  if (data.agent === "FinanceAgent")      { detectedAgent = "Finance Agent";      nodeState = "finance"; }
                  else if (data.agent === "TechAgent")    { detectedAgent = "Tech Agent";         nodeState = "tech"; }
                  else if (data.agent === "DataScientist") { detectedAgent = "DataScientistAgent"; nodeState = "tech"; }
                  else if (data.agent === "Security")      { detectedAgent = "Security Manager";   nodeState = "idle"; }
                } else {
                  // Fallback to string matching
                  if (fullResponse.includes("(Finance Agent)"))     { detectedAgent = "Finance Agent";      nodeState = "finance"; }
                  else if (fullResponse.includes("(Tech Agent)"))   { detectedAgent = "Tech Agent";         nodeState = "tech"; }
                  else if (fullResponse.includes("Security Alert")) { detectedAgent = "Security Manager";   nodeState = "idle"; }
                }
                setActiveRoutingState(nodeState);
                setLastAgentType(detectedAgent);
                setMessages(p => p.map(m => m.id === agentMsgId ? { ...m, text: fullResponse, agentName: detectedAgent } : m));
              } else if (data.type === "agent") {
                // #13: Dedicated agent metadata event
                const agentMap: Record<string, { name: string; state: typeof activeRoutingState }> = {
                  "FinanceAgent": { name: "Finance Agent", state: "finance" },
                  "TechAgent": { name: "Tech Agent", state: "tech" },
                  "DataScientist": { name: "DataScientistAgent", state: "tech" },
                  "Security": { name: "Security Manager", state: "idle" },
                };
                const info = agentMap[data.agent] || { name: data.agent, state: "routing" as const };
                setActiveRoutingState(info.state);
                setLastAgentType(info.name);
                setMessages(p => p.map(m => m.id === agentMsgId ? { ...m, agentName: info.name } : m));
              } else if (data.type === "done") {
                gotDoneEvent = true;
                setActiveRoutingState("done");
                // #6: Generate dynamic follow-up suggestions from last query + full response
                const suggestions = generateFollowUpSuggestions(lastQueryRef.current, fullResponse, lastAgentType);
                setDynamicSuggestions(suggestions);
                onDone();
              } else if (data.type === "thinking") {
                const step: ThinkingStep = { step: data.step, agent: data.agent, message: data.message, timestamp: new Date() };
                setMessages(p => p.map(m => m.id === agentMsgId ? { ...m, thinkingSteps: [...(m.thinkingSteps || []), step] } : m));
              } else if (data.type === "error") {
                throw new Error(data.error || "Streaming error occurred");
              }
            } catch (parseErr) {
              // #17: Don't silently swallow parse errors
              if (parseErr instanceof SyntaxError) {
                console.warn("[Chat] SSE parse error, skipping line:", jsonStr.slice(0, 100));
              }
            }
          }
        }

        clearTimeout(inactivityTimer);

        // #2.3: If stream ended without a `done` event and we have partial text, attempt recovery
        if (!gotDoneEvent && fullResponse.length > 0) {
          attemptRecovery(agentMsgId, fullResponse);
        }
      } else {
        // #15: Fix non-streaming path to show actual response
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { "Authorization": `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ message: query, threadId, visualRequest: isGraphicModeEnabled }),
          signal: controller.signal,
        });
        if (!res.ok) { const err = await res.json(); throw new Error(err.error || "Failed to get agent response"); }
        const data = await res.json();
        const responseText = data.response || "Хариу байхгүй.";
        setMessages(p => p.map(m => m.id === agentMsgId ? { ...m, text: responseText, agentName: "Шинжээч.ai" } : m));
        setActiveRoutingState("done");
        // #6: Generate dynamic follow-up suggestions
        const suggestions = generateFollowUpSuggestions(lastQueryRef.current, responseText, lastAgentType);
        setDynamicSuggestions(suggestions);
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
      // #10: User-friendly error messages
      let errorMessage = e instanceof Error ? e.message : "Алдаа гарлаа.";
      if (errorMessage.includes("429") || errorMessage.toLowerCase().includes("rate limit") || errorMessage.toLowerCase().includes("too many")) {
        errorMessage = "Хэт олон хүсэлт илгээлээ. Түр хүлээгээд дахин оролдоно уу.";
      }
      setActiveRoutingState("idle");
      setMessages(p => p.map(m => m.id === agentMsgId ? { ...m, text: errorMessage, agentName: "System Error Handler", isError: true } : m));
    } finally {
      setIsChatLoading(false);
      abortControllerRef.current = null;
    }
  };

  // #1: Retry failed message — uses ref to avoid stale closure
  const handleRetry = useCallback((messageId: string) => {
    setMessages(p => {
      const msgIndex = p.findIndex(m => m.id === messageId);
      if (msgIndex < 0) return p;
      let userMsgText = "";
      for (let i = msgIndex - 1; i >= 0; i--) {
        if (p[i].sender === "user") { userMsgText = p[i].text; break; }
      }
      if (!userMsgText) return p;
      const newMessages = p.filter(m => m.id !== messageId);
      // Use queueMicrotask to run after state update completes
      queueMicrotask(() => handleSendMessage(undefined, userMsgText));
      return newMessages;
    });
  }, [isChatLoading]);

  const handleCancelMessage = () => { abortControllerRef.current?.abort(); };

  // #7: Fix stale closure — use ref-based message lookup
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const handleFeedback = async (msgId: string, rating: "positive" | "negative") => {
    if (feedbackState[msgId]) return;
    setFeedbackState(p => ({ ...p, [msgId]: rating }));
    const msgs = messagesRef.current;
    const msgIndex = msgs.findIndex(m => m.id === msgId);
    const agentMsg = msgs[msgIndex];
    const userMsg  = msgIndex > 0 ? msgs.slice(0, msgIndex).reverse().find(m => m.sender === "user") : null;
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { "Authorization": `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ message: userMsg?.text || agentMsg?.text || "", response: agentMsg?.text || "", rating, threadId }),
      });
      if (!res.ok) { setFeedbackState(p => ({ ...p, [msgId]: null })); return; }
      const icon = rating === "positive" ? "✓" : "✗";
      setFeedbackSentMsgs(p => ({ ...p, [msgId]: icon }));
      setTimeout(() => setFeedbackSentMsgs(p => { const n = { ...p }; delete n[msgId]; return n; }), 2000);
    } catch { setFeedbackState(p => ({ ...p, [msgId]: null })); }
  };

  const addSystemMessage = (text: string, agentName?: string) => {
    setMessages(p => [...p, {
      id: `hist_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      sender: "agent",
      text,
      timestamp: new Date(),
      agentName: agentName || "Шинжээч.ai",
    }]);
  };

  const addUserMessage = (text: string) => {
    setMessages(p => [...p, {
      id: `hist_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      sender: "user",
      text,
      timestamp: new Date(),
    }]);
  };

  // #3: Regenerate response — remove agent message and resend the user query
  const handleRegenerate = useCallback((messageId: string) => {
    setMessages(p => {
      const msgIndex = p.findIndex(m => m.id === messageId);
      if (msgIndex < 0) return p;
      let userMsgText = "";
      for (let i = msgIndex - 1; i >= 0; i--) {
        if (p[i].sender === "user") { userMsgText = p[i].text; break; }
      }
      if (!userMsgText) return p;
      const newMessages = p.filter(m => m.id !== messageId);
      queueMicrotask(() => handleSendMessage(undefined, userMsgText));
      return newMessages;
    });
  }, [isChatLoading]);

  // #3: Stop & Regenerate — abort current stream, then resend last query
  const handleStopAndRegenerate = useCallback(() => {
    const lastQuery = lastQueryRef.current;
    abortControllerRef.current?.abort();
    if (lastQuery) {
      queueMicrotask(() => handleSendMessage(undefined, lastQuery));
    }
  }, [isChatLoading]);

  // #4: Export conversation as Markdown
  const exportConversation = useCallback((format: "md" | "txt" = "md") => {
    const lines: string[] = [];
    const divider = format === "md" ? "---" : "========================";
    for (const msg of messages) {
      const time = msg.timestamp.toLocaleString("mn-MN");
      const sender = msg.sender === "user" ? "Хэрэглэгч" : (msg.agentName || "Шинжээч.ai");
      if (format === "md") {
        lines.push(`### ${sender} (${time})`);
        lines.push("");
        lines.push(msg.text);
        lines.push("");
        lines.push(divider);
        lines.push("");
      } else {
        lines.push(`[${time}] ${sender}:`);
        lines.push(msg.text);
        lines.push("");
      }
    }
    const blob = new Blob([lines.join("\n")], { type: format === "md" ? "text/markdown" : "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `shinjech-chat-${new Date().toISOString().slice(0, 10)}.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  }, [messages]);

  return {
    messages, input, setInput, isChatLoading, streamEnabled, setStreamEnabled,
    lastAgentType, activeRoutingState, feedbackState, feedbackSentMsgs, isOffline, isRecovering,
    dynamicSuggestions,
    handleSendMessage, handleCancelMessage, handleFeedback, handleRetry,
    handleRegenerate, handleStopAndRegenerate,
    addWelcomeMessage, clearMessages, addSystemMessage, addUserMessage,
    exportConversation,
  };
}
