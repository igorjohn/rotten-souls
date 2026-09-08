import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  FrontSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardNodeMaterial,
  Object3D,
  RepeatWrapping,
  SRGBColorSpace,
  SphereGeometry,
  TextureLoader,
  type BufferGeometry as Geometry,
  type Texture,
  type WebGPURenderer,
} from 'three/webgpu'
import { float, normalMap, texture, uv, vec2, vec3 } from 'three/tsl'

/**
 * Biblioteca de materiais de personagem e as peças que dependem dela.
 *
 * Os conjuntos são nomeados pela peça, nunca pelo personagem: o chefe veste o
 * mesmo aço de placa e o mesmo tecido que o jogador. O que muda entre os dois
 * é só a densidade do ladrilho, porque o chefe tem duas vezes e meia a altura
 * e a mesma textura no mesmo tamanho o deixaria com cara de brinquedo.
 *
 * Os mapas vêm de `scripts/gen-textura.mjs`: o albedo é gerado, o resto é
 * derivado dele por código. Metalicidade é constante por peça e não tem mapa.
 */

export type ArmorPart =
  | 'acoDePlaca'
  | 'malhaDeFerro'
  | 'couro'
  | 'tecido'
  | 'acoDeLamina'
  | 'latao'

interface PartSpec {
  pasta: string
  /**
   * Tingimento por cima do albedo, um botão de look dev. Fica em branco porque
   * o albedo gerado já sai na cor e na refletância certas; serve pra variar a
   * peça (uma capa de outra cor, por exemplo) sem gerar textura nova.
   */
  cor: string
  metalicidade: number
  /** Multiplica a rugosidade do mapa. Abaixo de 1 dá mais brilho especular. */
  rugosidade: number
  /** Força do relevo do normal. */
  relevo: number
  /** Repetições da textura por metro de superfície, na escala do jogador. */
  repeticoesPorMetro: number
  /** Peça de casca fina (capa, correia, tabardo): precisa das duas faces. */
  doisLados?: boolean
}

const SPECS: Record<ArmorPart, PartSpec> = {
  // Placa: o acento frio do briefing. Cinza-azulado, quase sem brilho, e o
  // pouco que reflete é a lua.
  acoDePlaca: { pasta: 'aco-placa', cor: '#ffffff', metalicidade: 1, rugosidade: 1, relevo: 1.1, repeticoesPorMetro: 2.6 },
  // Malha: anel pequeno, então ladrilha muito mais denso que a placa.
  malhaDeFerro: { pasta: 'malha-ferro', cor: '#ffffff', metalicidade: 1, rugosidade: 1, relevo: 1.5, repeticoesPorMetro: 7 },
  couro: { pasta: 'couro', cor: '#ffffff', metalicidade: 0, rugosidade: 1, relevo: 1.2, repeticoesPorMetro: 3.2, doisLados: true },
  tecido: { pasta: 'tecido', cor: '#ffffff', metalicidade: 0, rugosidade: 1, relevo: 1.3, repeticoesPorMetro: 3.6, doisLados: true },
  // Lâmina: a única peça com direito a brilho de verdade. A rugosidade do mapa
  // ainda é rebaixada, senão o fio não pega a luz do braseiro.
  acoDeLamina: { pasta: 'aco-lamina', cor: '#ffffff', metalicidade: 1, rugosidade: 0.82, relevo: 0.8, repeticoesPorMetro: 1.4 },
  latao: { pasta: 'latao', cor: '#ffffff', metalicidade: 1, rugosidade: 0.95, relevo: 1, repeticoesPorMetro: 5.5 },
}

export type ArmorMaterials = Record<ArmorPart, MeshStandardNodeMaterial>

export interface ArmorOptions {
  /**
   * Altura do personagem em relação ao jogador. O chefe é 2,5, o jogador é 1.
   * O ladrilho é multiplicado por isto, então a trama do tecido e o anel da
   * malha continuam do mesmo tamanho físico nos dois.
   */
  alturaRelativa?: number
}

const MAPAS = ['color', 'normal', 'roughness', 'ao'] as const
type MapaNome = (typeof MAPAS)[number]

/**
 * As texturas são carregadas uma vez e compartilhadas entre todos os conjuntos.
 * O ladrilho não mora mais no `repeat` da textura, e sim no nó de UV do
 * material, justamente pra que jogador e chefe usem o mesmo upload de GPU. São
 * vinte e quatro imagens de 1024; duplicar isso custaria uma centena de
 * megabytes de VRAM sem devolver um pixel a mais.
 */
const cache = new Map<string, Promise<Texture | null>>()

