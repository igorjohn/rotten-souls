import {
  EquirectangularReflectionMapping,
  LoadingManager,
  type Texture,
} from 'three/webgpu'
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js'
import type { WebGPURenderer } from 'three/webgpu'

export type ProgressFn = (ratio: number, label: string) => void

/**
 * Loader único do jogo. Sabe de Draco, Meshopt e KTX2 porque nada entra em
 * public/assets sem passar pelo optimize-assets.sh.
 */
export class Assets {
  readonly manager = new LoadingManager()
  private readonly hdr = new HDRLoader(this.manager)
  private readonly gltf: GLTFLoader
  private readonly cache = new Map<string, unknown>()
  private onProgress: ProgressFn = () => {}
  private label = ''

  constructor(renderer: WebGPURenderer) {
    const draco = new DRACOLoader(this.manager).setDecoderPath(
      'https://www.gstatic.com/draco/versioned/decoders/1.5.7/',
    )
    const ktx2 = new KTX2Loader(this.manager)
      .setTranscoderPath('https://unpkg.com/three@0.185.1/examples/jsm/libs/basis/')
      .detectSupport(renderer as never)

    this.gltf = new GLTFLoader(this.manager)
      .setDRACOLoader(draco)
      .setKTX2Loader(ktx2)
      .setMeshoptDecoder(MeshoptDecoder)

    this.manager.onProgress = (_url, loaded, total) => {
      this.onProgress(total > 0 ? loaded / total : 0, this.label)
    }
  }

  track(fn: ProgressFn): void {
    this.onProgress = fn
  }

  step(label: string): void {
    this.label = label
    this.onProgress(-1, label)
  }

  async environment(url: string): Promise<Texture> {
    const cached = this.cache.get(url)
    if (cached) return cached as Texture
    const texture = await this.hdr.loadAsync(url)
    texture.mapping = EquirectangularReflectionMapping
    this.cache.set(url, texture)
    return texture
  }

  async model(url: string): Promise<GLTF> {
    const cached = this.cache.get(url)
    if (cached) return cached as GLTF
    const gltf = await this.gltf.loadAsync(url)
    this.cache.set(url, gltf)
    return gltf
  }
}
