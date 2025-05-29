// app.js
const express = require('express');
const axios = require('axios');
const cors = require('cors'); // Add this dependency
const app = express();
const snapsaveDownloader = require('./snapsave-downloader'); // The modified obfuscated downloader
const { v4: uuidv4 } = require('uuid');
const port = process.env.PORT || 3000;

const mediaStore = {}; // In-memory store, consider Redis/DB for production

let BASE_URL = `http://localhost:${port}`;
if (process.env.NODE_ENV === 'production' && process.env.PUBLIC_URL) {
    BASE_URL = process.env.PUBLIC_URL;
} else if (process.env.KOYEB_APP_URL) { // Koyeb sets this
    BASE_URL = `https://${process.env.KOYEB_APP_URL}`; // Koyeb provides domain, ensure https
} else if (process.env.RENDER_EXTERNAL_URL) { // Render.com sets this
    BASE_URL = process.env.RENDER_EXTERNAL_URL;
}
console.log(`Using BASE_URL: ${BASE_URL}`);

// CORS Configuration - Enable for all origins (adjust as needed for production)
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // Allow all origins for development/testing (modify for production)
    callback(null, true);
  },
  credentials: true,
  optionsSuccessStatus: 200, // Some legacy browsers choke on 204
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept']
};

app.use(cors(corsOptions));

// Handle preflight requests for all routes
app.options('*', cors(corsOptions));

// Parse JSON bodies
app.use(express.json());

// Add additional CORS headers manually as backup
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  
  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
    return;
  }
  
  next();
});

app.get('/', (req, res) => {
  res.json({
    message: 'VibeDownloader.me API - Instagram Downloader',
    status: 'active',
    author: 'Naeem', // Optional: Add your name
    usage: {
        download: `${BASE_URL}/api/data?url=INSTAGRAM_POST_OR_REEL_URL`,
        example_reel: `${BASE_URL}/api/data?url=https://www.instagram.com/reel/C2sOu0sy02A/`,
        // Story downloads are generally less reliable with such scrapers
        // example_story_user: `${BASE_URL}/api/data?url=https://www.instagram.com/stories/instagram/`,
    }
  });
});

app.get('/api/data', async (req, res) => {
  try {
    const url = req.query.url;

    if (!url) {
      return res.status(400).json({ success: false, error: 'URL parameter is missing' });
    }

    try {
        new URL(url);
        if (!url.includes('instagram.com/')) { // Basic check for instagram URL
            return res.status(400).json({ success: false, error: 'Invalid Instagram URL provided.' });
        }
    } catch (e) {
        return res.status(400).json({ success: false, error: 'Invalid URL format.' });
    }

    console.log(`Processing Instagram URL: ${url}`);
    const result = await snapsaveDownloader(url);

    if (!result || !result.status) {
      const errorMessage = result && result.msg ? result.msg : 'Failed to process the URL or no media found.';
      return res.status(404).json({ success: false, error: errorMessage });
    }

    // Username and title are now expected from the downloader's result
    const username = result.username || 'unknown_user';
    // Ensure title is a string, even if it's empty, then default
    let postTitle = (typeof result.title === 'string' ? result.title.trim() : '') || 'Instagram_Media';
    // Further sanitize title for filename, max 50 chars for title part
    postTitle = postTitle.substring(0, 50).replace(/[^\w\s.-_]/g, '').replace(/\s+/g, '_');
    if (!postTitle) postTitle = 'media';

    const responseMedia = [];

    if (!result.data || result.data.length === 0) {
        return res.status(404).json({ success: false, error: 'No downloadable media links found by the provider.' });
    }

    for (const item of result.data) {
      if (!item.url) continue;

      const mediaId = uuidv4();
      let mediaType = 'unknown';
      let extension = 'bin'; // Default extension

      // Infer media type (video/image)
      const qualityString = item.quality || item.type || ''; // 'item.type' might be quality like "HD", "SD"
      
      if (item.url.includes('.mp4') || qualityString.toLowerCase().includes('video')) {
        mediaType = 'video';
        extension = 'mp4';
      } else if (item.url.includes('.jpg') || item.url.includes('.jpeg') || qualityString.toLowerCase().includes('photo') || qualityString.toLowerCase().includes('image')) {
        mediaType = 'image';
        extension = 'jpg';
      } else {
        // Fallback: try to guess from URL if quality string is not helpful
        if (item.url.match(/\.(mp4|mov|avi|mkv)/i)) {
             mediaType = 'video'; extension = item.url.match(/\.(mp4|mov|avi|mkv)/i)[1].toLowerCase();
        } else if (item.url.match(/\.(jpg|jpeg|png|gif|webp)/i)) {
             mediaType = 'image'; extension = item.url.match(/\.(jpg|jpeg|png|gif|webp)/i)[1].toLowerCase();
        }
      }

      // Filename: VibeDownloader.me - {title}.ext
      const filename = `VibeDownloader.me - ${postTitle}.${extension}`;

      mediaStore[mediaId] = {
        actualUrl: item.url,
        filename: filename,
        contentType: mediaType === 'video' ? `video/${extension === 'jpg' ? 'mp4' : extension}` : `image/${extension === 'mp4' ? 'jpeg' : extension}`, // Adjust content type based on actual extension
      };
      
      // Clean up store after 1 hour
      setTimeout(() => {
        delete mediaStore[mediaId];
      }, 3600 * 1000);

      responseMedia.push({
        type: mediaType,
        quality: qualityString || 'Standard',
        url: item.url, // Provide the direct URL as well
        thumbnail: item.thumbnail || null,
      });
    }

    if (responseMedia.length === 0) {
        return res.status(404).json({ success: false, error: 'Could not prepare any media for download from the provided links.' });
    }

    res.json({
      success: true,
      developer: "Naeem", // Your name
      username: username,
      title: result.title || 'Instagram Content', // The original title from downloader
      media: responseMedia,
    });

  } catch (err) {
    console.error('Error in /api/data endpoint:', err, err.stack);
    res.status(500).json({ success: false, error: 'Internal Server Error', details: err.message });
  }
});

