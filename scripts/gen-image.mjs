#!/usr/bin/env node
/**
 * Geracao de imagem. Dois caminhos, na ordem em que sao tentados:
 *
 * 1. OpenRouter (OPENROUTER_API_KEY), que revende os mesmos modelos de imagem
 *    do Gemini e cobra por uso, sem depender de cota de free tier.
 * 2. API do Gemini direto (GEMINI_API_KEY), se a de cima nao estiver
 *    configurada. Numa conta sem faturamento ativo isso devolve 429 com
 *    limite zero em todos os modelos de imagem, que foi o que aconteceu aqui.
 *
 * Uso:
 *   node scripts/gen-image.mjs --prompt "..." --out arena-01 [--model flash|pro] [--ar 16:9]
 *   node scripts/gen-image.mjs --batch scripts/prompts/concept-01.json
 *   node scripts/gen-image.mjs --provider gemini ...   forca o caminho direto
 *
 * A chave sai do .env. O script nunca imprime a chave. Cada saida vira um PNG
 * em assets-src/images/ e uma entrada no manifest.json ao lado, com prompt,
 * modelo, provedor e custo, que e o que a secao 5.1 do briefing pede.
 */
import { GoogleGenAI } from '@google/genai'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(ROOT, 'assets-src', 'images')
const MANIFEST = join(OUT_DIR, 'manifest.json')

const MODELS = {
  flash: 'gemini-3.1-flash-image',
  pro: 'gemini-3-pro-image-preview',
}

/** Os mesmos modelos, com o nome que o OpenRouter usa. */
const OPENROUTER_MODELS = {
  flash: 'google/gemini-3.1-flash-image',
  pro: 'google/gemini-3-pro-image',
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

function readManifest() {
  if (!existsSync(MANIFEST)) return { entries: [] }
  try {
    return JSON.parse(readFileSync(MANIFEST, 'utf8'))
  } catch {
    return { entries: [] }
  }
}

function writeManifest(manifest) {
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n')
}

/** Caminho do OpenRouter. Devolve a lista de arquivos salvos e o custo. */
async function generateViaOpenRouter(key, { prompt, out, model, aspectRatio }) {
  const modelId = OPENROUTER_MODELS[model] ?? model
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: modelId,
      modalities: ['image', 'text'],
      messages: [{ role: 'user', content: prompt }],
      ...(aspectRatio ? { image_config: { aspect_ratio: aspectRatio } } : {}),
    }),
  })

  const body = await response.json()
  if (!response.ok || body.error) {
    throw new Error(body?.error?.message ?? `HTTP ${response.status}`)
  }

  const images = body.choices?.[0]?.message?.images ?? []
  if (images.length === 0) {
    throw new Error(`nada gerado para "${out}" (resposta sem imagem)`)
  }

  mkdirSync(OUT_DIR, { recursive: true })
  const saved = []
  images.forEach((entry, index) => {
    const url = entry?.image_url?.url ?? ''
    const base64 = url.split(',').pop()
    if (!base64) return
    const suffix = images.length > 1 ? `-${index + 1}` : ''
    const file = `${out}${suffix}.png`
    writeFileSync(join(OUT_DIR, file), Buffer.from(base64, 'base64'))
    saved.push(file)
  })

  return { saved, modelId, provider: 'openrouter', generationId: body.id ?? null }
}

async function generateOne(ai, { prompt, out, model, aspectRatio, resolution }) {
  const modelId = MODELS[model] ?? model
  const response = await ai.models.generateContent({
    model: modelId,
    contents: prompt,
    config: {
      responseModalities: ['IMAGE'],
      imageConfig: { aspectRatio, imageSize: resolution },
    },
  })

  const parts = response?.candidates?.[0]?.content?.parts ?? []
  const images = parts.filter((p) => p.inlineData?.data)
  if (images.length === 0) {
    const reason = response?.candidates?.[0]?.finishReason ?? 'sem imagem na resposta'
    throw new Error(`nada gerado para "${out}" (${reason})`)
  }

  const saved = []
  images.forEach((part, index) => {
    const suffix = images.length > 1 ? `-${index + 1}` : ''
    const file = `${out}${suffix}.png`
    mkdirSync(OUT_DIR, { recursive: true })
    writeFileSync(join(OUT_DIR, file), Buffer.from(part.inlineData.data, 'base64'))
    saved.push(file)
  })

  return { saved, modelId, provider: 'gemini', generationId: null }
}

function record({ saved, modelId, provider, generationId }, { prompt, aspectRatio, resolution }) {
  const manifest = readManifest()
  manifest.entries = manifest.entries.filter((e) => !saved.includes(e.file))
  for (const file of saved) {
    manifest.entries.push({
      file,
      prompt,
      provider,
      model: modelId,
      generationId,
      aspectRatio,
      resolution,
      createdAt: new Date().toISOString(),
    })
  }
  writeManifest(manifest)
}

async function main() {
  loadEnv()
  const openrouterKey = process.env.OPENROUTER_API_KEY
  const geminiKey = process.env.GEMINI_API_KEY
  if (!openrouterKey && !geminiKey) {
    console.error('Sem chave. Preencha OPENROUTER_API_KEY ou GEMINI_API_KEY no .env.')
    process.exit(1)
  }

  const args = parseArgs(process.argv.slice(2))
  const ai = geminiKey ? new GoogleGenAI({ apiKey: geminiKey }) : null

  let jobs = []
  if (args.batch) {
    const batch = JSON.parse(readFileSync(join(ROOT, args.batch), 'utf8'))
    const defaults = batch.defaults ?? {}
    jobs = batch.jobs.map((job) => ({ ...defaults, ...job }))
  } else {
    if (!args.prompt || !args.out) {
      console.error('Uso: node scripts/gen-image.mjs --prompt "..." --out nome [--model flash|pro] [--ar 16:9]')
      process.exit(1)
    }
    jobs = [{ prompt: args.prompt, out: args.out, model: args.model ?? 'flash', aspectRatio: args.ar ?? '16:9' }]
  }

  let ok = 0
  for (const job of jobs) {
    const spec = {
      prompt: job.prompt,
      out: job.out,
      model: job.model ?? 'flash',
      aspectRatio: job.aspectRatio ?? job.ar ?? '16:9',
      resolution: job.resolution ?? '2K',
    }
    const viaOpenRouter = openrouterKey && args.provider !== 'gemini'
    const nome = viaOpenRouter
      ? OPENROUTER_MODELS[spec.model] ?? spec.model
      : MODELS[spec.model] ?? spec.model
    process.stdout.write(`gerando ${spec.out} (${nome}) ... `)
    try {
      const result = viaOpenRouter
        ? await generateViaOpenRouter(openrouterKey, spec)
        : await generateOne(ai, spec)
      record(result, spec)
      console.log(result.saved.join(', '))
      ok++
    } catch (error) {
      console.log('FALHOU')
      console.error('  ' + error.message)
    }
  }
  console.log(`\n${ok}/${jobs.length} imagens em assets-src/images/`)
  if (ok < jobs.length) process.exitCode = 2
}

main()
