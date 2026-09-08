"""
Retarget da biblioteca CC0 para o esqueleto do Vharen, no Blender, sem interface.

    blender --background --python scripts/blender/retarget_vharen.py

Por que fora do jogo: os dois esqueletos estao em poses de repouso diferentes.
A biblioteca esta em T (braco reto pro lado, direcao +X) e o Vharen gerado esta
em A (braco 53 graus pra baixo). Com essa diferenca nenhuma das duas contas
ingenuas fecha:

  - delta em mundo, `alvo = fonte * repouso_fonte^-1 * repouso_alvo`, soma a
    diferenca de repouso a cada frame: o braco que na fonte desce 75 graus
    desce 128 no alvo e atravessa o corpo. Foi o que quebrou o retarget em
    tempo de execucao.
  - copia de rotacao local guarda a pose de repouso do alvo, o que da o mesmo
    erro pelo outro lado.

A conta que fecha precisa de um passo a mais: alinhar primeiro o repouso do
alvo com o repouso da fonte, osso a osso, e so entao aplicar a rotacao da
fonte. A pose final de cada osso, em espaco de armadura, e:

    R(osso) = pose_fonte(osso) * C(osso)
    C(osso) = repouso_fonte^-1 * alinhamento * repouso_alvo

Duas armadilhas moram nesse alinhamento, e as duas custaram caro:

1. **Nao da pra usar a direcao que o importador de glTF inventou pro osso.**
   No glTF um osso e so um no, sem comprimento nem cauda; o importador do
   Blender chuta os dois. No Vharen ele chutou muito mal: o dedo do pe tem 40 m
   e o `Hips` aponta pro lado, em +X. Alinhar esse +X com o quadril da fonte,
   que aponta pra cima, gira a pelve uns cem graus, e como a coxa esquerda e a
   direita saem do quadril por deslocamento lateral, o giro joga uma perna pra
   cima e a outra pra baixo. Em jogo isso aparece como o chefe andando torto,
   com o pe esquerdo a 0,91 m do chao e o direito a 0,34 m. A direcao usada
   aqui e anatomica: da cabeca do osso pra cabeca do filho que continua a
   cadeia, e so para as pontas (mao, dedo do pe, cabeca) cai na cauda.

2. **Arco minimo deixa o rolamento solto.** Girar a direcao do alvo ate a da
   fonte pelo caminho mais curto nao diz nada sobre o giro em torno do proprio
   osso, e esse giro e justamente o que decide pra onde vao os filhos com
   deslocamento lateral. Entao o alinhamento e montado como quadro completo:
   Y no osso, X perpendicular a frente do corpo, Z fechando. Como os dois
   esqueletos olham pro mesmo lado, os dois quadros sao construidos da mesma
   receita e a diferenca entre eles nao tem ambiguidade.

O script verifica numericamente que cada alinhamento leva mesmo a direcao do
alvo na da fonte, e que os pes saem simetricos, antes de assar qualquer coisa.
"""

import bpy
import os
import sys
import json
import math
from mathutils import Vector, Quaternion, Matrix

RAIZ = "/Users/igorjohn/GitHub/app-souls-web"
VHAREN = os.path.join(RAIZ, "assets-src/models/vharen/bruto/vharen-bruto.glb")
CC0 = os.path.join(RAIZ, "assets-src/models/personagem-cc0/AnimationLibrary.gltf")
SAIDA = os.path.join(RAIZ, "assets-src/models/vharen/vharen-animado.glb")
RELATORIO = os.path.join(RAIZ, "assets-src/models/vharen/retarget-relatorio.json")

# Clipes que o jogo usa. Os do jogador entram junto porque custam pouco e
# evitam reassar o arquivo inteiro se o chefe ganhar um estado novo.
CLIPES = [
    "Idle_Loop", "Sword_Idle", "Walk_Loop", "Jog_Fwd_Loop", "Sprint_Loop",
    "Roll", "Sword_Attack", "Punch_Cross", "Punch_Jab", "Hit_Chest",
    "Death01", "Interact",
]

