#!/usr/bin/env node
/**
 * Geração de áudio musical pelo OpenRouter (Lyria 3).
 *
 * O Lyria é modelo de MÚSICA. Ele serve pro que é longo e textural: o ambiente
 * do menu, o stinger de pavor do portão de névoa, as telas de morte e vitória.
 * Não serve pra efeito curto (passo, clique, impacto), que continua sintetizado
 * na Web Audio API em `src/core/audio.ts`.
 *
 * Uso:
 *   node scripts/gen-audio.mjs --prompt "..." --out menu-ambiente [--model clip|pro] [--seed 7]
 *   node scripts/gen-audio.mjs --batch scripts/prompts/audio-01.json
 *   node scripts/gen-audio.mjs --master           corta e comprime pro bundle
 *   node scripts/gen-audio.mjs --credits          só mostra o saldo
 *
 * A chave sai do .env como OPENROUTER_API_KEY e nunca é impressa. Cada saída
 * vira um arquivo bruto em assets-src/audio/gerado/ e uma entrada no
 * manifest.json ao lado, com prompt, modelo, semente, custo medido e data.
 * O custo é medido pela diferença de saldo antes e depois, não estimado.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(ROOT, 'assets-src', 'audio', 'gerado')
const MANIFEST = join(OUT_DIR, 'manifest.json')

const MODELS = {
  clip: 'google/lyria-3-clip-preview',
  pro: 'google/lyria-3-pro-preview',
}

function loadEnv() {
  const path = join(ROOT, '.env')
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim()
  }
}

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue
    const key = argv[i].slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) args[key] = true
    else {
      args[key] = next
      i++
    }
  }
  return args
}

function key() {
  const value = process.env.OPENROUTER_API_KEY
  if (!value) {
    // Nunca ecoar a chave, nem parte dela. Só dizer que falta.
    throw new Error('falta OPENROUTER_API_KEY no .env')
  }
  return value
}

/** Saldo gasto até agora, em dólares. É o número que mede o custo real. */
async function usage() {
  const response = await fetch('https://openrouter.ai/api/v1/credits', {
    headers: { Authorization: `Bearer ${key()}` },
  })
  if (!response.ok) throw new Error(`credits ${response.status}`)
  const body = await response.json()
  return body.data.total_usage
}

function readManifest() {
  if (!existsSync(MANIFEST)) return { geracoes: [] }
  try {
    return JSON.parse(readFileSync(MANIFEST, 'utf8'))
  } catch {
    return { geracoes: [] }
  }
}

/**
 * O Lyria só devolve áudio em streaming (`stream: true`, senão a API responde
 * 400). Os pedaços chegam como eventos SSE com base64 em `delta.audio.data`, e
 * o arquivo é a concatenação deles. O nome do campo já mudou entre versões da
 * API, então varre o delta inteiro atrás de qualquer base64 em vez de fixar um
 * caminho e quebrar na próxima.
 */
function collectAudioChunks(delta, out) {
  if (!delta || typeof delta !== 'object') return
  for (const [name, value] of Object.entries(delta)) {
    if (typeof value === 'string') {
      if ((name === 'data' || name === 'b64_json' || name === 'base64') && value.length > 0) {
        out.chunks.push(value)
      } else if (name === 'format' || name === 'mime_type') {
        out.format = value.replace('audio/', '')
      }
    } else if (value && typeof value === 'object') {
      collectAudioChunks(value, out)
    }
  }
}

/** Extensão pelo cabeçalho do arquivo, com o campo do stream só como reserva. */
function sniff(bytes, format = '') {
  const head = bytes.subarray(0, 4).toString('binary')
  if (head === 'RIFF') return 'wav'
  if (head === 'OggS') return 'ogg'
  if (head.startsWith('ID3') || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) return 'mp3'
  if (format.includes('mp3')) return 'mp3'
  if (format.includes('ogg')) return 'ogg'
  return 'wav'
}

