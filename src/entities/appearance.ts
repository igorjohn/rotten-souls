import {
  BoxGeometry,
  Color,
  Group,
  Mesh,
  MeshStandardNodeMaterial,
  Object3D,
  Quaternion,
  Vector3,
  type Material,
} from 'three/webgpu'

/**
 * Roupa provisória dos personagens. O mannequim CC0 vem com material chapado
 * laranja e roxo, que não pertence à paleta. Aqui ele ganha metal escuro e
 * couro, e o chefe ganha brasa nas juntas, que é a leitura do concept
 * escolhido: armadura carbonizada com fogo vivo por dentro.
 */

export function playerMaterials(): [Material, Material] {
  const armor = new MeshStandardNodeMaterial({
    color: new Color('#54565b'),
    roughness: 0.62,
    metalness: 0.72,
  })
  const cloth = new MeshStandardNodeMaterial({
    color: new Color('#2b2823'),
    roughness: 0.92,
    metalness: 0.05,
  })
  return [armor, cloth]
}

export function bossMaterials(): [Material, Material] {
  const iron = new MeshStandardNodeMaterial({
    color: new Color('#1d1c1b'),
    roughness: 0.68,
    metalness: 0.8,
  })
  // Brasa viva nas juntas. É emissivo, então o bloom pega e o chefe se lê
  // como silhueta acesa mesmo no escuro, a três arcos de distância.
  const ember = new MeshStandardNodeMaterial({
    color: new Color('#3a1608'),
    roughness: 0.5,
    metalness: 0.3,
    emissive: new Color('#ff6a12'),
    emissiveIntensity: 2.6,
  })
  return [iron, ember]
}

/**
 * Montante. Lâmina, guarda e punho em três caixas, presos ao osso da mão.
 * Vira asset de verdade no M5; por ora a silhueta é o que importa.
 */
export function buildGreatsword(scale = 1): Object3D {
  const group = new Group()
  group.name = 'greatsword'

  const steel = new MeshStandardNodeMaterial({
    color: new Color('#6e7278'),
    roughness: 0.34,
    metalness: 0.92,
  })
  const dark = new MeshStandardNodeMaterial({
    color: new Color('#241f1b'),
    roughness: 0.85,
    metalness: 0.35,
  })

  const blade = new Mesh(new BoxGeometry(0.085, 1.32, 0.024), steel)
  blade.position.y = 0.86
  group.add(blade)

  const tip = new Mesh(new BoxGeometry(0.085, 0.2, 0.024), steel)
  tip.position.y = 1.6
  tip.scale.set(0.62, 1, 1)
  group.add(tip)

  const guard = new Mesh(new BoxGeometry(0.42, 0.055, 0.05), dark)
  guard.position.y = 0.19
  group.add(guard)

  const grip = new Mesh(new BoxGeometry(0.05, 0.3, 0.05), dark)
  grip.position.y = 0.03
  group.add(grip)

  const pommel = new Mesh(new BoxGeometry(0.09, 0.08, 0.09), dark)
  pommel.position.y = -0.13
  group.add(pommel)

  group.traverse((child) => {
    const mesh = child as Mesh
    if (mesh.isMesh) mesh.castShadow = true
  })

  group.scale.setScalar(scale)
  return group
}

/**
 * Prende a arma no osso da mão, com a escala compensada.
 *
 * O osso herda a escala de toda a hierarquia acima dele, que no modelo gerado
 * chega a duzentas e trinta vezes. Sem compensar, uma espada de escala 1 sai
 * do tamanho de um prédio. `size` é o tamanho final desejado em metros de
 * mundo, e a compensação é medida no próprio osso.
 */
export function attachToHand(hand: Object3D, weapon: Object3D, size = 1): void {
  hand.updateWorldMatrix(true, false)
  const boneScale = new Vector3()
  hand.matrixWorld.decompose(new Vector3(), new Quaternion(), boneScale)
  const compensation = boneScale.x > 0.0001 ? size / boneScale.x : size

  // Alinhamento do punho: o cabo aponta pro dedo, a lâmina sai pra fora.
  weapon.rotation.set(Math.PI * 0.52, 0, Math.PI * 0.06)
  weapon.position.set(0, 0.04 * compensation, 0.02 * compensation)
  weapon.scale.multiplyScalar(compensation)
  hand.add(weapon)
}
