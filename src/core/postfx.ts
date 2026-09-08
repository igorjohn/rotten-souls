import { PostProcessing, type PerspectiveCamera, type Scene, type WebGPURenderer } from 'three/webgpu'
import {
  Fn,
  float,
  mix,
  mrt,
  normalView,
  oneMinus,
  output,
  pass,
  rand,
  renderOutput,
  screenUV,
  smoothstep,
  time,
  uniform,
  vec3,
  vec4,
} from 'three/tsl'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'
import { ao } from 'three/addons/tsl/display/GTAONode.js'
import type { Backend } from './renderer'

/** Tudo que o painel de look dev mexe em tempo real. */
function createControls() {
  return {
    exposure: uniform(1.32),
    bloomStrength: uniform(0.42),
    bloomRadius: uniform(0.85),
    bloomThreshold: uniform(0.62),
    aoIntensity: uniform(0.8),
    vignette: uniform(0.8),
    grain: uniform(0.028),
    shadowTint: uniform(1),
    highlightTint: uniform(0.6),
    saturation: uniform(1.06),
  }
}

export type PostFxControls = ReturnType<typeof createControls>

export interface PostFx {
  processing: PostProcessing
  controls: PostFxControls
  setSize(width: number, height: number): void
  render(): void
}

/**
 * Pipeline de pós-processo. Bloom baixo e largo pro fogo respirar sem estourar,
 * oclusão de ambiente pra assentar os objetos no chão, color grading puxando
 * azul-esverdeado nas sombras e âmbar nas luzes, vinheta leve e grão fino.
 * Em WebGL2 a oclusão de ambiente sai, que é a parte cara.
 */
export function buildPostFx(
  renderer: WebGPURenderer,
  scene: Scene,
  camera: PerspectiveCamera,
  backend: Backend,
): PostFx {
  const controls = createControls()

  const scenePass = pass(scene, camera)
  scenePass.setMRT(mrt({ output, normal: normalView }))

  const colorNode = scenePass.getTextureNode('output')
  const depthNode = scenePass.getTextureNode('depth')
  const normalNode = scenePass.getTextureNode('normal')

  const aoPass = backend === 'webgpu' ? ao(depthNode, normalNode, camera) : null
  if (aoPass) {
    aoPass.distanceExponent.value = 1
    aoPass.distanceFallOff.value = 1
    aoPass.radius.value = 0.3
    aoPass.scale.value = 1
    aoPass.thickness.value = 1
    aoPass.samples.value = 16
    // Meia resolucao. A oclusao e de baixa frequencia, ninguem percebe.
    aoPass.resolutionScale = 0.5
  }

  // O GTAONode desenha num alvo proprio de canal unico. Ler o no direto entrega
  // o resultado do setup, nao a textura, e a cena inteira vai a quase zero.
  const occluded = aoPass
    ? colorNode.mul(mix(float(1), aoPass.getTextureNode().r, controls.aoIntensity))
    : colorNode

  const bloomPass = bloom(
    occluded,
    controls.bloomStrength,
    controls.bloomRadius,
    controls.bloomThreshold,
  )

  // Exposicao e grading em espaco linear, antes do tonemapping. Nada de clamp
  // aqui: cortar em 1 antes do tonemapping mata o alcance dinamico e o bloom
  // do fogo vira um borrao chapado.
  const linear = Fn(() => {
    const raw = occluded.add(bloomPass)
    const rgb = raw.rgb.mul(controls.exposure)

    // Luminancia percebida, pra saber o que e sombra e o que e luz.
    const lum = rgb.dot(vec3(0.2126, 0.7152, 0.0722))

    // Sombra puxa azul-esverdeado, luz puxa ambar. E o grading do briefing.
    const shadowMask = oneMinus(smoothstep(0, 0.28, lum))
    const highlightMask = smoothstep(0.22, 1.4, lum)
    const cool = vec3(0.74, 0.95, 1.04)
    const warm = vec3(1.08, 0.98, 0.84)
    const white = vec3(1, 1, 1)
    const tinted = rgb
      .mul(mix(white, cool, shadowMask.mul(controls.shadowTint)))
      .mul(mix(white, warm, highlightMask.mul(controls.highlightTint)))

    return vec4(tinted, raw.a)
  })()

  // renderOutput aplica tonemapping e espaco de cor. Vinheta e grao vem depois,
  // ja em espaco de exibicao, senao o grao explode nas sombras.
  const displayed = renderOutput(linear)

  const graded = Fn(() => {
    const rgb = displayed.rgb

    const grey = rgb.dot(vec3(0.2126, 0.7152, 0.0722))
    const saturated = mix(vec3(grey, grey, grey), rgb, controls.saturation)

    // Vinheta: escurece as pontas sem chapar o centro.
    const radial = screenUV.sub(0.5).length()
    const vignetteMask = oneMinus(smoothstep(0.34, 0.86, radial).mul(controls.vignette))

    // Grao fino, animado. Sobe nas sombras e some nas luzes, como filme.
    const noise = rand(screenUV.add(time.mul(0.37))).sub(0.5)
    const grainAmount = controls.grain.mul(oneMinus(smoothstep(0.05, 0.6, grey)).add(0.25))

    const finalColor = saturated.mul(vignetteMask).add(noise.mul(grainAmount))
    return vec4(finalColor.clamp(0, 1), displayed.a)
  })()

  const processing = new PostProcessing(renderer)
  processing.outputColorTransform = false
  processing.outputNode = graded

  return {
    processing,
    controls,
    setSize(width, height) {
      aoPass?.setSize(width, height)
    },
    render() {
      processing.render()
    },
  }
}
