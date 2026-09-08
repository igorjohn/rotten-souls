#!/usr/bin/env node
/**
 * Baixa materiais PBR CC0 do ambientCG e deixa em public/assets/textures.
 *
 * Regra da secao 5.2 do briefing: pedra, chao, metal e madeira vem de banco
 * CC0; IA so entra onde nao existe equivalente. Nada aqui exige atribuicao,
 * mas a origem fica registrada em CREDITOS.md do mesmo jeito.
 *
 * Uso: node scripts/fetch-textures.mjs [--force]
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'public', 'assets', 'textures')
const TMP = join(ROOT, '.texture-cache')

/** Mapas que o jogo usa. O resto do zip e descartado. */
const MAPS = {
  Color: 'color',
  NormalGL: 'normal',
  Roughness: 'roughness',
  AmbientOcclusion: 'ao',
}

const MATERIALS = [
  { id: 'Tiles130', slug: 'chao-lajota', uso: 'Piso da arena, lajota de castelo medieval quebrada' },
  { id: 'Bricks089', slug: 'pedra-muro', uso: 'Muro do anel, arcos e pilares, alvenaria cinza medieval' },
  { id: 'PavingStones131', slug: 'pedra-degrau', uso: 'Escadaria e patamar de entrada' },
  { id: 'Metal063', slug: 'ferro-oxidado', uso: 'Braseiros, grades e ferragens' },
  { id: 'Rock064', slug: 'rocha-musgo', uso: 'Escombros e base dos muros, com musgo' },
]

const RESOLUTION = '1K'
const FORMAT = 'JPG'

function run(cmd, args, cwd) {
  execFileSync(cmd, args, { cwd, stdio: 'pipe' })
}

async function fetchMaterial(material, force) {
  const target = join(OUT, material.slug)
  if (existsSync(join(target, 'color.jpg')) && !force) {
    console.log(`${material.slug}: ja existe, pulando`)
    return true
  }

  const file = `${material.id}_${RESOLUTION}-${FORMAT}.zip`
  const url = `https://ambientcg.com/get?file=${file}`
  const zip = join(TMP, file)

  mkdirSync(TMP, { recursive: true })
  process.stdout.write(`${material.slug}: baixando ${material.id} ... `)
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok) {
    console.log(`FALHOU (HTTP ${response.status})`)
    return false
  }
  writeFileSync(zip, Buffer.from(await response.arrayBuffer()))

  const unpack = join(TMP, material.id)
  rmSync(unpack, { recursive: true, force: true })
  mkdirSync(unpack, { recursive: true })
  run('unzip', ['-o', '-q', zip, '-d', unpack])

  mkdirSync(target, { recursive: true })
  let saved = 0
  for (const entry of readdirSync(unpack)) {
    for (const [suffix, name] of Object.entries(MAPS)) {
      if (entry.endsWith(`_${suffix}.jpg`) || entry.endsWith(`_${suffix}.png`)) {
        const extension = entry.split('.').pop()
        renameSync(join(unpack, entry), join(target, `${name}.${extension}`))
        saved++
      }
    }
  }
  rmSync(unpack, { recursive: true, force: true })
  rmSync(zip, { force: true })
  console.log(`${saved} mapas`)
  return saved > 0
}

async function main() {
  const force = process.argv.includes('--force')
  mkdirSync(OUT, { recursive: true })
  let ok = 0
  for (const material of MATERIALS) {
    if (await fetchMaterial(material, force)) ok++
  }
  rmSync(TMP, { recursive: true, force: true })

  const creditos = [
    '# Texturas',
    '',
    'Todas do ambientCG (https://ambientcg.com), licenca CC0, dominio publico,',
    'sem exigencia de atribuicao. A origem fica registrada aqui mesmo assim.',
    '',
    `Resolucao ${RESOLUTION}, formato ${FORMAT}. Mapas: cor, normal (convencao OpenGL),`,
    'rugosidade e oclusao de ambiente.',
    '',
    ...MATERIALS.map((m) => `- **${m.slug}** (${m.id}): ${m.uso}`),
    '',
    'Rebaixar ou rebaixar de novo: `node scripts/fetch-textures.mjs --force`.',
    '',
  ].join('\n')
  writeFileSync(join(OUT, 'CREDITOS.md'), creditos)

  console.log(`\n${ok}/${MATERIALS.length} materiais em public/assets/textures`)
  if (ok < MATERIALS.length) process.exitCode = 2
}

main()
