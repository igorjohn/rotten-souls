/**
 * Medidas da arena num lugar só. Iluminação, braseiros, posição do chefe e o
 * kit modular do M3 leem daqui, então mudar a arena é mudar este arquivo.
 * Escala: arquitetura grande demais pro personagem, como manda a seção 3.
 */

const floorRadius = 21
const entranceAngle = Math.PI / 2
const stairSteps = 9
const stairStepDepth = 0.95
const entranceLandingHeight = 3.4
const landingDepth = 7
/** Onde o primeiro degrau encosta no piso da arena. */
const stairStartRadius = floorRadius - 1.2
const stairEndRadius = stairStartRadius + stairSteps * stairStepDepth
const landingCenterRadius = stairEndRadius + landingDepth / 2 - 0.5

export const LAYOUT = {
  floorRadius,
  /** Raio da face interna do muro do anel. */
  wallRadius: 22.4,
  wallHeight: 9,
  wallThickness: 1.6,
  wallSegments: 28,

  pillarCount: 12,
  pillarRadius: 18.2,
  pillarHeight: 10,
  pillarWidth: 1.5,

  brazierCount: 12,
  brazierRadius: 16.4,
  brazierHeight: 1.35,

  /** Ângulo, em radianos, onde fica a entrada. 0 aponta pro +X. */
  entranceAngle,
  /** Largura angular do vão da entrada. */
  entranceArc: 0.42,
  entranceLandingHeight,
  stairSteps,
  stairStepDepth,
  stairStartRadius,
  stairEndRadius,
  stairWidth: 7,
  landingDepth,
  landingCenterRadius,

  /** Onde Vharen espera. */
  bossSpawn: { x: 0, y: 0, z: -11 },
} as const

export function ringPosition(angle: number, radius: number): { x: number; z: number } {
  return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius }
}

/** Verdadeiro se o ângulo cai dentro do vão da entrada. */
export function insideEntrance(angle: number): boolean {
  let delta = angle - LAYOUT.entranceAngle
  while (delta > Math.PI) delta -= Math.PI * 2
  while (delta < -Math.PI) delta += Math.PI * 2
  return Math.abs(delta) < LAYOUT.entranceArc
}

/**
 * Topo do patamar de entrada, logo acima do primeiro degrau. É daqui que o
 * jogador desce e é o ponto de respawn. Fica na frente do patamar de propósito:
 * a câmera precisa de folga atrás pra não encostar na parede do fundo.
 */
export const PLAYER_SPAWN = (() => {
  const { x, z } = ringPosition(entranceAngle, stairEndRadius + 1.2)
  return { x, y: entranceLandingHeight + 0.05, z }
})()

/** Onde a câmera deve olhar quando o jogador nasce: o centro da arena. */
export const SPAWN_FACING = Math.atan2(-PLAYER_SPAWN.x, -PLAYER_SPAWN.z)