# Cuidado com a coluna: no modelo gerado a cadeia e Hips -> Spine02 -> Spine01
# -> Spine, ou seja o numero nao segue a ordem anatomica e Spine02 e a vertebra
# de baixo.
MAPA = {
    "Hips": "DEF-hips",
    "Spine02": "DEF-spine.001",
    "Spine01": "DEF-spine.002",
    "Spine": "DEF-spine.003",
    "neck": "DEF-neck",
    "Head": "DEF-head",
    "LeftShoulder": "DEF-shoulder.L",
    "LeftArm": "DEF-upper_arm.L",
    "LeftForeArm": "DEF-forearm.L",
    "LeftHand": "DEF-hand.L",
    "RightShoulder": "DEF-shoulder.R",
    "RightArm": "DEF-upper_arm.R",
    "RightForeArm": "DEF-forearm.R",
    "RightHand": "DEF-hand.R",
    "LeftUpLeg": "DEF-thigh.L",
    "LeftLeg": "DEF-shin.L",
    "LeftFoot": "DEF-foot.L",
    "LeftToeBase": "DEF-toe.L",
    "RightUpLeg": "DEF-thigh.R",
    "RightLeg": "DEF-shin.R",
    "RightFoot": "DEF-foot.R",
    "RightToeBase": "DEF-toe.R",
}

Y = Vector((0.0, 1.0, 0.0))
# Os dois personagens olham pro mesmo lado depois da conversao de glTF pra
# Blender: a frente e -Y e o alto e +Z.
FRENTE = Vector((0.0, -1.0, 0.0))
CIMA = Vector((0.0, 0.0, 1.0))

# Filho que define a direcao de cada osso. Vazio quer dizer ponta de cadeia, e
# ai vale a cauda que o importador chutou, que pra ponta e boa o bastante.
FILHO_ALVO = {
    "Hips": "Spine02", "Spine02": "Spine01", "Spine01": "Spine", "Spine": "neck",
    "neck": "Head", "Head": "head_end",
    "LeftShoulder": "LeftArm", "LeftArm": "LeftForeArm", "LeftForeArm": "LeftHand",
    "LeftHand": "",
    "RightShoulder": "RightArm", "RightArm": "RightForeArm", "RightForeArm": "RightHand",
    "RightHand": "",
    "LeftUpLeg": "LeftLeg", "LeftLeg": "LeftFoot", "LeftFoot": "LeftToeBase",
    "LeftToeBase": "",
    "RightUpLeg": "RightLeg", "RightLeg": "RightFoot", "RightFoot": "RightToeBase",
    "RightToeBase": "",
}
FILHO_FONTE = {
    "DEF-hips": "DEF-spine.001", "DEF-spine.001": "DEF-spine.002",
    "DEF-spine.002": "DEF-spine.003", "DEF-spine.003": "DEF-neck",
    "DEF-neck": "DEF-head", "DEF-head": "",
    "DEF-shoulder.L": "DEF-upper_arm.L", "DEF-upper_arm.L": "DEF-forearm.L",
    "DEF-forearm.L": "DEF-hand.L", "DEF-hand.L": "",
    "DEF-shoulder.R": "DEF-upper_arm.R", "DEF-upper_arm.R": "DEF-forearm.R",
    "DEF-forearm.R": "DEF-hand.R", "DEF-hand.R": "",
    "DEF-thigh.L": "DEF-shin.L", "DEF-shin.L": "DEF-foot.L", "DEF-foot.L": "DEF-toe.L",
    "DEF-toe.L": "",
    "DEF-thigh.R": "DEF-shin.R", "DEF-shin.R": "DEF-foot.R", "DEF-foot.R": "DEF-toe.R",
    "DEF-toe.R": "",
}


def direcao_anatomica(ossos, nome, filhos):
    """Da cabeca do osso pra cabeca do filho. Na ponta da cadeia, a cauda."""
    osso = ossos[nome]
    filho = filhos.get(nome, "")
    if filho and filho in ossos:
        return (ossos[filho].head_local - osso.head_local).normalized()
    return (osso.tail_local - osso.head_local).normalized()


def quadro(y, referencia):
    """Rotacao com Y no osso e X perpendicular a referencia. Sem ambiguidade."""
    x = referencia.cross(y)
    x.normalize()
    z = y.cross(x)
    return Matrix((x, y, z)).transposed()


def log(*a):
    print("[retarget]", *a)
    sys.stdout.flush()


def cena_limpa():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = 24