function carregar(loader: TextureLoader, pasta: string, mapa: MapaNome, anisotropy: number): Promise<Texture | null> {
  const url = `assets/textures/materiais/${pasta}/${mapa}.webp`
  const pronto = cache.get(url)
  if (pronto) return pronto

  const promessa = loader
    .loadAsync(url)
    .then((tex) => {
      tex.wrapS = RepeatWrapping
      tex.wrapT = RepeatWrapping
      tex.anisotropy = anisotropy
      if (mapa === 'color') tex.colorSpace = SRGBColorSpace
      return tex
    })
    // Mapa ausente não derruba o jogo: a peça só perde aquele canal.
    .catch(() => null)

  cache.set(url, promessa)
  return promessa
}

/**
 * Carrega a biblioteca inteira. Chamar duas vezes, uma pro jogador e outra pro
 * chefe com `alturaRelativa: 2.5`, é barato: só os materiais são novos.
 */
export async function loadArmorMaterials(
  renderer: WebGPURenderer,
  options: ArmorOptions = {},
): Promise<ArmorMaterials> {
  const alturaRelativa = options.alturaRelativa ?? 1
  const loader = new TextureLoader()
  const anisotropy = Math.min(4, renderer.getMaxAnisotropy?.() ?? 4)

  const entradas = await Promise.all(
    (Object.entries(SPECS) as Array<[ArmorPart, PartSpec]>).map(async ([nome, spec]) => {
      const [cor, norm, rug, ao] = await Promise.all(
        MAPAS.map((m) => carregar(loader, spec.pasta, m, anisotropy)),
      )

      const material = new MeshStandardNodeMaterial({
        color: new Color(spec.cor),
        metalness: spec.metalicidade,
        roughness: 1,
        side: spec.doisLados ? DoubleSide : FrontSide,
      })
      material.name = `armadura-${nome}`

      // Um único nó de UV serve os quatro mapas. É aqui que a escala do
      // personagem entra, e é por isso que a textura não precisa ser clonada.
      const escala = spec.repeticoesPorMetro * alturaRelativa
      const uvNode = uv().mul(escala)

      // O tingimento entra como nó: `.mul` não aceita Color na tipagem, e a
      // Color já chega em linear porque o gerenciamento de cor do Three
      // converte o hex de sRGB na construção.
      const tinta = new Color(spec.cor)
      if (cor) material.colorNode = texture(cor, uvNode).mul(vec3(tinta.r, tinta.g, tinta.b))
      if (norm) material.normalNode = normalMap(texture(norm, uvNode), vec2(spec.relevo, spec.relevo))
      if (rug) material.roughnessNode = texture(rug, uvNode).r.mul(spec.rugosidade)
      else material.roughness = 0.9
      if (ao) material.aoNode = texture(ao, uvNode).r
      material.metalnessNode = float(spec.metalicidade)

      return [nome, material] as const
    }),
  )

  return Object.fromEntries(entradas) as ArmorMaterials
}

/** Quantas repetições por metro cada peça usa, já com a altura do personagem. */
export function tileScale(part: ArmorPart, alturaRelativa = 1): number {
  return SPECS[part].repeticoesPorMetro * alturaRelativa
}

/**
 * As geometrias do kit chegam com UV de zero a um por face, que é uma escala
 * arbitrária. Reescalar a UV pro tamanho da peça em metros faz o ladrilho ficar
 * físico: a mesma trama de tecido no elmo e na capa.
 *
 * Exportada porque quem colar estes materiais em outra malha precisa da mesma
 * convenção, senão o ladrilho sai em outra escala.
 */
export function uvEmMetros(geometry: Geometry, largura: number, altura: number): Geometry {
  const attr = geometry.attributes.uv as BufferAttribute | undefined
  if (!attr) return geometry
  for (let i = 0; i < attr.count; i++) {
    attr.setXY(i, attr.getX(i) * largura, attr.getY(i) * altura)
  }
  attr.needsUpdate = true
  return geometry
}

/** Ruído determinístico. A barra puída da capa tem que ser a mesma toda vez. */
function ruido(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return s - Math.floor(s)
}

export interface HelmOptions {
  /** Altura do elmo em metros, do queixo ao topo. */
  altura?: number
}

/**
 * Elmo fechado, no espírito do `buildGreatsword`: primitivas montadas, sem
 * asset externo. O que faz um elmo de Souls ler no escuro não é detalhe fino,
 * é a silhueta e a fresta preta onde deveria haver rosto.
 *
 * A fresta sai sem recorte booleano. A casca é partida em duas na altura dos
 * olhos, e o anel de sombra que sobra entre as metades deixa ver o forro
 * escuro por dentro. Uma barra de latão desce pela frente atravessando o vão,
 * que é o que transforma a faixa preta em cara.
 */
