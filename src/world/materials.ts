import {
  Color,
  MeshStandardNodeMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  TextureLoader,
  Vector2,
  type Texture,
  type WebGPURenderer,
} from 'three/webgpu'

export type MaterialName = 'chao' | 'muro' | 'degrau' | 'ferro' | 'rocha'

interface Spec {
  pasta: string
  /** Quantas vezes a textura se repete por metro. Escala importa mais que resolução. */
  escala: number
  cor: string
  rugosidade: number
  metalicidade: number
  /** Força do relevo. Pedra pede mais que metal. */
  relevo: number
}

const SPECS: Record<MaterialName, Spec> = {
  chao: { pasta: 'chao-lajota', escala: 0.42, cor: '#8d8b84', rugosidade: 0.82, metalicidade: 0, relevo: 1.1 },
  muro: { pasta: 'pedra-muro', escala: 0.34, cor: '#7d7c78', rugosidade: 0.95, metalicidade: 0, relevo: 1.35 },
  degrau: { pasta: 'pedra-degrau', escala: 0.5, cor: '#87857e', rugosidade: 0.9, metalicidade: 0, relevo: 1.1 },
  ferro: { pasta: 'ferro-oxidado', escala: 1.2, cor: '#6f6a63', rugosidade: 0.78, metalicidade: 0.85, relevo: 0.8 },
  rocha: { pasta: 'rocha-musgo', escala: 0.3, cor: '#7a7d70', rugosidade: 0.94, metalicidade: 0, relevo: 1.25 },
}

export type Materials = Record<MaterialName, MeshStandardNodeMaterial>

/**
 * Materiais de pedra do kit. Todos com cor, normal, rugosidade e oclusão, como
 * manda a seção 3: "usar mapas de normal e de oclusão sempre".
 *
 * A escala do UV é por metro, não por peça, então o mesmo material serve pra
 * um degrau e pra um muro de nove metros sem esticar a pedra.
 */
export async function loadMaterials(renderer: WebGPURenderer): Promise<Materials> {
  const loader = new TextureLoader()
  // Anisotropia 4 ja resolve o chao em angulo raso e custa metade da 8.
  const anisotropy = Math.min(4, renderer.getMaxAnisotropy?.() ?? 4)

  async function carregar(pasta: string, arquivo: string, colorido: boolean): Promise<Texture | null> {
    try {
      const texture = await loader.loadAsync(`assets/textures/${pasta}/${arquivo}.jpg`)
      texture.wrapS = RepeatWrapping
      texture.wrapT = RepeatWrapping
      texture.anisotropy = anisotropy
      if (colorido) texture.colorSpace = SRGBColorSpace
      return texture
    } catch {
      // Mapa ausente não é fatal: o material só perde aquele canal.
      return null
    }
  }

  const entries = await Promise.all(
    (Object.entries(SPECS) as Array<[MaterialName, Spec]>).map(async ([name, spec]) => {
      const [color, normal, roughness, ao] = await Promise.all([
        carregar(spec.pasta, 'color', true),
        carregar(spec.pasta, 'normal', false),
        carregar(spec.pasta, 'roughness', false),
        carregar(spec.pasta, 'ao', false),
      ])

      const material = new MeshStandardNodeMaterial({
        color: new Color(spec.cor),
        roughness: spec.rugosidade,
        metalness: spec.metalicidade,
      })
      if (color) material.map = color
      if (normal) {
        material.normalMap = normal
        material.normalScale = new Vector2(spec.relevo, spec.relevo)
      }
      if (roughness) material.roughnessMap = roughness
      if (ao) {
        material.aoMap = ao
        // O kit não gera um segundo canal de UV, então a oclusão lê o primeiro.
        material.aoMap.channel = 0
        material.aoMapIntensity = 1
      }
      return [name, material] as const
    }),
  )

  const materials = Object.fromEntries(entries) as Materials
  return materials
}

/** Repetição de UV em unidades de mundo, aplicada por peça do kit. */
export function uvScale(name: MaterialName): number {
  return SPECS[name].escala
}
