const express = require('express');
const { default: axios } = require('axios');
const { createProxyMiddleware } = require('http-proxy-middleware');
const { createHash } = require('crypto')
const fs = require('fs')

const app = express();

const PORT = 3000;
const HOST = "0.0.0.0";
const API_SERVICE_URL = "http://engine:50021";

function clear_cache() {
    fs.rmSync('./cache', { recursive: true })
    fs.mkdirSync('./cache')
}
clear_cache()

app.get('/speak', async (req, res) => {
    console.debug('start')
    const md5 = createHash('md5').update(JSON.stringify(req.query)).digest('hex');
    console.debug('md5')
    if (fs.existsSync(`./cache/${md5}.wav`)) {
        const wav = fs.readFileSync(`./cache/${md5}.wav`)
        res.set('Content-Type', 'audio/wav')
        res.set('Content-Disposition', 'attachment; filename="audio.wav"')
        res.send(wav)
        res.end()
        return
    }
    try {
        const query = await axios.post(API_SERVICE_URL + '/audio_query', null, {
            params: {
                ...req.query,
                speaker: req.query.speaker || 3
            }
        })
        console.debug('audio_query')
        const wav = await axios.post(API_SERVICE_URL + '/synthesis', query.data, {
            params: {
                ...req.query,
                speaker: req.query.speaker || 3
            },
            responseType: 'arraybuffer'
        })
        console.debug('synthesis')
        for (const [key, value] of Object.entries(wav.headers)) {
            res.set(key, value)
        }
        fs.writeFileSync(`./cache/${md5}.wav`, wav.data)
        res.set('Content-Disposition', 'attachment; filename="audio.wav"')
        res.send(wav.data)

    } catch (error) {
        res.status(500).send(error.response?.data || error.message)
    }
    res.end()
});

app.get('/clear', (_req, res) => {
    clear_cache()
    res.send('ok')
    res.end()
})

app.get('/help', (_req, res) => {
    res.redirect('/docs')
    res.end()
})

app.use(createProxyMiddleware({
    target: API_SERVICE_URL,
    changeOrigin: true
}));

app.listen(PORT, HOST, () => {
    console.log(`Starting Proxy at ${HOST}:${PORT}`);
});
