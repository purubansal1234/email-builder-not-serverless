'use client';
import React, { useState, useRef } from 'react';
import ChatPanel from '../components/ChatPanel';
import EmailPreview from '../components/EmailPreview';

export default function Home() {
  // State for chat messages
  const [messages, setMessages] = useState([
    { role: 'assistant', content: 'Hi! I\'m your email template builder AI. What kind of email would you like to create today?' }
  ]);
  // State for HTML preview
  const [emailHtml, setEmailHtml] = useState('');
  // State for the current plan (if any)
  const [plan, setPlan] = useState('');
  // State for the current stage (planning, plan-confirm, done)
  const [stage, setStage] = useState('');
  const [waiting, setWaiting] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const [responseTimes, setResponseTimes] = useState<number[]>([]); // Array of seconds for each assistant message
  const [isLoading, setIsLoading] = useState(false);

  // Timer effect
  React.useEffect(() => {
    if (waiting) {
      timerRef.current = setInterval(() => setElapsed(e => e + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      setElapsed(0);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [waiting]);

  // Helper to add a system message and record its time
  const addAgentStep = async (msg: string, fn: () => Promise<any>) => {
    setMessages(prev => ([...prev, { role: 'system', content: msg }]));
    setWaiting(true);
    setElapsed(0);
    const start = Date.now();
    const result = await fn();
    const seconds = Math.round((Date.now() - start) / 1000);
    setMessages(prev => ([...prev, { role: 'system', content: `${msg} (⏱️ ${seconds}s)` }]));
    setWaiting(false);
    return { result, seconds };
  };

  /**
   * Handles sending a message to the backend and updating state.
   * @param {string} input
   */
  const handleSend = async (input: string) => {
    if (!input.trim()) return;
    setMessages(prev => [...prev, { role: 'user', content: input }]);
    setIsLoading(true);
    try {
      const response = await fetch('https://email-builder-not-serverless.onrender.com/api/ai-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [...messages, { role: 'user', content: input }], emailHtml, plan }),
      });
      let data;
      let isJson = false;
      try {
        data = await response.json();
        isJson = true;
      } catch {
        data = await response.text();
      }
      if (!response.ok) {
        const errorMsg = isJson && data.error ? data.error : (typeof data === 'string' ? data : 'Unknown error');
        setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${errorMsg}` }]);
      } else {
        setMessages(prev => [...prev, { role: 'assistant', content: isJson && data.aiMessage ? data.aiMessage : (typeof data === 'string' ? data : 'No response from server') }]);
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred';
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${errorMessage}` }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="flex h-screen w-screen bg-gradient-to-r from-pink-100 to-blue-100 p-6">
      <div className="flex flex-col w-2/5 h-full pr-3">
        <ChatPanel messages={messages} onSend={handleSend} waiting={waiting} elapsed={elapsed} responseTimes={responseTimes} />
      </div>
      <div className="flex flex-col w-3/5 h-full pl-3">
        <EmailPreview content={emailHtml} />
      </div>
    </main>
  );
}