def importar(caminho):
    antes = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=caminho)
    return [o for o in bpy.data.objects if o not in antes]


def apagar(ob):
    bpy.data.objects.remove(ob, do_unlink=True)


def bbox_mundo(ob, depsgraph=None):
    """Caixa envolvente real da malha, ja com o esfolamento aplicado."""
    if depsgraph is None:
        mundo = ob.matrix_world
        pontos = (mundo @ v.co for v in ob.data.vertices)
    else:
        aval = ob.evaluated_get(depsgraph)
        malha = aval.to_mesh()
        mundo = aval.matrix_world
        pontos = [mundo @ v.co for v in malha.vertices]
        aval.to_mesh_clear()
    mn = Vector((1e18, 1e18, 1e18))
    mx = Vector((-1e18, -1e18, -1e18))
    for p in pontos:
        for i in range(3):
            if p[i] < mn[i]:
                mn[i] = p[i]
            if p[i] > mx[i]:
                mx[i] = p[i]
    return mn, mx


# ---------------------------------------------------------------- importacao

cena_limpa()
log("importando Vharen")
novos = importar(VHAREN)
arm_alvo = next(o for o in novos if o.type == "ARMATURE")
malha_alvo = next(o for o in novos if o.type == "MESH" and o.name.startswith("char"))
for o in list(novos):
    if o is not arm_alvo and o is not malha_alvo:
        log("descartando lixo do gerador:", o.name)
        apagar(o)
arm_alvo.name = "VharenRig"
arm_alvo.data.name = "VharenRigData"
malha_alvo.name = "Vharen"

# A acao de um quadro que o gerador deixa no arquivo nao serve pra nada e
# atrapalha a exportacao.
if arm_alvo.animation_data:
    arm_alvo.animation_data_clear()
for a in list(bpy.data.actions):
    bpy.data.actions.remove(a)

antes_mn, antes_mx = bbox_mundo(malha_alvo)
log(f"malha no arquivo: altura {antes_mx.z - antes_mn.z:.4f}, base {antes_mn.z:.4f}, "
    f"escala do no da armadura {tuple(round(v, 4) for v in arm_alvo.scale)}")

# O no da armadura carrega escala 0,01 embutida pelo gerador. Assar isso agora
# deixa o arquivo em metros e tira a pegadinha de medir altura sem passar pela
# matriz de mundo.
bpy.ops.object.select_all(action="DESELECT")
arm_alvo.select_set(True)
malha_alvo.select_set(True)
bpy.context.view_layer.objects.active = arm_alvo
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
bpy.context.view_layer.update()

depois_mn, depois_mx = bbox_mundo(malha_alvo)
erro = max(abs(a - b) for a, b in zip(list(antes_mn) + list(antes_mx),
                                      list(depois_mn) + list(depois_mx)))
log(f"escala assada: altura {depois_mx.z - depois_mn.z:.4f}, erro maximo da caixa {erro:.6f} m")
assert erro < 1e-3, "assar a escala moveu a malha; abortando"
ALTURA_REPOUSO = depois_mx.z - depois_mn.z

log("importando biblioteca CC0")
novos = importar(CC0)
arm_fonte = next(o for o in novos if o.type == "ARMATURE")
for o in list(novos):
    if o.type == "MESH":
        apagar(o)
arm_fonte.name = "RigCC0"

acoes = {a.name: a for a in bpy.data.actions}
faltando = [c for c in CLIPES if c not in acoes]
assert not faltando, f"clipes ausentes na biblioteca: {faltando}"


# ------------------------------------------------------- constantes por osso

ossos_alvo = arm_alvo.data.bones
ossos_fonte = arm_fonte.data.bones

pares = []
for nome_alvo, nome_fonte in MAPA.items():
    assert nome_alvo in ossos_alvo, f"osso ausente no Vharen: {nome_alvo}"
    assert nome_fonte in ossos_fonte, f"osso ausente na CC0: {nome_fonte}"
    pares.append((nome_alvo, nome_fonte))


def profundidade(osso):
    d = 0
    p = osso.parent
    while p:
        d += 1
        p = p.parent
    return d


pares.sort(key=lambda p: profundidade(ossos_alvo[p[0]]))