export function buildHelm(materials: ArmorMaterials, options: HelmOptions = {}): Object3D {
  const altura = options.altura ?? 0.28
  const r = altura * 0.42
  const grupo = new Group()
  grupo.name = 'elmo'

  // Fresta na altura dos olhos, medida a partir do centro do elmo.
  const frestaBase = altura * 0.105
  const frestaTopo = altura * 0.15

  /** Anel da casca, do queixo pro topo. Afunila de leve pra baixo. */
  function anel(de: number, ate: number): Mesh {
    const raio = (t: number) => r * (0.9 + 0.1 * t)
    const t0 = (de + altura / 2) / altura
    const t1 = (ate + altura / 2) / altura
    const g = new CylinderGeometry(raio(t1), raio(t0), ate - de, 24, 1, true)
    uvEmMetros(g, 2 * Math.PI * r, ate - de)
    const m = new Mesh(g, materials.acoDePlaca)
    m.position.y = (de + ate) / 2
    return m
  }

  grupo.add(anel(-altura / 2, frestaBase))
  grupo.add(anel(frestaTopo, altura / 2))

  // Forro. Fica logo atrás da fresta e é o preto que se vê pelo vão.
  const forro = new CylinderGeometry(r * 0.86, r * 0.82, altura, 18, 1, false)
  uvEmMetros(forro, 2 * Math.PI * r * 0.86, altura)
  const forroMesh = new Mesh(forro, materials.malhaDeFerro)
  grupo.add(forroMesh)

  // Calota do topo, no mesmo raio da casca pra não virar aba de chapéu.
  const calota = new SphereGeometry(r, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2)
  uvEmMetros(calota, 2 * Math.PI * r, r)
  const calotaMesh = new Mesh(calota, materials.acoDePlaca)
  calotaMesh.position.y = altura / 2
  calotaMesh.scale.y = 0.42
  grupo.add(calotaMesh)

  // Crista: um filete que corre da testa à nuca por cima da calota.
  const crista = new BoxGeometry(r * 0.13, altura * 0.1, r * 2.05)
  uvEmMetros(crista, r * 0.3, altura * 0.1)
  const cristaMesh = new Mesh(crista, materials.latao)
  cristaMesh.position.y = altura / 2 + altura * 0.04
  grupo.add(cristaMesh)

  // Barra vertical da frente, atravessando a fresta. É ela que dá o rosto.
  const barra = new BoxGeometry(r * 0.16, altura * 0.62, r * 0.14)
  uvEmMetros(barra, r * 0.4, altura * 0.62)
  const barraMesh = new Mesh(barra, materials.latao)
  barraMesh.position.set(0, altura * 0.05, r * 0.93)
  grupo.add(barraMesh)

  // Respiros: duas fileiras de furos na queixeira, sugeridos por relevo.
  const respiro = new BoxGeometry(r * 0.07, r * 0.07, r * 0.06)
  const respiros = new InstancedMesh(respiro, materials.latao, 6)
  const m4 = new Matrix4()
  for (let i = 0; i < 6; i++) {
    const a = (i - 2.5) * 0.17
    const y = i % 2 === 0 ? -altura * 0.06 : -altura * 0.14
    m4.makeTranslation(Math.sin(a) * r * 0.93, y, Math.cos(a) * r * 0.93)
    respiros.setMatrixAt(i, m4)
  }
  respiros.instanceMatrix.needsUpdate = true
  grupo.add(respiros)

  // Aro de reforço do queixo, em couro.
  const aro = new CylinderGeometry(r * 0.93, r * 0.92, altura * 0.06, 22, 1, true)
  uvEmMetros(aro, 2 * Math.PI * r, altura * 0.06)
  const aroMesh = new Mesh(aro, materials.couro)
  aroMesh.position.y = -altura * 0.45
  grupo.add(aroMesh)

  // Gola de malha, saindo por baixo do elmo e abrindo no ombro.
  const gola = new CylinderGeometry(r * 0.94, r * 1.5, altura * 0.44, 20, 2, true)
  uvEmMetros(gola, 2 * Math.PI * r * 1.2, altura * 0.44)
  const golaMesh = new Mesh(gola, materials.malhaDeFerro)
  golaMesh.position.y = -altura * 0.68
  grupo.add(golaMesh)

  // Rebites de latão numa malha instanciada: dez peças, uma chamada de desenho.
  const rebite = new SphereGeometry(r * 0.05, 6, 4)
  uvEmMetros(rebite, r * 0.12, r * 0.12)
  const rebites = new InstancedMesh(rebite, materials.latao, 10)
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.3
    m4.makeTranslation(Math.sin(a) * r * 0.94, altura * 0.38, Math.cos(a) * r * 0.94)
    rebites.setMatrixAt(i, m4)
  }
  rebites.instanceMatrix.needsUpdate = true
  grupo.add(rebites)

  grupo.traverse((child) => {
    const mesh = child as Mesh
    if (mesh.isMesh) {
      mesh.castShadow = true
      mesh.receiveShadow = true
    }
  })
  return grupo
}

