#!/usr/bin/env node
/**
 * Biblioteca de materiais PBR dos personagens, uma peça por vez.
 *
 * O modelo de imagem só é bom em uma coisa: cor. Normal, rugosidade e oclusão
 * saídos de um modelo de imagem são chute com cara de mapa. Então aqui o
 * modelo entrega SÓ o albedo sem emenda e o resto é derivado por conta:
 *
 *   altura     = luminância do albedo, menos a versão muito borrada dela
 *                (tira a iluminação de fundo que o modelo desenha sem querer)
 *   normal     = Sobel na altura, com vizinhança circular pra continuar ladrilhável
 *   rugosidade = luminância invertida, remapeada na faixa da peça
 *   oclusão    = cavidade (borrado menos original), suavizada
 *   metalicidade = constante por peça, não vira mapa
 *
 * Ladrilhamento: o albedo é rolado meia imagem, o que joga a emenda original
 * pro centro e deixa a borda contínua por construção. A cruz que sobra no meio
 * é fechada com uma mistura espelhada em janela triangular, que é contínua na
 * costura por simetria. Um mosaico 3x3 é gravado ao lado pra conferir no olho.
 *
 * Uso:
 *   node scripts/gen-textura.mjs                  # todas as peças que faltam
 *   node scripts/gen-textura.mjs aco-placa couro  # só estas
 *   node scripts/gen-textura.mjs --forcar         # regera o albedo (gasta)
 *   node scripts/gen-textura.mjs --so-derivar     # não chama a API
 *   node scripts/gen-textura.mjs --precos         # só mostra preço e saldo
 *
 * A chave sai de .env (OPENROUTER_API_KEY) e nunca é impressa nem gravada.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BRUTO = join(ROOT, 'assets-src', 'images', 'materiais')
const PUBLICO = join(ROOT, 'public', 'assets', 'textures', 'materiais')
const MANIFESTO = join(BRUTO, 'manifest.json')

const MODELO = 'google/gemini-3.1-flash-image'
const API = 'https://openrouter.ai/api/v1'

/** Teto desta tarefa, em dólar. O script para sozinho antes de furar. */
const TETO = 1.5

/**
 * Cabeçalho comum do prompt. O modelo tende a devolver uma cena, uma esfera de
 * material ou uma moldura; estas negativas são o que impede isso.
 */
const CABECALHO = [
  'Seamless tileable PBR base color (albedo) texture map only.',
  'Flat even diffuse lighting, no shadows, no specular highlights, no reflections,',
  'no vignette, no lighting gradient across the image.',
  'Straight-on orthographic view of a flat surface, macro material scan,',
  'square 1:1, edge to edge, no border, no frame, no margin, no text, no watermark,',
  'no logo, no object, no scene, no background, no perspective.',
  'Dark grimy night-game palette, Demon’s Souls, worn and ruined, never shiny or heroic.',
].join(' ')

/**
 * As seis peças, na ordem do briefing.
 *
 * `rugosidade` é a faixa [mínimo, máximo] em que a luminância invertida é
 * remapeada: metal encosta no baixo, tecido só no alto. `relevo` é a força do
 * Sobel, `oclusao` o ganho da cavidade e `altoPasso` o raio do borrado que
 * limpa a iluminação de fundo do albedo.
 *
 * `refletancia` é o alvo de luminância linear no percentil 90 do albedo, ou
 * seja, o brilho da parte clara da superfície. O modelo de imagem entrega uma
 * foto, e foto já vem com a luz embutida: o aço saiu com percentil 90 de 0,08,
 * sete vezes mais escuro do que aço é. Num material metálico o albedo é a
 * própria refletância especular, então isso vira uma esfera preta na arena.
 * A âncora é percentil e não média porque na malha metade da imagem é vão
 * preto entre os anéis, e a média puxada por buraco deixaria o anel prateado.
 */
