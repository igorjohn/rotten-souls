import {
  ACESFilmicToneMapping,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  EquirectangularReflectionMapping,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardNodeMaterial,
  PerspectiveCamera,
  PointLight,
  Scene,
  SphereGeometry,
  WebGPURenderer,
} from 'three/webgpu'
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js'
import {
  buildCape,
  buildHelm,
  countTriangles,
  loadArmorMaterials,
  uvEmMetros,
  type ArmorMaterials,
  type ArmorPart,
} from '../entities/armor'
import { exposeScreenshotHelper, flushScreenshot, requestScreenshot } from './screenshot'

/**
 * Banca de teste da biblioteca de materiais dos personagens. Só desenvolvimento.
 *
 * A verificação da seção 8 pede olhar cada material aplicado antes de aprovar,
 * e olhar dentro do jogo custaria atrapalhar quem estiver jogando. Então esta
 * página monta a mesma luz da arena (lua fria atrás e em cima, braseiro quente
 * na frente, exposição baixa) num palco vazio.
 *
 *   /materiais.html                    as seis peças lado a lado
 *   /materiais.html?peca=aco-placa     uma peça em close
 *   /materiais.html?montado=1          elmo e capa montados
 */

const PECAS: Array<{ id: ArmorPart; pasta: string; nome: string }> = [
  { id: 'acoDePlaca', pasta: 'aco-placa', nome: 'Aço oxidado de placa' },
  { id: 'malhaDeFerro', pasta: 'malha-ferro', nome: 'Malha de ferro' },
  { id: 'couro', pasta: 'couro', nome: 'Couro escuro' },
  { id: 'tecido', pasta: 'tecido', nome: 'Tecido pesado' },
  { id: 'acoDeLamina', pasta: 'aco-lamina', nome: 'Aço da lâmina' },
  { id: 'latao', pasta: 'latao', nome: 'Latão gasto' },
]

const RAIO = 0.36

/** Esfera com a UV já em metros, pra o ladrilho sair na densidade de verdade. */
function amostra(material: MeshStandardNodeMaterial): Mesh {
  const g = new SphereGeometry(RAIO, 64, 48)
  uvEmMetros(g, 2 * Math.PI * RAIO, Math.PI * RAIO)
  const m = new Mesh(g, material)
  m.castShadow = true
  return m
}

/**
 * Corpo de apoio pro elmo e a capa: tronco e pescoço, nada mais. O foco são as
 * duas peças, o resto só existe pra elas não flutuarem no vazio.
 */
function manequim(materials: ArmorMaterials): Group {
  const grupo = new Group()

  const tronco = new SphereGeometry(0.23, 32, 24)
  uvEmMetros(tronco, 1.45, 0.72)
  const peito = new Mesh(tronco, materials.acoDePlaca)
  peito.scale.set(1, 1.45, 0.7)
  peito.position.y = -0.52
  grupo.add(peito)

  const pescoco = new CylinderGeometry(0.085, 0.11, 0.14, 16, 1, true)
  uvEmMetros(pescoco, 0.6, 0.14)
  const gargantilha = new Mesh(pescoco, materials.malhaDeFerro)
  gargantilha.position.y = -0.21
  grupo.add(gargantilha)

  grupo.traverse((child) => {
    const mesh = child as Mesh
    if (mesh.isMesh) mesh.castShadow = true
  })
  return grupo
}