# Rotacoes de repouso em espaco de armadura. Os dois nos de armadura estao sem
# rotacao e com escala uniforme, entao espaco de armadura e espaco de mundo
# para efeito de orientacao.
Mt = {n: ossos_alvo[n].matrix_local for n, _ in pares}
Mt_rot = {n: Mt[n].to_quaternion() for n in Mt}
Ms_rot = {f: ossos_fonte[f].matrix_local.to_quaternion() for _, f in pares}

C = {}
ALINHA = {}
maior_desvio = 0.0
for nome_alvo, nome_fonte in pares:
    dt = direcao_anatomica(ossos_alvo, nome_alvo, FILHO_ALVO)
    ds = direcao_anatomica(ossos_fonte, nome_fonte, FILHO_FONTE)
    # Uma referencia so pro par: se qualquer um dos dois ossos corre quase
    # paralelo a frente do corpo, como o pe e o dedo, a frente nao serve de
    # referencia e o alto entra no lugar. Escolher separado por osso daria
    # quadros incomparaveis.
    referencia = FRENTE if max(abs(dt.dot(FRENTE)), abs(ds.dot(FRENTE))) < 0.85 else CIMA
    alinhamento = (quadro(ds, referencia) @ quadro(dt, referencia).inverted()).to_quaternion()
    ALINHA[nome_alvo] = alinhamento
    c = Ms_rot[nome_fonte].inverted() @ alinhamento @ Mt_rot[nome_alvo]
    # Verificacao: o alinhamento tem que levar mesmo a direcao do alvo na da
    # fonte, senao o osso aponta pro lugar errado a animacao inteira.
    desvio = ((alinhamento @ dt) - ds).length
    maior_desvio = max(maior_desvio, desvio)
    C[nome_alvo] = c
    log(f"  {nome_alvo:14s} <- {nome_fonte:18s} "
        f"repouso alvo=({dt.x:6.3f},{dt.y:6.3f},{dt.z:6.3f}) "
        f"fonte=({ds.x:6.3f},{ds.y:6.3f},{ds.z:6.3f}) "
        f"alinha={math.degrees(2*math.acos(min(1,abs(alinhamento.w)))):6.2f} deg "
        f"ref={'frente' if referencia is FRENTE else 'cima'}")
log(f"maior desvio de direcao no alinhamento: {maior_desvio:.2e} (tem que ser ~0)")
assert maior_desvio < 1e-5, "o alinhamento de repouso nao levou a direcao na da fonte"

# Razao de altura do quadril, pra transportar a translacao do quadril sem
# esticar nem achatar a passada.
alt_quadril_alvo = Mt["Hips"].translation.z
alt_quadril_fonte = ossos_fonte["DEF-hips"].matrix_local.translation.z
K = alt_quadril_alvo / alt_quadril_fonte
log(f"quadril: alvo {alt_quadril_alvo:.4f} m, fonte {alt_quadril_fonte:.4f} m, razao {K:.4f}")

pai_de = {n: (ossos_alvo[n].parent.name if ossos_alvo[n].parent else None) for n, _ in pares}
Ms_head = {f: ossos_fonte[f].matrix_local.translation.copy() for _, f in pares}

# Marcadores de contato com o chao. O tornozelo, a base do dedo e a ponta do
# dedo dos dois pes; o mais baixo dos seis manda.
PES_ALVO = ["LeftFoot", "LeftToeBase", "RightFoot", "RightToeBase"]
PES_FONTE = [MAPA[n] for n in PES_ALVO]


# Cuidado: o carregador de glTF inventa o comprimento dos ossos do Vharen, e
# inventa mal. O dedo do pe sai com 40 m de comprimento. A *direcao* do osso o
# importador acerta, e e so dela que o retarget precisa; a cauda nao serve pra
# nada. Todo marcador de pe daqui pra baixo e cabeca de osso, nos dois lados.
def _baixo_repouso_alvo():
    return min(ossos_alvo[n].head_local.z for n in PES_ALVO)


def _baixo_repouso_fonte():
    return min(ossos_fonte[n].head_local.z for n in PES_FONTE)


BAIXO_ALVO_REPOUSO = _baixo_repouso_alvo()
BAIXO_FONTE_REPOUSO = _baixo_repouso_fonte()
log(f"pe no repouso: alvo {BAIXO_ALVO_REPOUSO:.4f} m, fonte {BAIXO_FONTE_REPOUSO:.4f} m")


