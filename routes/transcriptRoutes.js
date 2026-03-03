import express from 'express';
import { transcribeYoutubeUrl } from '../services/youtubeTranscription.service.ts';

const router = express.Router();

router.post('/transcript', async (req, res) => {
  try {
    const { url } = req.body || {};
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'Invalid URL. Provide a valid URL string.' });
    }

    const transcript = await transcribeYoutubeUrl(url);
    return res.json({ transcript });
  } catch (error) {
    console.error('[Transcript] Error:', error);
    return res.status(500).json({ error: error.message || 'Failed to fetch transcript' });
  }
});

export default router;