const PECAS = [
  {
    id: 'aco-placa',
    refletancia: 0.55,
    nome: 'Aço oxidado de placa',
    uso: 'Armadura e elmo do jogador e do chefe',
    metalicidade: 1,
    rugosidade: [0.34, 0.86],
    relevo: 1.0,
    oclusao: 1.5,
    altoPasso: 42,
    prompt:
      'Weathered blackened steel armour plate, hand-hammered dented surface, ' +
      'patches of dark orange-brown rust and deep pitting, soot and grease stains, ' +
      'cold desaturated grey-blue steel, faint moss in the pits, centuries of neglect.',
  },
  {
    id: 'malha-ferro',
    refletancia: 0.34,
    nome: 'Malha de ferro',
    uso: 'Cota por baixo das placas, axilas, pescoço, saiote',
    metalicidade: 1,
    rugosidade: [0.42, 0.9],
    relevo: 1.5,
    oclusao: 2.2,
    altoPasso: 28,
    prompt:
      'Riveted chainmail in four-in-one European weave, overlapping flattened rings. ' +
      'Very dark blackened oxidised iron, matte, never silver, never polished, never stainless: ' +
      'orange-brown rust crust on the rings, grey grime and dried mud packed in the gaps, ' +
      'a few rings broken or missing. The weave must continue across the top and bottom ' +
      'edges exactly as it does across the left and right edges.',
  },
  {
    id: 'couro',
    refletancia: 0.09,
    nome: 'Couro escuro',
    uso: 'Correias, luvas, botas, cabo da espada',
    metalicidade: 0,
    rugosidade: [0.58, 0.94],
    relevo: 1.1,
    oclusao: 1.6,
    altoPasso: 36,
    prompt:
      'Very dark brown almost black worn leather hide, coarse natural grain, ' +
      'dry cracked scuffed surface, pale abraded scratches, salt and mud stains, ' +
      'no stitching, no straps, no buckles, just the raw hide surface.',
  },
  {
    id: 'tecido',
    refletancia: 0.16,
    nome: 'Tecido pesado',
    uso: 'Capa e tabardo',
    metalicidade: 0,
    rugosidade: [0.72, 0.99],
    relevo: 1.3,
    oclusao: 1.4,
    altoPasso: 30,
    prompt:
      'Heavy coarse wool cloth, thick woven twill weave clearly visible, ' +
      'dark desaturated ash grey with a faint cold moss-green cast, ' +
      'dirty, dusty, faded, loose broken threads and small moth holes, ' +
      'flat spread out fabric with no folds and no drape.',
  },
  {
    id: 'aco-lamina',
    refletancia: 0.62,
    nome: 'Aço da lâmina',
    uso: 'Montante, fio e face da lâmina',
    metalicidade: 1,
    rugosidade: [0.16, 0.62],
    relevo: 0.7,
    oclusao: 1.1,
    altoPasso: 48,
    prompt:
      'Used sword blade steel surface, fine parallel lengthwise grinding marks, ' +
      'cold neutral grey steel, mostly clean but marked: thin scratches, ' +
      'small nicks and chips, faint dark patina and dried blood haze near the edge, ' +
      'no rust bloom, harder and cleaner than armour plate.',
  },
  {
    id: 'latao',
    refletancia: 0.48,
    nome: 'Latão gasto',
    uso: 'Fivelas, rebites, brasão e filete de borda',
    metalicidade: 1,
    rugosidade: [0.28, 0.8],
    relevo: 0.9,
    oclusao: 1.4,
    altoPasso: 44,
    prompt:
      'Tarnished aged brass sheet, dull warm ochre-yellow metal gone dark, ' +
      'green-brown verdigris crust settled in the low spots, ' +
      'fine scratches and hammer marks, dirt in the crevices, no polish, no gleam.',
  },
]

/** Só a chave, e ela não sai desta função. */
function lerChave() {
  const arquivo = join(ROOT, '.env')
  if (!existsSync(arquivo)) throw new Error('.env não encontrado')
  const linha = readFileSync(arquivo, 'utf8').match(/^OPENROUTER_API_KEY=(.+)$/m)
  if (!linha) throw new Error('OPENROUTER_API_KEY ausente no .env')
  const chave = linha[1].trim()
  if (!chave) throw new Error('OPENROUTER_API_KEY vazia')
  return chave
}