async function main(): Promise<void> {
  const canvas = document.getElementById('preview') as HTMLCanvasElement
  const renderer = new WebGPURenderer({ canvas, antialias: true })
  try {
    await renderer.init()
  } catch {
    // Mesmo caminho do jogo: sem adaptador, cai pro WebGL2 e continua.
    await new WebGPURenderer({ canvas, antialias: true, forceWebGL: true }).init()
  }
  renderer.toneMapping = ACESFilmicToneMapping
  renderer.toneMappingExposure = 0.86
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))

  const scene = new Scene()
  scene.background = new Color('#05070c')
  const camera = new PerspectiveCamera(38, 1, 0.05, 60)

  // Céu noturno do próprio jogo, só como luz de ambiente.
  const hdri = await new RGBELoader().loadAsync('assets/hdri/moonlit_golf_1k.hdr')
  hdri.mapping = EquirectangularReflectionMapping
  scene.environment = hdri
  // Os números daqui pra baixo são os mesmos de src/main.ts e
  // src/world/lighting.ts. O que se aprova aqui é o que se vê na arena.
  scene.environmentIntensity = 0.1

  // Lua fria, na cor e na intensidade da arena. A direção é a única coisa
  // escolhida aqui: de trás e de cima o sujeito ficaria só de silhueta, e a
  // banca existe pra ver o material. Ela vem da esquerda e de cima, contra o
  // braseiro que vem da direita, que é o contraste frio/quente da seção 3.
  const lua = new DirectionalLight(new Color('#8fa9c9'), 1.05)
  lua.position.set(-2.6, 3.4, 1.6)
  scene.add(lua)
  // Braseiros. São dois porque na arena são doze espalhados pelo anel e um
  // personagem em pé nunca fica no alcance de um só; com um, metade da peça
  // some no preto e não dá pra julgar nada.
  const fogo = new PointLight(new Color('#ff8a2a'), 15, 12, 2)
  fogo.position.set(1.6, 0.6, 2.0)
  scene.add(fogo)
  const fogoDistante = new PointLight(new Color('#ff8a2a'), 9, 10, 2)
  fogoDistante.position.set(-2.0, 1.1, 0.4)
  scene.add(fogoDistante)
  scene.add(new HemisphereLight(new Color('#8fa9c9').getHex(), 0x140f0a, 0.06))

  const params = new URLSearchParams(location.search)
  const materials = await loadArmorMaterials(renderer, { alturaRelativa: 1 })
  const legenda = document.getElementById('legenda') as HTMLElement
  const palco = new Group()
  scene.add(palco)

  const umaPeca = params.get('peca')
  const montado = params.get('montado') === '1'

  // Chão só pra assentar as peças; a esfera solta no vazio engana o olho. Na
  // grade de seis ele desce, senão a fileira de baixo afunda nele.
  const chao = new Mesh(
    new CircleGeometry(6, 48),
    new MeshStandardNodeMaterial({ color: new Color('#0b0d12'), roughness: 0.95 }),
  )
  chao.rotation.x = -Math.PI / 2
  chao.position.y = montado ? -0.62 : -0.95
  scene.add(chao)

  if (montado) {
    const elmo = buildHelm(materials)
    const capa = buildCape(materials, { comprimento: 1.0, ombro: 0.24, arco: Math.PI * 0.86 })
    const corpo = manequim(materials)
    // O elmo assenta em cima do pescoço, a capa sai da linha do ombro.
    elmo.position.y = 0.02
    capa.position.y = -0.26
    palco.add(corpo, elmo, capa)

    if (params.get('so') === 'elmo') {
      capa.visible = false
      corpo.visible = false
      palco.rotation.y = -0.42
      camera.position.set(0, 0.03, 0.86)
      camera.lookAt(0, -0.02, 0)
    } else if (params.get('so') === 'capa') {
      palco.rotation.y = Math.PI * 0.86
      camera.position.set(0, -0.16, 2.05)
      camera.lookAt(0, -0.56, 0)
    } else {
      // Três quartos por trás: é o ângulo em que a capa abre na tela e o elmo
      // ainda entrega a silhueta.
      palco.rotation.y = Math.PI * 0.76
      // O conjunto tem quase um metro e meio do alto do elmo à barra da capa.
      // Em vez de aproximar a câmera, fecha-se o ângulo: assim o sujeito enche
      // o quadro sem sair do alcance dos braseiros, que caem com o quadrado.
      // Do topo da crista à barra da capa dá 1,45 m; a 2,5 m de distância, 36
      // graus cobrem 1,62 m e sobra uma margem.
      camera.fov = 36
      camera.position.set(0.9, -0.2, 2.5)
      camera.lookAt(0, -0.53, 0)
      // Braseiros trazidos pra perto: o corpo inteiro é bem maior que uma
      // esfera de amostra e a queda quadrática apagaria a metade de baixo.
      fogo.position.set(1.25, 0.05, 1.15)
      fogoDistante.position.set(-1.35, 0.55, 0.3)
    }
    legenda.textContent =
      `elmo ${countTriangles(elmo)} tri · capa ${countTriangles(capa)} tri · ` +
      `total ${countTriangles(elmo) + countTriangles(capa)} tri`
  } else if (umaPeca) {
    const peca = PECAS.find((p) => p.pasta === umaPeca)
    if (!peca) throw new Error(`peça desconhecida: ${umaPeca}`)
    const esfera = amostra(materials[peca.id])
    esfera.scale.setScalar(1.35)
    palco.add(esfera)
    camera.position.set(0, 0.16, 1.62)
    camera.lookAt(0, 0, 0)
    legenda.textContent = peca.nome
  } else {
    PECAS.forEach((peca, i) => {
      const esfera = amostra(materials[peca.id])
      esfera.position.set((i % 3) - 1, i < 3 ? 0.42 : -0.42, 0)
      esfera.position.x *= 0.92
      palco.add(esfera)
    })
    camera.position.set(0, 0, 3.15)
    camera.lookAt(0, 0, 0)
    legenda.textContent = PECAS.map((p) => p.nome).join(' · ')
  }

  // Com o painel do navegador escondido, innerWidth vem zero e o WebGPU recusa
  // uma textura de tamanho nulo. O piso também deixa o screenshot reprodutível.
  function resize(): void {
    const w = Math.max(innerWidth, 1440)
    const h = Math.max(innerHeight, 810)
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }
  addEventListener('resize', resize)
  resize()

  function draw(): void {
    renderer.render(scene, camera)
  }

  const contexto = {
    renderer,
    drawFrame: draw,
    size: () => ({ width: renderer.domElement.width, height: renderer.domElement.height }),
  }

  exposeScreenshotHelper()
  // Captura sob demanda, sem depender do laço de animação: numa aba em segundo
  // plano o requestAnimationFrame fica parado e a foto nunca sairia.
  window.capturar = (nome: string) => {
    const pronto = requestScreenshot(nome)
    draw()
    flushScreenshot(contexto)
    return pronto
  }

  renderer.setAnimationLoop(() => {
    draw()
    flushScreenshot(contexto)
  })
}

declare global {
  interface Window {
    capturar: (nome: string) => Promise<string>
  }
}

void main().catch((erro) => {
  const legenda = document.getElementById('legenda')
  if (legenda) legenda.textContent = String(erro)
  console.error(erro)
})
