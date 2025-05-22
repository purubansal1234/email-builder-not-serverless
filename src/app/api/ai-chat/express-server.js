import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { handleAiChat } from './express-handler.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

app.post('/api/ai-chat', handleAiChat);

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Express server running on port ${PORT}`);
}); 