async function saldo(chave) {
  const resposta = await fetch(`${API}/credits`, { headers: { Authorization: `Bearer ${chave}` } })
  if (!resposta.ok) throw new Error(`saldo: HTTP ${resposta.status}`)
  const { data } = await resposta.json()
  return { comprado: data.total_credits, gasto: data.total_usage, restante: data.total_credits - data.total_usage }
}

/** Preço real do modelo, lido da API. Nada de estimativa de cabeça. */
async function preco(modelo) {
  const resposta = await fetch(`${API}/models`)
  if (!resposta.ok) throw new Error(`modelos: HTTP ${resposta.status}`)
  const { data } = await resposta.json()
  const alvo = data.find((m) => m.id === modelo)
  if (!alvo) throw new Error(`modelo ${modelo} não está no catálogo`)
  return {
    entrada: Number(alvo.pricing.prompt),
    saida: Number(alvo.pricing.completion),
    imagem: Number(alvo.pricing.image_output ?? 0),
  }
}

/** Custo real da geração, cobrado pela própria OpenRouter. */
async function custoDaGeracao(chave, id) {
  // A contabilidade da OpenRouter demora pra fechar; menos de uns dez segundos
  // de espera devolve nulo e o custo sai como interrogação no log.
  for (let tentativa = 0; tentativa < 12; tentativa++) {
    await new Promise((r) => setTimeout(r, 1500))
    const resposta = await fetch(`${API}/generation?id=${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${chave}` },
    })
    if (!resposta.ok) continue
    const { data } = await resposta.json()
    if (data && typeof data.total_cost === 'number') return data.total_cost
  }
  return null
}

