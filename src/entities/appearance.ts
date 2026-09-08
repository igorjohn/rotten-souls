import {
  BoxGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  MeshStandardNodeMaterial,
  Object3D,
  Quaternion,
  Vector3,
  type Material,
} from 'three/webgpu'

/**
 * Materiais dos personagens.
 *
 * O jogador não passa mais por aqui: o mannequim CC0 foi desembrulhado e
 * ganhou uma armadura assada em textura, com oclusão e desgaste de aresta
 * (`scripts/blender/skin_player.py`), então o material vem do próprio arquivo.
 *
 * O que sobra é o chefe: `bossMaterials` só serve ao mannequim de reserva, e
 * `dressVharen` veste o modelo definitivo.
 */

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
 * Veste o Vharen gerado com um material de nós próprio.
 *
 * O glTF do gerador chega com metalicidade 1 e rugosidade 1 chapadas, o que
 * numa arena escura dá um bloco preto: metal totalmente rugoso não devolve
 * nem o reflexo especular da lua nem o brilho quente dos braseiros. A cor e a
 * brasa vêm dos dois mapas do próprio arquivo; o resto é ajuste de look.
 *
 * O material sai daqui de fora porque a telegrafia mexe na intensidade
 * emissiva a cada frame, e para isso ele precisa ser um material de nós que o
 * jogo criou, não o que o carregador montou sozinho.
 */
export function dressVharen(root: Object3D): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial({
    color: new Color('#ffffff'),
    roughness: 0.58,
    metalness: 0.86,
    emissive: new Color('#ffffff'),
    emissiveIntensity: 2.6,
    // A capa é uma casca de uma face só; sem isto ela some de metade dos
    // ângulos.
    side: DoubleSide,
  })

  root.traverse((child) => {
    const mesh = child as Mesh
    if (!mesh.isMesh) return
    const origem = mesh.material as MeshStandardMaterial
    if (origem?.map) material.map = origem.map
    if (origem?.emissiveMap) material.emissiveMap = origem.emissiveMap
    if (origem?.normalMap) material.normalMap = origem.normalMap
    mesh.material = material
    mesh.castShadow = true
    mesh.receiveShadow = true
  })

  return material
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
