import { ChatOpenAI } from "@langchain/openai";
import fs from 'fs/promises';
import path from 'path';
import fetch from 'node-fetch';

// Read the base template
const baseTemplate = await fs.readFile(path.join(process.cwd(), 'src', 'templates', 'base-email.html'), 'utf-8');

// Unsplash image search tool
async function searchUnsplash(query) {
  const accessKey = process.env.UNSPLASH_ACCESS_KEY;
  if (!accessKey) return [];
  const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=3&client_id=${accessKey}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  return (data.results || []).map(img => img.urls?.regular).filter(Boolean);
}

// Robust HTML extraction function
function extractHtmlFromOutput(output) {
  // Match ```html ... ``` (with optional space or newline after html)
  const codeBlockMatch = output.match(/```html[\s\n\r]*([\s\S]*?)```/i);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }
  // Match generic code block ``` ... ```
  const genericBlockMatch = output.match(/```[\s\n\r]*([\s\S]*?)```/i);
  if (genericBlockMatch) {
    return genericBlockMatch[1].trim();
  }
  // Aggressively extract first <html>...</html> or <!DOCTYPE html>...</html> block
  const htmlBlockMatch = output.match(/(<\!DOCTYPE html[\s\S]*?<\/html>)/i) || output.match(/(<html[\s\S]*?<\/html>)/i);
  if (htmlBlockMatch) {
    return htmlBlockMatch[1].trim();
  }
  // Fallback: direct HTML
  if (
    output.trim().startsWith('<!DOCTYPE html') ||
    output.trim().startsWith('<html')
  ) {
    return output.trim();
  }
  return null;
}

async function logAgentStep({ messages, plan, emailHtml, aiMessage, htmlContent, step }) {
  const logEntry = `\n--- ${new Date().toISOString()} [${step}] ---\nRequest: ${JSON.stringify({ messages, plan, emailHtml }, null, 2)}\nResponse: ${JSON.stringify({ aiMessage, htmlContent }, null, 2)}\n`;
  await fs.appendFile(path.join(process.cwd(), 'openai_logs.txt'), logEntry);
}

// Evaluator agent: check if output is valid HTML and complete
async function evaluateHtml(llm, output, stepLabel, messages, plan, emailHtml) {
  // 1. Valid HTML check
  const evalPrompt1 = [
    {
      role: "system",
      content: `You are an evaluator. Check if the following text is a valid, production-ready HTML email template (starting with <!DOCTYPE html> or <html>). If it is, respond with ONLY 'HTML'. If not, respond with ONLY 'NOT_HTML'.`
    },
    {
      role: "user",
      content: `Here is the text to evaluate:\n${output}`
    }
  ];
  const evalResult1 = await llm.invoke(evalPrompt1);
  // 2. Completeness check
  const evalPrompt2 = [
    {
      role: "system",
      content: `You are an evaluator. Check if the following HTML is complete and not cut off or truncated. Does it end with a proper closing </html> tag and contain all required sections? If it is complete, respond with ONLY 'COMPLETE'. If not, respond with ONLY 'INCOMPLETE'.`
    },
    {
      role: "user",
      content: `Here is the HTML to check for completeness:\n${output}`
    }
  ];
  const evalResult2 = await llm.invoke(evalPrompt2);
  // Log both checks
  await logAgentStep({ messages, plan, emailHtml, aiMessage: `Eval1: ${evalResult1.content} | Eval2: ${evalResult2.content}`, htmlContent: null, step: stepLabel });
  return { isHtml: evalResult1.content.trim() === 'HTML', isComplete: evalResult2.content.trim() === 'COMPLETE' };
}

