import { MeshStandardNodeMaterial, type Texture } from 'three/webgpu'
import { float, smoothstep, texture, uniform, vec3 } from 'three/tsl'

/**
 * Material do Vharen definitivo.
 *
 * O modelo gerado traz as brasas pintadas no mapa de cor, mas cor pintada não
 * brilha: sem emissivo ela some no escuro da arena. Marcar as brasas à mão num
 * segundo mapa daria trabalho e um arquivo a mais, então o emissivo é derivado
 * do próprio mapa de cor: o que é quente e claro acende, o que é ferro escuro
 * não. Uma subtração e um `smoothstep` por pixel, custo desprezível.
 */
export function buildEmberMaterial(maps: {
  color: Texture
  normal?: Texture | null
  roughness?: Texture | null
  metalness?: Texture | null
}): { material: MeshStandardNodeMaterial; emberIntensity: { value: number } } {
  const emberIntensity = uniform(2.6)

  const material = new MeshStandardNodeMaterial({
    roughness: 0.66,
    metalness: 0.78,
  })

  const base = texture(maps.color)
  material.colorNode = base

  if (maps.normal) material.normalMap = maps.normal
  if (maps.roughness) material.roughnessMap = maps.roughness
  if (maps.metalness) material.metalnessMap = maps.metalness

  // "Quentura": quanto o vermelho passa do azul, pesado pelo próprio brilho.
  // Brasa laranja tem vermelho alto e azul baixo; ferro escuro tem os dois baixos.
  const warmth = base.r.sub(base.b).mul(base.r)
  const mask = smoothstep(float(0.14), float(0.42), warmth)
  material.emissiveNode = base.rgb.mul(vec3(1.15, 0.72, 0.34)).mul(mask).mul(emberIntensity)

  return { material, emberIntensity }
}
