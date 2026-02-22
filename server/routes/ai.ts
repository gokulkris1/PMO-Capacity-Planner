// server/routes/ai.ts
import { Router } from 'express';
import { Configuration, OpenAIApi } from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const router = Router();

const configuration = new Configuration({
    apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

// POST /api/ai/advice
router.post('/advice', async (req, res) => {
    const { question } = req.body;
    if (!question) {
        return res.status(400).json({ error: 'Question is required' });
    }
    try {
        const completion = await openai.createChatCompletion({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: question }],
            max_tokens: 300,
        });
        const answer = completion.data.choices?.[0]?.message?.content?.trim() || 'No answer';
        res.json({ answer });
    } catch (err) {
        console.error('OpenAI error', err);
        res.status(500).json({ error: 'Failed to get AI advice' });
    }
});

export default router;
