const express = require('express');
const { default: axios } = require('axios');
const { createProxyMiddleware } = require('http-proxy-middleware');
const { createHash } = require('crypto')
const fs = require('fs')
const AsyncLock = require('async-lock');
const Lame = require("node-lame").Lame;

const app = express();
const lock = new AsyncLock();

const PORT = 3000;
const HOST = "0.0.0.0";
const API_SERVICE_URL = "http://engine:50021";

function clear_cache() {
    fs.rmSync('./cache', { recursive: true })
    fs.mkdirSync('./cache')
}
clear_cache()

app.get('/speak', async (req, res) => {
    if(!req.query.text) {
        res.send('text is required')
        res.end()
        return
    }
    const md5 = createHash('md5').update(JSON.stringify(req.query)).digest('hex');
    console.debug(req.query)
    lock.acquire(md5, async () => {
        console.debug('lock acquired')
        if (fs.existsSync(`./cache/${md5}.mp3`)) {
            console.debug('cache hit')
            const mp3 = fs.readFileSync(`./cache/${md5}.mp3`)
            res.set('Content-Type', 'audio/mpeg')
            res.set('Content-Disposition', 'attachment; filename="audio.mp3"')
            res.send(mp3)
            res.end()
            return
        }
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
        fs.writeFileSync(`./cache/${md5}.wav`, wav.data)
        console.debug('init lame')
        const encoder = new Lame({
            output: `./cache/${md5}.mp3`,
            bitrate: 48,
        }).setFile(`./cache/${md5}.wav`);
        
        await encoder.encode()

        console.debug('encoded')
        const mp3 = fs.readFileSync(`./cache/${md5}.mp3`)
        res.set('Content-Type', 'audio/mpeg')
        res.set('Content-Disposition', 'attachment; filename="audio.mp3"')
        res.send(mp3)
        res.end()
    })
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