export interface CapeOptions {
  /** Comprimento da capa em metros, do ombro à barra. */
  comprimento?: number
  /** Meia largura do arco que ela cobre nos ombros, em radianos. */
  arco?: number
  /** Raio do ombro em metros. */
  ombro?: number
}

/**
 * Capa: uma malha em grade, presa num arco de ombro e caindo em pregas, com a
 * barra puída. É casca de uma face só, então o material vai com `DoubleSide`.
 *
 * A barra irregular é o detalhe que mais rende: contra a névoa, o que se lê é
 * a silhueta, e uma barra reta entrega que a capa é um plano.
 */
export function buildCape(materials: ArmorMaterials, options: CapeOptions = {}): Object3D {
  const comprimento = options.comprimento ?? 1.05
  const arco = options.arco ?? Math.PI * 0.62
  const ombro = options.ombro ?? 0.21

  const colunas = 30
  const linhas = 22
  const posicoes: number[] = []
  const uvs: number[] = []

  for (let j = 0; j <= linhas; j++) {
    const v = j / linhas
    for (let i = 0; i <= colunas; i++) {
      const u = i / colunas
      // O arco abre pouco: se abrir muito, a capa fecha nas costas e vira saia.
      const a = (u - 0.5) * arco * (1 + v * 0.18)

      // A barra é puída: cada coluna termina num comprimento próprio, com um
      // rasgo fundo de vez em quando.
      const rasgo =
        ruido(i * 3.7) * 0.1 + ruido(i * 13.1) * 0.13 + (ruido(i * 1.3) > 0.82 ? 0.15 : 0)
      const fim = comprimento * (1 - rasgo)

      // Pregas: duas frequências, pra não virar ondulação de desenho animado.
      const prega =
        (Math.sin(u * Math.PI * 4.5 + 0.6) * 0.055 + Math.sin(u * Math.PI * 9.3) * 0.018) * v

      // O raio cresce com o quadrado da descida: cola no ombro e só abre
      // embaixo, que é como um pano pesado cai.
      const raio = ombro + v * v * 0.3 + prega

      posicoes.push(Math.sin(a) * raio, -fim * v, -Math.cos(a) * raio - v * v * 0.12)
      // UV em metros, pra trama do tecido casar com a do tabardo.
      uvs.push(u * arco * ombro, v * comprimento)
    }
  }

  const indices: number[] = []
  for (let j = 0; j < linhas; j++) {
    for (let i = 0; i < colunas; i++) {
      const a = j * (colunas + 1) + i
      const b = a + colunas + 1
      indices.push(a, b, a + 1, a + 1, b, b + 1)
    }
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(posicoes), 3))
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()

  const mesh = new Mesh(geometry, materials.tecido)
  mesh.name = 'capa'
  mesh.castShadow = true
  mesh.receiveShadow = true

  const grupo = new Group()
  grupo.name = 'capa'
  grupo.add(mesh)

  // Gola de couro que prende a capa, e as duas fivelas de latão.
  const gola = new CylinderGeometry(ombro * 1.04, ombro * 1.02, 0.045, 20, 1, true, -arco / 2, arco)
  uvEmMetros(gola, ombro * arco, 0.045)
  const golaMesh = new Mesh(gola, materials.couro)
  golaMesh.rotation.y = Math.PI
  golaMesh.position.y = 0.012
  grupo.add(golaMesh)

  const fivela = new SphereGeometry(0.019, 8, 6)
  uvEmMetros(fivela, 0.045, 0.045)
  const fivelas = new InstancedMesh(fivela, materials.latao, 2)
  const m4 = new Matrix4()
  for (let i = 0; i < 2; i++) {
    const a = (i === 0 ? -1 : 1) * arco * 0.36
    m4.makeTranslation(Math.sin(a) * ombro * 1.06, 0.012, -Math.cos(a) * ombro * 1.06)
    fivelas.setMatrixAt(i, m4)
  }
  fivelas.instanceMatrix.needsUpdate = true
  grupo.add(fivelas)

  golaMesh.castShadow = true
  return grupo
}

/** Soma de triângulos das peças, pro orçamento da seção 4 não passar batido. */
export function countTriangles(root: Object3D): number {
  let total = 0
  root.traverse((child) => {
    const mesh = child as Mesh & { count?: number }
    if (!mesh.isMesh) return
    const g = mesh.geometry as BufferGeometry
    const tris = g.index ? g.index.count / 3 : (g.attributes.position?.count ?? 0) / 3
    total += tris * (mesh.count ?? 1)
  })
  return Math.round(total)
}