async function streamAudio(id, payload) {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key()}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({ ...payload, stream: true }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`${id} respondeu ${response.status}: ${text.slice(0, 400)}`)
  }

  const out = { chunks: [], format: 'wav' }
  let buffer = ''
  let ultimo = null
  const decoder = new TextDecoder()

  for await (const parte of response.body) {
    buffer += decoder.decode(parte, { stream: true })
    let corte
    while ((corte = buffer.indexOf('\n')) >= 0) {
      const linha = buffer.slice(0, corte).trim()
      buffer = buffer.slice(corte + 1)
      if (!linha.startsWith('data:')) continue
      const carga = linha.slice(5).trim()
      if (carga === '[DONE]') continue
      let evento
      try {
        evento = JSON.parse(carga)
      } catch {
        continue
      }
      ultimo = evento
      if (evento.error) throw new Error(`${id} interrompeu: ${JSON.stringify(evento.error).slice(0, 300)}`)
      for (const escolha of evento.choices ?? []) {
        collectAudioChunks(escolha.delta ?? escolha.message, out)
      }
    }
  }

  if (out.chunks.length === 0) {
    throw new Error(`${id} não devolveu áudio. Último evento: ${JSON.stringify(ultimo).slice(0, 400)}`)
  }
  return out
}

async function generate({ prompt, out, model = 'clip', seed }) {
  const id = MODELS[model] ?? model
  const before = await usage()

  const payload = {
    model: id,
    modalities: ['audio'],
    messages: [{ role: 'user', content: prompt }],
  }
  if (seed !== undefined) payload.seed = Number(seed)

  const audio = await streamAudio(id, payload)

  mkdirSync(OUT_DIR, { recursive: true })
  const bytes = Buffer.from(audio.chunks.join(''), 'base64')
  // O campo `format` do stream mentiu uma vez (disse wav num mp3), então quem
  // decide a extensão são os bytes.
  const file = `${out}.${sniff(bytes, audio.format)}`
  writeFileSync(join(OUT_DIR, file), bytes)

  // Espera um instante: a contabilidade do OpenRouter não fecha no mesmo
  // milissegundo em que a resposta chega.
  await new Promise((resolve) => setTimeout(resolve, 4000))
  const after = await usage()
  const custo = Number((after - before).toFixed(6))

  const manifest = readManifest()
  manifest.geracoes = manifest.geracoes.filter((g) => g.arquivo !== file)
  manifest.geracoes.push({
    arquivo: file,
    modelo: id,
    prompt,
    semente: seed === undefined ? null : Number(seed),
    bytes: bytes.length,
    custoUsd: custo,
    data: new Date().toISOString().slice(0, 10),
  })
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`)

  console.log(`${file}  ${(bytes.length / 1024).toFixed(0)} KB  US$ ${custo.toFixed(4)}`)
  return { file, custo, bytes: bytes.length }
}

/**
 * Corte e compressão dos clipes crus pro que entra no bundle.
 *
 * O Lyria devolve sempre trinta segundos de música em estéreo a 194 kbps, e o
 * jogo não quer nada disso: quer o pedaço certo, mono, no menor bitrate que
 * ainda soe bem numa textura grave. `laco` faz o corte fechar em si mesmo, com
 * a cauda cruzada por cima da cabeça, pra o ambiente do menu rodar sem estalo.
 */
const MASTERS = [
  {
    // Fora do bundle: a trilha do menu que entrou no jogo é a de
    // `src/core/menu-music.ts`, entregue pelo Igor. Este fica masterizado em
    // assets-src como alternativa gerada, cinco vezes mais leve e com origem
    // limpa, caso a licença daquele arquivo não se confirme.
    entrada: 'menu-ambiente-01.mp3',
    saida: 'menu-ambiente.mp3',
    inicio: 4,
    fim: 24,
    laco: 2,
    bitrate: '96k',
    bundle: false,
    nota: 'alternativa gerada pro bordão do menu, laço sem emenda',
  },
  {
    entrada: 'portao-stinger-01.mp3',
    saida: 'portao-stinger.mp3',
    inicio: 0,
    fim: 5.2,
    fadeOut: 1.4,
    bitrate: '112k',
    nota: 'travessia do portão de névoa, subida e pancada',
  },
  {
    entrada: 'morte-01.mp3',
    saida: 'morte.mp3',
    inicio: 0,
    fim: 9.5,
    fadeOut: 3,
    bitrate: '96k',
    nota: 'tela de morte',
  },
  {
    entrada: 'vitoria-01.mp3',
    saida: 'vitoria.mp3',
    inicio: 3.4,
    fim: 13.4,
    fadeIn: 0.2,
    fadeOut: 3,
    bitrate: '96k',
    nota: 'tela de vitória',
  },
]

const CUES_DIR = join(ROOT, 'public', 'assets', 'audio', 'cues')
/** Masterizado mas fora do bundle, pra o Igor comparar sem pesar o download. */
const ALT_DIR = join(ROOT, 'assets-src', 'audio', 'alternativas')

function master() {
  mkdirSync(CUES_DIR, { recursive: true })
  mkdirSync(ALT_DIR, { recursive: true })
  const catalogo = { fonte: 'google/lyria-3-clip-preview via OpenRouter', cues: {} }

  for (const receita of MASTERS) {
    const entrada = join(OUT_DIR, receita.entrada)
    if (!existsSync(entrada)) {
      console.warn(`pulando ${receita.saida}: falta ${receita.entrada}`)
      continue
    }
    const paraBundle = receita.bundle !== false
    const destino = join(paraBundle ? CUES_DIR : ALT_DIR, receita.saida)
    const duracao = receita.fim - receita.inicio
    const cadeia = []

    if (receita.laco) {
      const x = receita.laco
      const fim = receita.inicio + duracao
      // A cauda entra por cima da cabeça com fades lineares que somam um, e o
      // resultado vira o começo do arquivo. Assim o fim do laço já é a cauda e
      // a volta cai exatamente no mesmo sinal, sem estalo. Feito com `amix` e
      // não com `acrossfade` porque o `acrossfade` devolve arquivo vazio
      // quando a duração do cruzamento é o tamanho inteiro das duas entradas.
      cadeia.push(
        `[0:a]atrim=${fim - x}:${fim},asetpts=N/SR/TB,afade=t=out:st=0:d=${x}:curve=tri[cauda]`,
        `[0:a]atrim=${receita.inicio}:${receita.inicio + x},asetpts=N/SR/TB,afade=t=in:st=0:d=${x}:curve=tri[cabeca]`,
        `[cauda][cabeca]amix=inputs=2:normalize=0[emenda]`,
        `[0:a]atrim=${receita.inicio + x}:${fim - x},asetpts=N/SR/TB[meio]`,
        `[emenda][meio]concat=n=2:v=0:a=1,aformat=channel_layouts=mono,loudnorm=I=-20:TP=-2:LRA=7[saida]`,
      )
    } else {
      const filtros = [`atrim=${receita.inicio}:${receita.fim}`, 'asetpts=N/SR/TB']
      if (receita.fadeIn) filtros.push(`afade=t=in:st=0:d=${receita.fadeIn}`)
      if (receita.fadeOut) {
        filtros.push(`afade=t=out:st=${(duracao - receita.fadeOut).toFixed(3)}:d=${receita.fadeOut}`)
      }
      filtros.push('aformat=channel_layouts=mono', 'loudnorm=I=-20:TP=-2:LRA=7')
      cadeia.push(`[0:a]${filtros.join(',')}[saida]`)
    }

    execFileSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', entrada,
      '-filter_complex', cadeia.join(';'),
      '-map', '[saida]',
      '-c:a', 'libmp3lame', '-b:a', receita.bitrate, '-ac', '1',
      destino,
    ])

    const bytes = readFileSync(destino).length
    const nome = receita.saida.replace('.mp3', '')
    if (paraBundle) {
      catalogo.cues[nome] = {
        arquivo: receita.saida,
        loop: Boolean(receita.laco),
        origem: receita.entrada,
        nota: receita.nota,
      }
    }
    const onde = paraBundle ? 'bundle' : 'fora do bundle'
    console.log(`${receita.saida}  ${(bytes / 1024).toFixed(0)} KB  ${receita.bitrate} mono  ${onde}`)
  }

  writeFileSync(join(CUES_DIR, 'manifest.json'), `${JSON.stringify(catalogo, null, 2)}\n`)
}

async function main() {
  loadEnv()
  const args = parseArgs(process.argv.slice(2))

  if (args.master) {
    master()
    return
  }

  if (args.credits) {
    console.log(`gasto acumulado: US$ ${(await usage()).toFixed(6)}`)
    return
  }

  const jobs = args.batch
    ? JSON.parse(readFileSync(join(ROOT, args.batch), 'utf8'))
    : [{ prompt: args.prompt, out: args.out, model: args.model, seed: args.seed }]

  const antes = await usage()
  for (const job of jobs) {
    if (!job.prompt || !job.out) throw new Error('cada trabalho precisa de prompt e out')
    await generate(job)
  }
  const depois = await usage()
  console.log(`total desta rodada: US$ ${(depois - antes).toFixed(4)}`)
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