app.get('/api/media/stream/:id', async (req, res) => {
  try {
    const mediaId = req.params.id;
    const mediaInfo = mediaStore[mediaId];

    if (!mediaInfo) {
      return res.status(404).json({ error: 'Media not found or link expired.' });
    }

    const safeFilename = encodeURIComponent(mediaInfo.filename)
        .replace(/'/g, '%27')
        .replace(/\(/g, '%28')
        .replace(/\)/g, '%29')
        .replace(/\*/g, '%2A');

    console.log(`Streaming media from URL: ${mediaInfo.actualUrl}`);
    
    // Enhanced axios configuration for better reliability
    const axiosConfig = {
      method: 'get',
      url: mediaInfo.actualUrl,
      responseType: 'stream',
      timeout: 30000, // 30 second timeout
      maxRedirects: 5,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'cross-site',
        'Referer': 'https://www.instagram.com/',
        'Origin': 'https://www.instagram.com'
      },
      validateStatus: function (status) {
        return status >= 200 && status < 400; // Accept 2xx and 3xx status codes
      }
    };

    const response = await axios(axiosConfig);
    
    // Check for redirect and get final URL if needed (some CDNs might redirect)
    if (response.request.res && response.request.res.responseUrl && response.request.res.responseUrl !== mediaInfo.actualUrl) {
        console.log(`Redirected from ${mediaInfo.actualUrl} to ${response.request.res.responseUrl}`);
    }

    // Set proper headers for download
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
    res.setHeader('Content-Type', mediaInfo.contentType);
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    
    if (response.headers['content-length']) {
        res.setHeader('Content-Length', response.headers['content-length']);
    }
    
    // Handle stream errors
    response.data.on('error', (streamError) => {
        console.error('Error streaming media from source URL:', mediaInfo.actualUrl, streamError);
        if (!res.headersSent) {
            res.status(502).json({ error: "Error streaming media from the source." });
        } else {
            res.destroy();
        }
    });
    
    // Handle response end
    response.data.on('end', () => {
        console.log(`Successfully streamed media: ${mediaInfo.filename}`);
    });
    
    // Handle client disconnect
    req.on('close', () => {
        console.log('Client disconnected during download');
        if (response.data && response.data.destroy) {
            response.data.destroy();
        }
    });
    
    // Pipe the response data to client
    response.data.pipe(res);

  } catch (err) {
    console.error('Error in /api/media/stream for ID', req.params.id, ':', err.message);
    
    if (!res.headersSent) {
      if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
          res.status(504).json({ error: 'Request timeout - media source took too long to respond.' });
      } else if (err.response) {
          console.error('Axios error details:', err.response.status, err.response.statusText);
          const statusCode = err.response.status;
          
          if (statusCode === 403) {
              res.status(403).json({ error: 'Access forbidden - media source blocked the request.' });
          } else if (statusCode === 404) {
              res.status(404).json({ error: 'Media not found at source URL.' });
          } else if (statusCode >= 500) {
              res.status(502).json({ error: `Media source server error: ${statusCode}` });
          } else {
              res.status(statusCode).json({ error: `Failed to fetch media: HTTP ${statusCode}` });
          }
      } else if (err.request) {
          console.error('Axios no response received:', err.code || err.message);
          res.status(504).json({ error: 'No response from media source (network issue or timeout).' });
      } else {
          console.error('Axios setup error:', err.message);
          res.status(500).json({ error: 'Internal Server Error while preparing media stream.' });
      }
    }
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal Server Error' });
});

// Handle 404
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
  if (BASE_URL !== `http://localhost:${port}`) {
      console.log(`Publicly accessible at: ${BASE_URL}`);
  }
});