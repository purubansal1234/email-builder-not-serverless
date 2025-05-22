const fetch = require('node-fetch');

async function testEmailAgent() {
  const url = 'http://localhost:3000/api/ai-chat';
  const initialPrompt = 'Create a promotional email for a summer sale.';
  let messages = [
    { role: 'user', content: initialPrompt }
  ];
  let plan = '';
  let stage = '';
  let emailHtml = '';

  // Step 1: Initial request
  let res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages })
  });
  let data = await res.json();
  console.log('Step 1 Response:', data);
  stage = data.stage;
  plan = data.plan;

  // Step 2: If plan-confirm, send 'continue' with the plan
  if (stage === 'plan-confirm' && plan) {
    messages.push({ role: 'assistant', content: data.aiMessage });
    messages.push({ role: 'assistant', content: plan });
    messages.push({ role: 'user', content: 'continue' });
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, plan, emailHtml })
    });
    data = await res.json();
    console.log('Step 2 Response:', data);
    if (data.htmlContent) {
      console.log('✅ HTML content generated!');
    } else {
      console.log('❌ No HTML content in final response.');
    }
  } else if (data.htmlContent) {
    console.log('✅ HTML content generated in first step!');
  } else {
    console.log('❌ No HTML content and no plan returned.');
  }
}

testEmailAgent().catch(console.error); 