# ------------------------------------------------------------------- assadura

pb_alvo = arm_alvo.pose.bones
pb_fonte = arm_fonte.pose.bones
for pb in pb_alvo:
    pb.rotation_mode = "QUATERNION"

cena = bpy.context.scene
relatorio = {"altura_repouso": ALTURA_REPOUSO, "clipes": {}}


def pose_alvo_do_frame():
    """Le a fonte no frame atual e devolve base local por osso do alvo."""
    R = {}
    for nome_alvo, nome_fonte in pares:
        ps = pb_fonte[nome_fonte].matrix.to_quaternion()
        R[nome_alvo] = (ps @ C[nome_alvo]).normalized()

    quadril = Mt["Hips"].translation + \
        (pb_fonte["DEF-hips"].matrix.translation - Ms_head["DEF-hips"]) * K

    # Plantio de pe. So transportar a altura do quadril nao basta: as duas
    # hierarquias tem perna de proporcao diferente, entao o pe do alvo afunda
    # ou flutua. A correcao transporta o *desvio* do pe em relacao ao proprio
    # repouso de cada esqueleto, o que zera no repouso e acompanha o salto e o
    # rolamento em vez de colar o personagem no chao.
    cabecas = cinematica(R, quadril)
    baixo_alvo = min(cabecas[n].z for n in PES_ALVO)
    baixo_fonte = min(pb_fonte[n].head.z for n in PES_FONTE)
    correcao = (baixo_fonte - BAIXO_FONTE_REPOUSO) * K - (baixo_alvo - BAIXO_ALVO_REPOUSO)
    quadril = quadril + Vector((0.0, 0.0, correcao))

    bases = {}
    for nome_alvo, nome_fonte in pares:
        pai = pai_de[nome_alvo]
        if pai is None:
            alvo_pose = Matrix.Translation(quadril) @ R[nome_alvo].to_matrix().to_4x4()
            base = Mt[nome_alvo].inverted() @ alvo_pose
            bases[nome_alvo] = (base.to_quaternion(), base.translation.copy())
        else:
            q = Mt_rot[nome_alvo].inverted() @ Mt_rot[pai] @ R[pai].inverted() @ R[nome_alvo]
            bases[nome_alvo] = (q.normalized(), None)
    return bases


def cinematica(R, quadril):
    """Posicao da cabeca de cada osso mapeado, dado o giro de cada um."""
    cabecas = {"Hips": quadril}
    for nome_alvo, _ in pares:
        pai = pai_de[nome_alvo]
        if pai is None:
            continue
        v = Mt_rot[pai].inverted() @ (Mt[nome_alvo].translation - Mt[pai].translation)
        cabecas[nome_alvo] = cabecas[pai] + (R[pai] @ v)
    return cabecas



for nome_clipe in CLIPES:
    acao_fonte = acoes[nome_clipe]
    if not arm_fonte.animation_data:
        arm_fonte.animation_data_create()
    arm_fonte.animation_data.action = acao_fonte
    # Blender 4.4+ usa acoes com slot; sem escolher o slot a acao nao avalia.
    try:
        slots = acao_fonte.slots
        if len(slots):
            arm_fonte.animation_data.action_slot = slots[0]
    except AttributeError:
        pass

    inicio = int(round(acao_fonte.frame_range[0]))
    fim = int(round(acao_fonte.frame_range[1]))

    nova = bpy.data.actions.new(name=f"__{nome_clipe}")
    if arm_alvo.animation_data is None:
        arm_alvo.animation_data_create()
    arm_alvo.animation_data.action = nova
    try:
        if len(nova.slots) == 0:
            slot = nova.slots.new(id_type='OBJECT', name=arm_alvo.name)
            arm_alvo.animation_data.action_slot = slot
        else:
            arm_alvo.animation_data.action_slot = nova.slots[0]
    except AttributeError:
        pass

    quadril_xy = []
    for f in range(inicio, fim + 1):
        cena.frame_set(f)
        bases = pose_alvo_do_frame()
        for nome_alvo, (q, loc) in bases.items():
            pb = pb_alvo[nome_alvo]
            pb.rotation_quaternion = q
            pb.keyframe_insert("rotation_quaternion", frame=f)
            if loc is not None:
                pb.location = loc
                pb.keyframe_insert("location", frame=f)
                quadril_xy.append((loc.x, loc.y, loc.z))

    xs = [p[0] for p in quadril_xy]
    ys = [p[1] for p in quadril_xy]
    zs = [p[2] for p in quadril_xy]
    relatorio["clipes"][nome_clipe] = {
        "frames": [inicio, fim],
        "duracao_s": (fim - inicio) / 24.0,
        "quadril_amplitude_m": [round(max(xs) - min(xs), 4),
                                round(max(ys) - min(ys), 4),
                                round(max(zs) - min(zs), 4)],
    }
    log(f"assado {nome_clipe}: {fim - inicio + 1} frames, "
        f"{(fim - inicio) / 24.0:.3f} s, amplitude do quadril "
        f"{relatorio['clipes'][nome_clipe]['quadril_amplitude_m']}")