export async function POST(req) {
  try {
    const { messages, emailHtml, plan } = await req.json();
    const apiKey = process.env.OPENAI_API_KEY;
    const modelName = process.env.OPENAI_MODEL_NAME || 'gpt-4o';
    const temperature = parseFloat(process.env.OPENAI_TEMPERATURE) || 0.5;
    
    if (!apiKey) {
      return new Response(JSON.stringify({ 
        error: 'Missing OpenAI API key',
        details: 'Please check your .env.local file and ensure it contains OPENAI_API_KEY'
      }), { status: 500 });
    }

    // Set up the LLM with GPT-4o configuration
    const llm = new ChatOpenAI({
      openAIApiKey: apiKey,
      modelName: modelName,
      temperature: temperature,
      maxTokens: 4000,
      streaming: false,
    });

    // 1. PLANNING AGENT (for initial creation)
    if (!plan && !emailHtml) {
      // If the user request mentions images, search Unsplash and add to context
      const userText = messages.filter(m => m.role === 'user').map(m => m.content).join('\n');
      let imageUrls = [];
      if (/image|photo|picture|visual|banner|graphic/i.test(userText)) {
        const match = userText.match(/image[s]? of ([^.,;\n]+)/i);
        const query = match ? match[1] : userText;
        imageUrls = await searchUnsplash(query);
      }
      const imageContext = imageUrls.length ? `\nHere are some Unsplash image URLs you can use in your plan:\n${imageUrls.join('\n')}` : '';
      const planningPrompt = [
        {
          role: "system",
          content: `You are an expert email campaign planner. Your job is to read the user's request and the base HTML template, and decide what changes are needed to fulfill the request. If the request is vague or missing details, ask up to 3 clarifying questions (one per message, as a list or individually). If the request is clear, output a step-by-step plan as a numbered list of changes. Do not generate any HTML.\n\nBase template:\n${baseTemplate}${imageContext}`
        },
        {
          role: "user",
          content: userText
        }
      ];
      const planningResult = await llm.invoke(planningPrompt);
      // If the planning agent asks questions, return them to the user
      if (/\b(question|clarify|please specify|could you|can you)\b/i.test(planningResult.content)) {
        await logAgentStep({ messages, plan, emailHtml, aiMessage: planningResult.content, htmlContent: null, step: 'planning' });
        return new Response(JSON.stringify({
          aiMessage: planningResult.content,
          stage: 'planning',
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      // Otherwise, IMMEDIATELY proceed to creation agent with the plan
      const creationPrompt = [
        {
          role: "system",
          content: `You are an expert, world-class email template designer and conversion specialist. Your job is to create highly engaging, visually appealing, and conversion-optimized HTML email templates.\n\nYou MUST use the following HTML as your starting point. Only modify the necessary parts to fulfill the user's request and the following plan. Do NOT generate a new template from scratch. Replace only the relevant placeholders or sections, and preserve the overall structure, layout, and styles of the base template.\n\nReturn ONLY the HTML code, with no explanations, markdown, or comments. Do not include any text before or after the HTML. Output must start with <!DOCTYPE html> or <html>.\n\nHere is the base template:\n${baseTemplate}\n\nHere is the plan for changes:\n${planningResult.content}`
        },
        {
          role: "user",
          content: userText
        }
      ];
      const creationResult = await llm.invoke(creationPrompt);
      let htmlContent = extractHtmlFromOutput(creationResult.content);
      let aiMessage = '';
      if (htmlContent) {
        aiMessage = "Your template is ready! Preview it on the right.";
      } else {
        // Retry agent: stricter prompt if first output is not valid HTML
        const retryPrompt = [
          {
            role: "system",
            content: `Your last response did not contain valid HTML. You must return ONLY the HTML code for the email, with no explanations, markdown, or comments. Output must start with <!DOCTYPE html> or <html>. Do not include any text before or after the HTML.`
          },
          {
            role: "user",
            content: `Please try again. Here was your last response:\n${creationResult.content}`
          }
        ];
        const retryResult = await llm.invoke(retryPrompt);
        htmlContent = extractHtmlFromOutput(retryResult.content);
        aiMessage = htmlContent ? "Your template is ready! Preview it on the right." : retryResult.content;
        // Log both attempts for debugging
        console.log('First attempt output:', creationResult.content);
        console.log('Retry attempt output:', retryResult.content);
      }
      // Save the HTML to a file if it's valid
      if (htmlContent) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filePath = path.join(process.cwd(), 'public', 'emails', `email-${timestamp}.html`);
        await fs.mkdir(path.join(process.cwd(), 'public', 'emails'), { recursive: true });
        await fs.writeFile(filePath, htmlContent);
      }
      await logAgentStep({ messages, plan, emailHtml, aiMessage, htmlContent, step: 'creation' });
      return new Response(JSON.stringify({
        aiMessage,
        ...(htmlContent && { htmlContent }),
        stage: 'done',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 2. EDIT AGENT (multi-agent: identify, edit, replace)
    if (emailHtml) {
      await logAgentStep({ messages, plan, emailHtml, aiMessage: 'Edit agent triggered', htmlContent: null, step: 'edit-start' });
      if (!messages || messages.length === 0) {
        await logAgentStep({ messages, plan, emailHtml, aiMessage: 'No messages provided for edit', htmlContent: null, step: 'edit-error' });
        return new Response(JSON.stringify({
          error: 'No messages provided for edit',
          stage: 'edit-error'
        }), { status: 400 });
      }
      if (typeof emailHtml !== 'string') {
        await logAgentStep({ messages, plan, emailHtml, aiMessage: 'Invalid emailHtml', htmlContent: null, step: 'edit-error' });
        return new Response(JSON.stringify({
          error: 'Invalid emailHtml',
          stage: 'edit-error'
        }), { status: 400 });
      }
      const userText = messages.filter(m => m.role === 'user').map(m => m.content).join('\n');
      // 1. Section Identification Agent
      const identifyPrompt = [
        {
          role: "system",
          content: `You are an expert HTML email editor. Given the user's instruction and the current HTML, identify and extract the section(s) that need to be updated. If the entire HTML needs to be edited, return the whole HTML as a single section. For each section, provide a unique id, the original HTML, and enough before/after context to allow for safe replacement. Respond in JSON: { sections: [{ id, originalHtml, before, after }] }.`
        },
        {
          role: "user",
          content: `HTML:\n${emailHtml}\n\nInstruction:\n${userText}`
        }
      ];
      const identifyResult = await llm.invoke(identifyPrompt);
      let identifiedSections;
      try {
        identifiedSections = JSON.parse(identifyResult.content).sections;
      } catch (e) {
        // fallback: treat as whole HTML
        identifiedSections = [{ id: 'whole', originalHtml: emailHtml, before: '', after: '' }];
      }
      await logAgentStep({ messages, plan, emailHtml, aiMessage: 'Identified sections', htmlContent: JSON.stringify(identifiedSections), step: 'edit-identify' });
      // 2. Section Editing Agent
      const editedSections = [];
      for (const section of identifiedSections) {
        const editPrompt = [
          {
            role: "system",
            content: `You are an expert at editing HTML email sections. Given a section of HTML, the user's instruction, and the before/after context, generate the updated section. Ensure the new section fits seamlessly with the before and after context. If the instruction requires editing the whole HTML, return the full, complete HTML document.`
          },
          {
            role: "user",
            content: `Section:\n${section.originalHtml}\n\nBefore:\n${section.before}\n\nAfter:\n${section.after}\n\nInstruction:\n${userText}`
          }
        ];
        const newSectionResult = await llm.invoke(editPrompt);
        editedSections.push({ id: section.id, newHtml: newSectionResult.content, before: section.before, after: section.after, originalHtml: section.originalHtml });
      }
      await logAgentStep({ messages, plan, emailHtml, aiMessage: 'Edited sections', htmlContent: JSON.stringify(editedSections), step: 'edit-edit' });
      // 3. Section Replacement Agent
      let updatedHtml = emailHtml;
      let replacementError = false;
      for (const { id, newHtml, before, after, originalHtml } of editedSections) {
        // Try to replace the section using before/after context if provided, else fallback to direct replacement
        let replaced = false;
        if (before && after) {
          // Replace the section between before and after
          const beforeIdx = updatedHtml.indexOf(before);
          const afterIdx = updatedHtml.indexOf(after, beforeIdx + before.length);
          if (beforeIdx !== -1 && afterIdx !== -1) {
            updatedHtml = updatedHtml.slice(0, beforeIdx + before.length) + newHtml + updatedHtml.slice(afterIdx);
            replaced = true;
          }
        }
        if (!replaced && originalHtml && updatedHtml.includes(originalHtml)) {
          updatedHtml = updatedHtml.replace(originalHtml, newHtml);
          replaced = true;
        }
        if (!replaced) {
          replacementError = true;
          await logAgentStep({ messages, plan, emailHtml, aiMessage: `Failed to replace section id=${id}`, htmlContent: null, step: 'edit-replace-error' });
        }
      }
      if (replacementError) {
        return new Response(JSON.stringify({
          error: 'Failed to safely replace one or more sections. The edit was not applied to avoid breaking the HTML.',
          stage: 'edit-replace-error'
        }), { status: 500 });
      }
      await logAgentStep({ messages, plan, emailHtml, aiMessage: 'Final HTML after section replacement', htmlContent: updatedHtml, step: 'edit-final' });
      return new Response(JSON.stringify({
        aiMessage: "Your template is updated! Preview it on the right.",
        htmlContent: updatedHtml,
        stage: 'done',
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 2. CREATION AGENT
    const creationPrompt = [
      {
        role: "system",
        content: `You are an expert, world-class email template designer and conversion specialist. Your job is to create highly engaging, visually appealing, and conversion-optimized HTML email templates.\n\nYou MUST use the following HTML as your starting point. Only modify the necessary parts to fulfill the user's request and the following plan. Do NOT generate a new template from scratch. Replace only the relevant placeholders or sections, and preserve the overall structure, layout, and styles of the base template.\n\nReturn ONLY the HTML code, with no explanations, markdown, or comments. Do not include any text before or after the HTML. Output must start with <!DOCTYPE html> or <html>.\n\nHere is the base template:\n${baseTemplate}\n\nHere is the plan for changes:\n${plan}`
      },
      {
        role: "user",
        content: messages.filter(m => m.role === 'user').map(m => m.content).join('\n')
      }
    ];
    const creationResult = await llm.invoke(creationPrompt);
    let htmlContent = '';
    let aiMessage = '';
    htmlContent = extractHtmlFromOutput(creationResult.content);
    if (htmlContent) {
      aiMessage = "Your template is ready! Preview it on the right.";
    } else {
      // Retry agent: stricter prompt if first output is not valid HTML
      const retryPrompt = [
        {
          role: "system",
          content: `Your last response did not contain valid HTML. You must return ONLY the HTML code for the email, with no explanations, markdown, or comments. Output must start with <!DOCTYPE html> or <html>. Do not include any text before or after the HTML.`
        },
        {
          role: "user",
          content: `Please try again. Here was your last response:\n${creationResult.content}`
        }
      ];
      const retryResult = await llm.invoke(retryPrompt);
      htmlContent = extractHtmlFromOutput(retryResult.content);
      if (htmlContent) {
        aiMessage = "Your template is ready! Preview it on the right.";
      } else {
        aiMessage = retryResult.content;
      }
      // Log both attempts for debugging
      console.log('First attempt output:', creationResult.content);
      console.log('Retry attempt output:', retryResult.content);
    }
    // Save the HTML to a file if it's valid
    if (htmlContent) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filePath = path.join(process.cwd(), 'public', 'emails', `email-${timestamp}.html`);
      await fs.mkdir(path.join(process.cwd(), 'public', 'emails'), { recursive: true });
      await fs.writeFile(filePath, htmlContent);
    }
    await logAgentStep({ messages, plan, emailHtml, aiMessage, htmlContent, step: 'creation' });
    return new Response(JSON.stringify({
      aiMessage,
      ...(htmlContent && { htmlContent }),
      stage: 'done',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    console.error('API Route Error:', err);
    const messages = [];
    const plan = undefined;
    const emailHtml = undefined;
    await logAgentStep({ messages, plan, emailHtml, aiMessage: null, htmlContent: null, step: 'error' });
    return new Response(JSON.stringify({ 
      error: 'Failed to process your request',
      details: process.env.NODE_ENV === 'development' ? err.message : 'An unexpected error occurred',
      type: err.name
    }), { 
      status: 500,
      headers: {
        'Content-Type': 'application/json',
      }
    });
  }
} 