async function gerarAlbedo(chave, peca) {
  const prompt = `${CABECALHO} Subject: ${peca.prompt}`
  const resposta = await fetch(`${API}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${chave}`,
      'content-type': 'application/json',
      'HTTP-Referer': 'https://github.com/igorjohn/app-souls-web',
      'X-Title': 'Rotten Souls',
    },
    body: JSON.stringify({
      model: MODELO,
      modalities: ['image', 'text'],
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  if (!resposta.ok) {
    // O corpo do erro não carrega a chave, só o motivo da recusa.
    throw new Error(`geração: HTTP ${resposta.status} ${(await resposta.text()).slice(0, 400)}`)
  }
  const corpo = await resposta.json()
  const imagens = corpo.choices?.[0]?.message?.images ?? []
  const url = imagens[0]?.image_url?.url
  if (!url) throw new Error(`nenhuma imagem veio: ${JSON.stringify(corpo.choices?.[0]?.message ?? {}).slice(0, 300)}`)

  const base64 = url.split(',').pop()
  return { bytes: Buffer.from(base64, 'base64'), id: corpo.id, prompt }
}

/**
 * A derivação em si. Numpy faz em segundos o que em JS puro levaria minutos e
 * mais linhas do que este arquivo inteiro; o programa entra por stdin pra não
 * espalhar arquivo pelo repositório.
 */
const DERIVADOR = `
import json, sys
import numpy as np
from PIL import Image, ImageFilter

cfg = json.loads(sys.stdin.read())
lado = cfg["lado"]

img = Image.open(cfg["origem"]).convert("RGB")
if img.size != (lado, lado):
    img = img.resize((lado, lado), Image.LANCZOS)
rgb = np.asarray(img).astype(np.float32) / 255.0

def borrar(a, raio):
    """Borrado gaussiano com vizinhanca circular, senao o mapa deixa de ladrilhar."""
    if raio < 1:
        return a.copy()
    pad = int(raio) * 3
    largo = np.pad(a, ((pad, pad), (pad, pad)), mode="wrap")
    saida = Image.fromarray((np.clip(largo, 0, 1) * 255).astype(np.uint8)).filter(
        ImageFilter.GaussianBlur(raio)
    )
    return np.asarray(saida).astype(np.float32)[pad:-pad, pad:-pad] / 255.0

def salto(a, eixo):
    """Quanto a imagem pula ao dar a volta, comparado com um pulo qualquer do meio."""
    if eixo == 1:
        borda = np.abs(a[:, 0] - a[:, -1]).mean()
        interior = np.abs(a[:, 1:] - a[:, :-1]).mean()
    else:
        borda = np.abs(a[0] - a[-1]).mean()
        interior = np.abs(a[1:] - a[:-1]).mean()
    return float(borda / max(interior, 1e-6))

def periodo(a, eixo):
    """
    Acha o passo do padrao no eixo, por autocorrelacao do perfil medio.
    Trama de malha e de tecido sao periodicas; saber o passo permite cortar a
    imagem num numero inteiro de repeticoes, que fecha a emenda sem borrar nada.
    """
    perfil = a.mean(axis=(1, 2)) if eixo == 0 else a.mean(axis=(0, 2))
    perfil = perfil - perfil.mean()
    n = len(perfil)
    ac = np.correlate(perfil, perfil, mode="full")[n - 1:]
    ac = ac / max(ac[0], 1e-9)
    lo, hi = max(8, n // 40), n // 2
    k = int(np.argmax(ac[lo:hi])) + lo
    return k, float(ac[k])

def costurar(a, banda, limiar=1.5):
    """
    Fecha a emenda, um eixo de cada vez e so onde ela existe.

    O modelo as vezes ja entrega um lado ladrilhavel. Remendar um eixo que ja
    fechava e pior que nao mexer: numa trama regular, como a malha, a mistura
    espelhada aparece como faixa fantasma. Entao cada eixo e medido antes.

    Onde precisa: rola meia imagem, o que leva a emenda original pro centro e
    deixa a borda continua por construcao, porque as duas metades eram vizinhas.
    O corte que sobra no meio some numa mistura com o espelho da propria imagem,
    em janela triangular que chega a 0,5 na costura e portanto iguala os dois
    lados exatamente.
    """
    relato = {}
    for eixo in (1, 0):
        nome = "esquerda-direita" if eixo == 1 else "topo-base"
        razao = salto(a, eixo)
        if razao <= limiar:
            relato[nome] = "ja fechava (%.2fx)" % razao
            continue
        # Primeiro a tentativa que nao borra: se o padrao for periodico, cortar
        # num numero inteiro de passos fecha a volta sem tocar em pixel nenhum.
        passo, forca = periodo(a, eixo)
        if forca > 0.3:
            n = a.shape[eixo]
            corte = (n // passo) * passo
            if corte >= passo * 2 and corte < n:
                tentativa = a[:corte] if eixo == 0 else a[:, :corte]
                depois = salto(tentativa, eixo)
                if depois <= limiar:
                    a = tentativa
                    relato[nome] = "cortado no passo de %d px (%.2fx antes, %.2fx depois)" % (
                        passo, razao, depois)
                    continue

        n = a.shape[eixo]
        a = np.roll(a, n // 2, axis=eixo)
        c = n // 2
        idx = np.arange(n)
        espelho = np.clip(2 * c - 1 - idx, 0, n - 1)
        peso = np.clip(0.5 * (1.0 - np.abs(idx - (c - 0.5)) / banda), 0.0, 0.5)
        peso = peso.reshape((-1, 1, 1) if eixo == 0 else (1, -1, 1))
        m = a[espelho, :] if eixo == 0 else a[:, espelho]
        a = a * (1.0 - peso) + m * peso
        relato[nome] = "remendado (%.2fx antes, %.2fx depois)" % (razao, salto(a, eixo))
    return a, relato

rgb, relatoCostura = costurar(rgb, cfg["banda"])
if rgb.shape[0] != lado or rgb.shape[1] != lado:
    # O corte no passo do padrao deixa a imagem menor; volta pro quadrado.
    rgb = np.asarray(
        Image.fromarray((np.clip(rgb, 0, 1) * 255).astype(np.uint8)).resize((lado, lado), Image.LANCZOS)
    ).astype(np.float32) / 255.0

# Luminancia perceptual. O albedo vem em sRGB e assim fica, porque o que
# interessa aqui e contraste de relevo, nao fotometria.
lum = (0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2])

# Refletancia: leva a media linear do albedo pro valor fisico da peca. O
# ganho e aplicado em linear, que preserva a razao entre as cores, e o topo
# leva um joelho suave pra nao chapar o brilho.
def para_linear(x):
    return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)

def para_srgb(x):
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.clip(x, 0, None) ** (1 / 2.4) - 0.055)

lin = para_linear(rgb)
lumLin = 0.2126 * lin[..., 0] + 0.7152 * lin[..., 1] + 0.0722 * lin[..., 2]
# A ancora e o percentil 90, nao a media: na malha metade da imagem e vao preto
# entre os aneis, e uma media puxada por buraco deixaria o anel prateado.
alto = float(np.percentile(lumLin, 90))
ganho = float(np.clip(cfg["refletancia"] / max(alto, 1e-5), 0.25, 14.0))
lin = lin * ganho
joelho = 0.8
lin = np.where(lin > joelho, joelho + (1.0 - joelho) * np.tanh((lin - joelho) / (1.0 - joelho)), lin)
rgb = np.clip(para_srgb(lin), 0.0, 1.0).astype(np.float32)
lum = (0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2])
print(json.dumps({"ganho": round(ganho, 3), "p90Antes": round(alto, 4)}), file=sys.stderr)

# Altura: luminancia menos a versao muito borrada dela. Sem isso, qualquer
# gradiente de luz que o modelo desenhou vira uma duna no normal.
base = borrar(lum, cfg["altoPasso"])
altura = np.clip((lum - base) * 1.6 + 0.5, 0.0, 1.0)

# Normal por Sobel, convencao OpenGL (verde pra cima), vizinhanca circular.
def sobel(a):
    p = np.pad(a, 1, mode="wrap")
    kx = np.array([[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]], np.float32) / 8.0
    ky = np.array([[-1, -2, -1], [0, 0, 0], [1, 2, 1]], np.float32) / 8.0
    gx = np.zeros_like(a); gy = np.zeros_like(a)
    for j in range(3):
        for i in range(3):
            v = p[j:j + a.shape[0], i:i + a.shape[1]]
            gx += v * kx[j, i]; gy += v * ky[j, i]
    return gx, gy

gx, gy = sobel(altura)
f = cfg["relevo"] * 8.0
nx, ny, nz = -gx * f, gy * f, np.ones_like(gx)
comp = np.sqrt(nx * nx + ny * ny + nz * nz)
normal = np.stack([nx / comp, ny / comp, nz / comp], -1) * 0.5 + 0.5

# Rugosidade: escuro e sujo, logo aspero; claro e desgastado, logo mais liso.
# A luminancia e normalizada por percentil pra peca usar a faixa inteira.
lo, hi = np.percentile(lum, 3), np.percentile(lum, 97)
ln = np.clip((lum - lo) / max(hi - lo, 1e-4), 0.0, 1.0)
rmin, rmax = cfg["rugosidade"]
rug = rmin + (rmax - rmin) * (1.0 - ln)

# Oclusao por cavidade: onde o pixel e mais escuro que a vizinhanca, ha buraco.
# A cavidade crua e minuscula (centesimos), entao ela e normalizada pelo proprio
# percentil 99,5 antes de virar sombra; sem isso o mapa sai branco e inutil.
cav = np.clip(borrar(lum, cfg["raioCav"]) - lum, 0.0, 1.0)
cav = np.clip(cav / max(float(np.percentile(cav, 99.5)), 1e-4), 0.0, 1.0)
forca = min(0.85, cfg["oclusao"] * 0.4)
ao = borrar(np.clip(1.0 - cav * forca, 0.0, 1.0), 1.5)

def salvar(arr, caminho, cinza=False, qualidade=None):
    a = (np.clip(arr, 0, 1) * 255.0 + 0.5).astype(np.uint8)
    im = Image.fromarray(a, "L" if cinza else "RGB")
    if qualidade is None:
        im.save(caminho)
    else:
        im.save(caminho, "WEBP", quality=qualidade, method=6)

salvar(rgb, cfg["bruto"] + "/albedo.png")
salvar(normal, cfg["bruto"] + "/normal.png")
salvar(rug, cfg["bruto"] + "/roughness.png", cinza=True)
salvar(ao, cfg["bruto"] + "/ao.png", cinza=True)
salvar(altura, cfg["bruto"] + "/height.png", cinza=True)

# So o que o jogo carrega vai pro publico, ja comprimido.
#
# Cor e normal ficam em 1024: sao eles que carregam o detalhe. Rugosidade e
# oclusao caem pra 512, porque sao sinais suaves e o relevo fino ja vem do
# normal; isso sozinho tira um terco do peso da biblioteca. O normal leva a
# qualidade mais alta porque artefato de compressao em normal vira relevo falso.
def reduzir(arr, n):
    im = Image.fromarray((np.clip(arr, 0, 1) * 255 + 0.5).astype(np.uint8))
    return np.asarray(im.resize((n, n), Image.LANCZOS)).astype(np.float32) / 255.0

meio = max(256, lado // 2)
salvar(rgb, cfg["publico"] + "/color.webp", qualidade=80)
salvar(normal, cfg["publico"] + "/normal.webp", qualidade=86)
salvar(reduzir(rug, meio), cfg["publico"] + "/roughness.webp", cinza=True, qualidade=76)
salvar(reduzir(ao, meio), cfg["publico"] + "/ao.webp", cinza=True, qualidade=76)

# Mosaico 3x3 reduzido, so pra conferir a costura no olho.
peq = Image.fromarray((np.clip(rgb, 0, 1) * 255).astype(np.uint8)).resize((341, 341), Image.LANCZOS)
mos = Image.new("RGB", (1023, 1023))
for j in range(3):
    for i in range(3):
        mos.paste(peq, (i * 341, j * 341))
mos.save(cfg["bruto"] + "/mosaico.png")

print(json.dumps({"ok": True, "ganho": round(ganho, 3), "costura": relatoCostura}))
`

/**
 * O programa Python sai daqui num arquivo temporário, fora do repositório, e a
 * configuração entra por stdin. Assim o repositório continua com um arquivo só.
 */
function derivarComConfig(peca, lado) {
  const bruto = join(BRUTO, peca.id)
  const publico = join(PUBLICO, peca.id)
  mkdirSync(bruto, { recursive: true })
  mkdirSync(publico, { recursive: true })
  const cfg = {
    origem: join(bruto, 'albedo-bruto.png'),
    bruto,
    publico,
    lado,
    banda: Math.round(lado * 0.09),
    raioCav: Math.max(3, Math.round(lado / 128)),
    altoPasso: peca.altoPasso,
    relevo: peca.relevo,
    rugosidade: peca.rugosidade,
    oclusao: peca.oclusao,
    refletancia: peca.refletancia,
  }
  const arquivo = join(tmpdir(), 'rotten-souls-derivador.py')
  writeFileSync(arquivo, DERIVADOR)
  execFileSync('python3', [arquivo], { input: JSON.stringify(cfg), stdio: ['pipe', 'inherit', 'inherit'] })
  return cfg
}

function lerManifesto() {
  if (!existsSync(MANIFESTO)) return { modelo: MODELO, pecas: {} }
  return JSON.parse(readFileSync(MANIFESTO, 'utf8'))
}

function gravarManifesto(m) {
  mkdirSync(BRUTO, { recursive: true })
  writeFileSync(MANIFESTO, `${JSON.stringify(m, null, 2)}\n`)
}

async function main() {
  const args = process.argv.slice(2)
  const forcar = args.includes('--forcar')
  const soDerivar = args.includes('--so-derivar')
  const soPrecos = args.includes('--precos')
  const lado = Number(args.find((a) => a.startsWith('--lado='))?.split('=')[1] ?? 1024)
  const pedidas = args.filter((a) => !a.startsWith('--'))
  const alvo = pedidas.length ? PECAS.filter((p) => pedidas.includes(p.id)) : PECAS
  if (!alvo.length) throw new Error(`peça desconhecida: ${pedidas.join(', ')}`)

  const chave = lerChave()
  const p = await preco(MODELO)
  const antes = await saldo(chave)
  console.log(`modelo ${MODELO}`)
  console.log(`  preço por token de imagem: US$ ${p.imagem}  (entrada ${p.entrada}, saída ${p.saida})`)
  console.log(`  saldo antes: US$ ${antes.restante.toFixed(4)}`)
  if (soPrecos) return

  const manifesto = lerManifesto()
  manifesto.modelo = MODELO
  let gastoNaRodada = 0

  for (const peca of alvo) {
    const bruto = join(BRUTO, peca.id)
    const albedo = join(bruto, 'albedo-bruto.png')
    mkdirSync(bruto, { recursive: true })

    if (!existsSync(albedo) || forcar) {
      if (soDerivar) {
        console.log(`${peca.id}: sem albedo e --so-derivar ligado, pulando`)
        continue
      }
      if (gastoNaRodada >= TETO) {
        console.log(`${peca.id}: teto de US$ ${TETO} alcançado, parando aqui`)
        break
      }
      process.stdout.write(`${peca.id}: gerando albedo ... `)
      const saida = await gerarAlbedo(chave, peca)
      writeFileSync(albedo, saida.bytes)
      const custo = await custoDaGeracao(chave, saida.id)
      if (custo != null) gastoNaRodada += custo
      console.log(`${(saida.bytes.length / 1024).toFixed(0)} KB, custo US$ ${custo != null ? custo.toFixed(5) : '?'}`)
      manifesto.pecas[peca.id] = {
        nome: peca.nome,
        uso: peca.uso,
        modelo: MODELO,
        prompt: saida.prompt,
        custoUSD: custo,
        data: new Date().toISOString(),
        metalicidade: peca.metalicidade,
        rugosidade: peca.rugosidade,
      }
    } else {
      console.log(`${peca.id}: albedo já existe, só derivando`)
    }

    derivarComConfig(peca, lado)
    const registro = manifesto.pecas[peca.id] ?? {}
    manifesto.pecas[peca.id] = {
      ...registro,
      nome: peca.nome,
      uso: peca.uso,
      metalicidade: peca.metalicidade,
      rugosidade: peca.rugosidade,
      derivacao: {
        altura: `luminância menos borrado de raio ${peca.altoPasso}, ganho 1,6`,
        normal: `Sobel na altura, força ${peca.relevo}, convenção OpenGL, vizinhança circular`,
        albedo: `refletância linear do percentil 90 normalizada em ${peca.refletancia}, com joelho no topo`,
        rugosidade: `luminância invertida remapeada em [${peca.rugosidade[0]}, ${peca.rugosidade[1]}]`,
        ao: `cavidade (borrado menos original) com ganho ${peca.oclusao}, suavizada`,
        metalness: `constante ${peca.metalicidade}, sem mapa`,
      },
      lado,
      derivadoEm: new Date().toISOString(),
    }
    gravarManifesto(manifesto)
    console.log(`${peca.id}: mapas em public/assets/textures/materiais/${peca.id}`)
  }

  const depois = await saldo(chave)
  console.log(`\nsaldo depois: US$ ${depois.restante.toFixed(4)}`)
  console.log(`gasto medido nesta rodada: US$ ${(antes.restante - depois.restante).toFixed(5)}`)
}

main().catch((erro) => {
  console.error(String(erro.message ?? erro))
  process.exitCode = 1
})
