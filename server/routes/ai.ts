// server/routes/ai.ts
import { Router } from 'express';
import OpenAI from 'openai';
import * as dotenv from 'dotenv';

dotenv.config();

const router = Router();

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

// POST /api/ai/advice
router.post('/advice', async (req, res) => {
    const { question } = req.body;
    if (!question) {
        return res.status(400).json({ error: 'Question is required' });
    }
    try {
        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: question }],
            max_tokens: 300,
        });
        const answer = completion.choices[0]?.message?.content?.trim() || 'No answer';
        res.json({ answer });
    } catch (err) {
        console.error('OpenAI error', err);
        res.status(500).json({ error: 'Failed to get AI advice' });
    }
});

export default router;
