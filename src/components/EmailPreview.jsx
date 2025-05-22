import React from 'react';

const EmailPreview = ({ content }) => {
  return (
    <div className="h-full bg-white rounded-lg shadow p-4 overflow-y-auto">
      <h2 className="text-lg font-semibold mb-4">Email Preview</h2>
      <div 
        className="prose max-w-none"
        dangerouslySetInnerHTML={{ __html: content || '<div style="color:#bbb;">No email HTML yet.</div>' }}
      />
    </div>
  );
};

export default EmailPreview; 