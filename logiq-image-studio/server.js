const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Supported Image Models
const IMAGE_MODELS = [
  { id: 'flux', name: 'Flux (Cinematic Realism)' },
  { id: 'turbo', name: 'Turbo (Fast Draft)' }
];

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/models', (req, res) => {
  res.json({ models: IMAGE_MODELS });
});

// Proxy route for image generation
app.post('/api/generate', async (req, res) => {
  try {
    const { prompt, model = 'flux', width = 1280, height = 720, seed } = req.body;

    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return res.status(400).json({ success: false, error: 'A valid prompt is required.' });
    }

    const cleanPrompt = prompt.trim();
    const encodedPrompt = encodeURIComponent(cleanPrompt);
    
    // Construct Pollinations URL
    const targetUrl = new URL(`https://image.pollinations.ai/prompt/${encodedPrompt}`);
    targetUrl.searchParams.append('model', model);
    targetUrl.searchParams.append('width', width.toString());
    targetUrl.searchParams.append('height', height.toString());
    targetUrl.searchParams.append('nologo', 'true');
    if (seed) {
      targetUrl.searchParams.append('seed', seed.toString());
    }

    const apiKey = process.env.POLLINATIONS_API_KEY ? process.env.POLLINATIONS_API_KEY.trim() : '';
    const headers = {};

    // Only attach Authorization header if a valid key is provided
    if (apiKey !== '') {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
    
    const response = await fetch(targetUrl.toString(), {
      method: 'GET',
      headers
    });

    if (!response.ok) {
      console.error(`Pollinations API Error: ${response.status} ${response.statusText}`);
      
      if (response.status === 402) {
        return res.status(402).json({
          success: false,
          error: 'Pollinations requires an API Key for this request tier. Add POLLINATIONS_API_KEY to your .env file.'
        });
      }

      return res.status(response.status).json({
        success: false,
        error: `Pollinations service returned error status ${response.status}`
      });
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const base64Image = `data:${contentType};base64,${buffer.toString('base64')}`;

    return res.json({
      success: true,
      imageUrl: base64Image
    });

  } catch (error) {
    console.error('Server generation error:', error.message);
    return res.status(500).json({
      success: false,
      error: error.message || 'Server failed to process image request.'
    });
  }
});

app.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(` LOGiQ Image Studio Server Running!`);
  console.log(` Local URL: http://localhost:${PORT}`);
  console.log(`==================================================`);
});