import express from 'express'
import axios from 'axios'
import { createProxyMiddleware } from 'http-proxy-middleware'
import { createHash } from 'crypto'
import fs from 'fs'
import AsyncLock from 'async-lock'
import { Lame } from 'node-lame'

const app = express()
const lock = new AsyncLock()

const PORT = 3000
const HOST = '0.0.0.0'
const API_SERVICE_URL = 'http://engine:50021'

function clearCache (): void {
  if (fs.existsSync('./cache')) {
    fs.rmSync('./cache', { recursive: true })
  }
  fs.mkdirSync('./cache')
}
clearCache()

// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.get('/speak', async (req: express.Request, res: express.Response) => {
  if (req.query.text === undefined) {
    res.send('text is required')
    res.end()
    return
  }
  const md5 = createHash('md5').update(JSON.stringify(req.query)).digest('hex')
  console.debug(req.query)
  void lock.acquire(md5, async (done) => {
    console.debug('lock acquired')
    if (fs.existsSync(`./cache/${md5}.mp3`)) {
      console.debug('cache hit')
      done()
      const mp3 = fs.readFileSync(`./cache/${md5}.mp3`)
      res.set('Content-Type', 'audio/mpeg')
      res.set('Content-Disposition', 'attachment; filename="audio.mp3"')
      res.send(mp3)
      res.end()
      console.debug('cache hit done')
      return
    }
    const query = await axios.post(API_SERVICE_URL + '/audio_query', null, {
      params: {
        ...req.query,
        style_id: req.query.style_id ?? req.query.speaker ?? 3
      }
    })
    console.debug('audio_query')
    const wav = await axios.post(API_SERVICE_URL + '/synthesis', query.data, {
      params: {
        ...req.query,
        style_id: req.query.style_id ?? req.query.speaker ?? 3
      },
      responseType: 'arraybuffer'
    })
    console.debug('synthesis')
    const wavData: NodeJS.ArrayBufferView = wav.data
    fs.writeFileSync(`./cache/${md5}.wav`, wavData)
    console.debug('init lame')
    const encoder = new Lame({
      output: `./cache/${md5}.mp3`,
      bitrate: 48
    }).setFile(`./cache/${md5}.wav`)

    await encoder.encode()
    console.debug('encoded')

    done()

    const mp3 = fs.readFileSync(`./cache/${md5}.mp3`)
    res.set('Content-Type', 'audio/mpeg')
    res.set('Content-Disposition', 'attachment; filename="audio.mp3"')
    res.send(mp3)
    res.end()
    console.debug('done')
  })
})

app.get('/clear', (_req, res) => {
  clearCache()
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
}))

app.listen(PORT, HOST, () => {
  console.log(`Starting Proxy at ${HOST}:${PORT}`)
})
