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
    setMessages(prev => ([...prev, { role: 'user', content: input }]));
    // Initial creation flow
    if (!emailHtml) {
      // Planning Agent
      const { result: planningData } = await addAgentStep('Planning Agent is analyzing your request...', async () => {
        const res = await fetch('/api/ai-chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: [...messages, { role: 'user', content: input }] })
        });
        if (!res.ok) {
          let errorMsg = 'Unknown error';
          try {
            const errJson = await res.json();
            errorMsg = errJson.error || JSON.stringify(errJson);
          } catch {
            errorMsg = await res.text();
          }
          throw new Error(`Planning failed: ${errorMsg}`);
        }
        return await res.json();
      });
      // If clarifying questions, show and return
      if (planningData.stage === 'planning') {
        setMessages(prev => ([...prev, { role: 'assistant', content: planningData.aiMessage }]));
        setWaiting(false);
        return;
      }
      // Creation Agent
      const { result: creationData } = await addAgentStep('Creation Agent is building your email...', async () => planningData);
      // Evaluator Agent
      const { result: evalData } = await addAgentStep('Evaluator Agent is checking the output...', async () => creationData);
      // Show final output
      setMessages(prev => ([...prev, { role: 'assistant', content: evalData.aiMessage || 'Sorry, something went wrong.' }]));
      if (evalData.htmlContent) setEmailHtml(evalData.htmlContent);
      setStage(evalData.stage || '');
      setPlan('');
      setWaiting(false);
      return;
    }
    // Edit flow
    const { result: editData } = await addAgentStep('Edit Agent is updating your template...', async () => {
      const res = await fetch('/api/ai-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [...messages, { role: 'user', content: input }], emailHtml })
      });
      if (!res.ok) {
        let errorMsg = 'Unknown error';
        try {
          const errJson = await res.json();
          errorMsg = errJson.error || JSON.stringify(errJson);
        } catch {
          errorMsg = await res.text();
        }
        throw new Error(`Edit failed: ${errorMsg}`);
      }
      return await res.json();
    });
    const { result: evalData } = await addAgentStep('Evaluator Agent is checking the output...', async () => editData);
    // Show final output
    setMessages(prev => ([...prev, { role: 'assistant', content: evalData.aiMessage || 'Sorry, something went wrong.' }]));
    if (evalData.htmlContent) setEmailHtml(evalData.htmlContent);
    setStage(evalData.stage || '');
    setPlan('');
    setWaiting(false);
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
