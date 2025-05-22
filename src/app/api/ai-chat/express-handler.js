import { ChatOpenAI } from "@langchain/openai";
import fs from 'fs/promises';
import path from 'path';
import fetch from 'node-fetch';
const cors = require('cors');

// Read the base template (sync at startup)
let baseTemplate = '';
(async () => {
  baseTemplate = await fs.readFile(path.join(process.cwd(), 'src', 'templates', 'base-email.html'), 'utf-8');
})();

async function searchUnsplash(query) {
  const accessKey = process.env.UNSPLASH_ACCESS_KEY;
  if (!accessKey) return [];
  const url = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=3&client_id=${accessKey}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  return (data.results || []).map(img => img.urls?.regular).filter(Boolean);
}

function extractHtmlFromOutput(output) {
  const codeBlockMatch = output.match(/```html[\s\n\r]*([\s\S]*?)```/i);
  if (codeBlockMatch) return codeBlockMatch[1].trim();
  const genericBlockMatch = output.match(/```[\s\n\r]*([\s\S]*?)```/i);
  if (genericBlockMatch) return genericBlockMatch[1].trim();
  const htmlBlockMatch = output.match(/(<\!DOCTYPE html[\s\S]*?<\/html>)/i) || output.match(/(<html[\s\S]*?<\/html>)/i);
  if (htmlBlockMatch) return htmlBlockMatch[1].trim();
  if (output.trim().startsWith('<!DOCTYPE html') || output.trim().startsWith('<html')) return output.trim();
  return null;
}

function stripMarkdown(text) {
  return text.replace(/```html\n|\n```/g, '');
}

async function logAgentStep({ messages, plan, emailHtml, aiMessage, htmlContent, step }) {
  const logEntry = `\n--- ${new Date().toISOString()} [${step}] ---\nRequest: ${JSON.stringify({ messages, plan, emailHtml }, null, 2)}\nResponse: ${JSON.stringify({ aiMessage, htmlContent }, null, 2)}\n`;
  await fs.appendFile(path.join(process.cwd(), 'openai_logs.txt'), logEntry);
}

export async function handleAiChat(req, res) {
  try {
    const { messages, emailHtml = baseTemplate, plan } = req.body;
    const apiKey = process.env.OPENAI_API_KEY;
    const modelName = process.env.OPENAI_MODEL_NAME || 'gpt-4o';
    const temperature = parseFloat(process.env.OPENAI_TEMPERATURE) || 0.5;
    if (!apiKey) {
      return res.status(500).json({ error: 'Missing OpenAI API key', details: 'Please check your environment variables.' });
    }
    const llm = new ChatOpenAI({
      openAIApiKey: apiKey,
      modelName: modelName,
      temperature: temperature,
      maxTokens: 4000,
      streaming: false,
    });

    // Multi-agent logic
    const sectionIdentifier = new ChatOpenAI({
      openAIApiKey: apiKey,
      modelName: modelName,
      temperature: temperature,
      maxTokens: 4000,
      streaming: false,
    });

    const sectionEditor = new ChatOpenAI({
      openAIApiKey: apiKey,
      modelName: modelName,
      temperature: temperature,
      maxTokens: 4000,
      streaming: false,
    });

    const sectionReplacer = new ChatOpenAI({
      openAIApiKey: apiKey,
      modelName: modelName,
      temperature: temperature,
      maxTokens: 4000,
      streaming: false,
    });

    // Step 1: Identify sections
    const sectionPrompt = `Analyze the following email HTML and identify the main sections. Return a JSON array of objects with 'id' and 'content' properties. Return ONLY the raw JSON, no markdown formatting or backticks. Email HTML: ${emailHtml}`;
    const sectionResponse = await sectionIdentifier.invoke(sectionPrompt);
    let sections;
    try {
      sections = JSON.parse(sectionResponse.content);
    } catch (err) {
      console.error('Failed to parse sections JSON:', err);
      return res.status(500).json({ error: 'Failed to parse sections JSON', details: err.message });
    }

    // Step 2: Edit each section
    const editedSections = await Promise.all(sections.map(async (section) => {
      const editPrompt = `Edit the following section of an email. Return only the edited HTML, no explanations. Section: ${section.content}`;
      const editResponse = await sectionEditor.invoke(editPrompt);
      return { ...section, editedContent: stripMarkdown(editResponse.content) };
    }));

    // Step 3: Replace sections in the original HTML
    const finalHtml = editedSections.reduce((html, section) => {
      return html.replace(section.content, section.editedContent);
    }, emailHtml);

    // Log the final result
    await logAgentStep({ messages, plan, emailHtml, aiMessage: finalHtml, htmlContent: finalHtml, step: 'final' });

    res.status(200).json({ aiMessage: finalHtml, htmlContent: finalHtml });
  } catch (err) {
    console.error('API Route Error:', err);
    await logAgentStep({ messages: [], plan: undefined, emailHtml: undefined, aiMessage: null, htmlContent: null, step: 'error' });
    res.status(500).json({ error: 'Failed to process your request', details: err.message, type: err.name });
  }
}

const app = require('express')();

// Allow requests from your Vercel frontend domain
app.use(cors({
  origin: 'https://email-builder-not-serverless.vercel.app', // <-- your Vercel frontend URL
  credentials: true
})); 