# A fonte ja cumpriu o papel.
apagar(arm_fonte)
for a in list(bpy.data.actions):
    if not a.name.startswith("__"):
        bpy.data.actions.remove(a)
# A colecao de acoes do Blender e ordenada por nome, entao renomear durante a
# iteracao pula itens. Materializa a lista antes.
for a in list(bpy.data.actions):
    a.name = a.name[2:]
    a.use_fake_user = True


# ------------------------------------------------------------- verificacao

log("verificando a caixa envolvente da malha esfolada, clipe a clipe")
depsgraph = bpy.context.evaluated_depsgraph_get()
pior = None
for nome_clipe in CLIPES:
    acao = bpy.data.actions[nome_clipe]
    arm_alvo.animation_data.action = acao
    try:
        if len(acao.slots):
            arm_alvo.animation_data.action_slot = acao.slots[0]
    except AttributeError:
        pass
    ini, fim = relatorio["clipes"][nome_clipe]["frames"]
    passo = max(1, (fim - ini) // 6)
    amostras = []
    for f in range(ini, fim + 1, passo):
        cena.frame_set(f)
        depsgraph = bpy.context.evaluated_depsgraph_get()
        mn, mx = bbox_mundo(malha_alvo, depsgraph)
        amostras.append({
            "frame": f,
            "altura": round(mx.z - mn.z, 4),
            "base": round(mn.z, 4),
            "largura": round(mx.x - mn.x, 4),
            "profundidade": round(mx.y - mn.y, 4),
        })
    alturas = [a["altura"] for a in amostras]
    bases = [a["base"] for a in amostras]
    relatorio["clipes"][nome_clipe]["amostras"] = amostras
    relatorio["clipes"][nome_clipe]["altura_min_max"] = [min(alturas), max(alturas)]
    relatorio["clipes"][nome_clipe]["base_min_max"] = [min(bases), max(bases)]
    log(f"  {nome_clipe:14s} altura {min(alturas):5.2f}..{max(alturas):5.2f} m  "
        f"base {min(bases):6.3f}..{max(bases):6.3f} m")
    if pior is None or max(alturas) > pior[1]:
        pior = (nome_clipe, max(alturas))

log(f"maior altura vista: {pior[1]:.3f} m no clipe {pior[0]} "
    f"(repouso {ALTURA_REPOUSO:.3f} m)")

cena.frame_set(0)

# ------------------------------------------------------------- exportacao

os.makedirs(os.path.dirname(SAIDA), exist_ok=True)
bpy.ops.object.select_all(action="DESELECT")
arm_alvo.select_set(True)
malha_alvo.select_set(True)
bpy.context.view_layer.objects.active = arm_alvo

bpy.ops.export_scene.gltf(
    filepath=SAIDA,
    export_format="GLB",
    use_selection=True,
    export_animations=True,
    export_animation_mode="ACTIONS",
    export_nla_strips=False,
    export_bake_animation=False,
    export_force_sampling=True,
    export_optimize_animation_size=False,
    export_anim_single_armature=True,
    export_skins=True,
    export_apply=False,
    export_yup=True,
    export_materials="EXPORT",
    export_image_format="AUTO",
)
log("exportado:", SAIDA, f"{os.path.getsize(SAIDA)/1e6:.2f} MB")

with open(RELATORIO, "w") as fp:
    json.dump(relatorio, fp, indent=2)
log("relatorio:", RELATORIO)
