import express from 'express'
import axios, { AxiosResponse } from 'axios'
import { createProxyMiddleware } from 'http-proxy-middleware'
import { createHash } from 'crypto'
import fs from 'fs'
import AsyncLock from 'async-lock'
import { Lame } from 'node-lame'
import { JSDOM } from 'jsdom'

const app = express()
app.use(express.urlencoded({ extended: true }))
const lock = new AsyncLock()

const PORT = 3000
const HOST = '0.0.0.0'
const API_SERVICE_URL = 'http://engine:50021'

if (!fs.existsSync('./dict.json')) {
    fs.writeFileSync('./dict.json', '{}')
}
let cache: { [key: string]: string } = JSON.parse(fs.readFileSync('./dict.json', 'utf-8'))

function clearCache(): void {
    if (fs.existsSync('./cache')) {
        fs.rmSync('./cache', { recursive: true })
    }
    fs.mkdirSync('./cache')
}
clearCache()

app.get('/', (req: express.Request, res: express.Response) => {
    // vueで作る
    const html = fs.readFileSync('./index.html', 'utf-8')
    res.send(html)
})

// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.get('/speak', async (req: express.Request, res: express.Response): Promise<void> => {
    if (req.query.text === undefined) {
        res.send('text is required')
        res.end()
        return
    }
    const md5 = createHash('md5').update(JSON.stringify(req.query)).digest('hex')
    console.debug(req.query)
    await lock.acquire(md5, async (done) => {
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
        const query = await axios.post('http://127.0.0.1:' + PORT + '/audio_query', null, {
            params: {
                ...req.query,
                speaker: req.query.style_id ?? req.query.speaker ?? 3
            }
        })
        console.debug('audio_query')
        const wav: AxiosResponse<NodeJS.ArrayBufferView> = await axios.post('http://127.0.0.1:' + PORT + '/synthesis', query.data, {
            params: {
                ...req.query,
                speaker: req.query.style_id ?? req.query.speaker ?? 3
            },
            responseType: 'arraybuffer'
        })
        console.debug('synthesis')
        fs.writeFileSync(`./cache/${md5}.wav`, wav.data)
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
        fs.rmSync(`./cache/${md5}.wav`)
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


const engToKana = async (texts: Array<string>): Promise<{ [key: string]: string }> => {
    const text = texts.join(' ')
    const res: AxiosResponse<string> = await axios.get('https://www.sljfaq.org/cgi/e2k_ja.cgi', {
        params: {
            word: text,
            t: 'on'
        },
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0'
        }
    })
    const window = (new JSDOM(res.data)).window
    const row = window.document.querySelectorAll('#word-table tr')
    const result: { [key: string]: string } = {}
    for (const r of row) {
        const td = r.querySelectorAll('td')
        if (td.length >= 2) {
            result[td[0]?.textContent ?? ''] = td[1]?.textContent ?? ''
        }
    }
    return result
}

const textToKana = async (text: string): Promise<string> => {
    let words: Array<string> | null = text.match(/\w{2,}/g) as Array<string> | null
    if (words === null) {
        return text
    }
    const blacklist = [
        'speaker'
    ]
    words = words.filter(word => !blacklist.includes(word))

    for (const word of words) {
        if (word in cache) {
            words = words.filter(w => w !== word)
            text = text.replace(word, cache[word])
        }
    }

    if (words.length === 0) {
        console.log('convert cache only')
        return text
    }

    const kanas = await engToKana(words)

    console.debug('convert', kanas);

    for (const [eng, kana] of Object.entries(kanas)) {
        cache[eng] = kana
        text = text.replace(eng, kana)
    }
    fs.writeFileSync('./dict.json', JSON.stringify(cache, null, 2))
    return text
}

// 全てのスタイルを初期化
const allInit = () => {
    axios.get(API_SERVICE_URL + '/speakers').then(({ data }) => {
        data.forEach((speaker: {
            name: string,
            styles: [{
                name: string,
                id: number,
            }]
        }) => {
            speaker.styles.forEach(style => {
                axios.get(API_SERVICE_URL + '/is_initialized_speaker', {
                    params: {
                        speaker: style.id
                    }
                }).then(({ data }) => {
                    if (!data) {
                        axios.post(API_SERVICE_URL + '/initialize_speaker', null, {
                            params: {
                                speaker: style.id,
                                skip_reinit: true
                            }
                        }).then(() => {
                            console.log(speaker.name + ' ' + style.name + ' initialized')
                        })
                    }
                })
            })
        })
    })
}

const cacheMiddleware = () => {
    return (req: express.Request, res: express.Response, next: express.NextFunction) => {
        if (req.method !== "GET") return next();

        let key = '__proxy_cache__' + req.originalUrl || req.url
        key = key.replaceAll('/', '_')

        if (fs.existsSync(`./cache/${key}`)) {
            const body = fs.readFileSync(`./cache/${key}`)
            if (body.length) {
                res.set(JSON.parse(fs.readFileSync(`./cache/${key}.header`, 'utf-8')))
                res.send(body)
            } else {
                return next()
            }
        } else {
            var _end = res.end;
            var _write = res.write;
            var buffer = Buffer.alloc(0);
            // Rewrite response method and get the content.
            res.write = function (data): any {
                buffer = Buffer.concat([buffer, data]);
            };
            res.end = function (): any {
                var body = buffer.toString();
                const headers = res.getHeaders()
                fs.writeFileSync(`./cache/${key}`, body)
                fs.writeFileSync(`./cache/${key}.header`, JSON.stringify(headers))
                // @ts-ignore
                _write.call(res, body);
                // @ts-ignore
                _end.call(res);
            };
            next()
        }
    }
}

app.use('/', express.static('client/dist'))
app.use('/client/', cacheMiddleware(), createProxyMiddleware({
    target: 'http://client:5173',
}))

app.use([
    '/singer_info',
    '/speaker_info'
], cacheMiddleware(), createProxyMiddleware({
    target: API_SERVICE_URL
}))

app.use(createProxyMiddleware({
    target: API_SERVICE_URL,
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    pathRewrite: async (original): Promise<string> => {
        const path = decodeURI(original)
        let text = path.match(/[?&]text=(.+?)(?:&|$)/)?.[1] ?? ''
        if (text === '') {
            return path
        }
        text = await textToKana(text)

        return encodeURI(path.replace(/([?&]text=).+?(&|$)/, '$1' + text + '$2'))
    }
}))

app.listen(PORT, HOST, () => {
    console.log(`Starting Proxy at ${HOST}:${PORT}`)
    // allInit()
})
