#!/usr/bin/env node
/**
 * Geracao de imagem com a API do Gemini.
 *
 * Uso:
 *   node scripts/gen-image.mjs --prompt "..." --out arena-01 [--model flash|pro] [--ar 16:9] [--n 1]
 *   node scripts/gen-image.mjs --batch scripts/prompts/concept-arena.json
 *
 * A chave sai do .env (GEMINI_API_KEY). O script nunca imprime a chave.
 * Cada saida vira um PNG em assets-src/images/ e uma entrada no manifest.json.
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

  const manifest = readManifest()
  manifest.entries = manifest.entries.filter((e) => !saved.includes(e.file))
  for (const file of saved) {
    manifest.entries.push({
      file,
      prompt,
      model: modelId,
      aspectRatio,
      resolution,
      createdAt: new Date().toISOString(),
    })
  }
  writeManifest(manifest)
  return saved
}

async function main() {
  loadEnv()
  const key = process.env.GEMINI_API_KEY
  if (!key) {
    console.error('GEMINI_API_KEY ausente. Copie .env.example para .env e preencha.')
    process.exit(1)
  }

  const args = parseArgs(process.argv.slice(2))
  const ai = new GoogleGenAI({ apiKey: key })

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
    process.stdout.write(`gerando ${spec.out} (${MODELS[spec.model] ?? spec.model}) ... `)
    try {
      const files = await generateOne(ai, spec)
      console.log(files.join(', '))
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
