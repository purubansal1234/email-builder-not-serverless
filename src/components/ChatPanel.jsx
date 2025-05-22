import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';

/**
 * @typedef {Object} ChatPanelProps
 * @property {Array} messages
 * @property {Function} onSend
 * @property {boolean} [waiting]
 * @property {number} [elapsed]
 * @property {number[]} [responseTimes]
 */

/**
 * @param {ChatPanelProps} props
 */
const ChatPanel = ({ messages, onSend, waiting = false, elapsed = 0, responseTimes = [] }) => {
  const [input, setInput] = useState('');

  const handleSend = () => {
    if (input.trim()) {
      onSend(input);
      setInput('');
    }
  };

  return (
    <div className="flex flex-col h-full bg-white rounded-lg shadow p-4">
      {waiting && (
        <div className="text-center text-sm text-gray-500 mb-2">Waiting for agent... <span className="font-mono">{elapsed}s</span></div>
      )}
      <div className="flex-1 overflow-y-auto mb-2">
        {messages.map((msg, idx) => (
          <div key={idx} className={`mb-2 ${msg.role === 'user' ? 'text-right' : 'text-left'}`}> 
            {msg.role === 'assistant' ? (
              <>
                <span className="inline-block px-3 py-2 rounded-lg bg-gray-100 text-gray-800 prose max-w-none">
                  <ReactMarkdown>{msg.content}</ReactMarkdown>
                </span>
                {responseTimes[idx] > 0 && (
                  <div className="text-xs text-gray-400 mt-1">⏱️ {responseTimes[idx]}s</div>
                )}
              </>
            ) : (
              <span className="inline-block px-3 py-2 rounded-lg bg-blue-100 text-blue-800">{msg.content}</span>
            )}
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          className="flex-1 border rounded px-3 py-2 focus:outline-none focus:ring text-black"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSend()}
          placeholder="Type your message..."
        />
        <button
          className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600"
          onClick={handleSend}
        >
          Send
        </button>
      </div>
    </div>
  );
};

export default ChatPanel; 