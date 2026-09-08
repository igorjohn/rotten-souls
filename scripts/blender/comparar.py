"""
Compara fonte e alvo no mesmo quadro, lado a lado.

    blender --background --python scripts/blender/comparar.py -- <glb-alvo> <saida.png> <clipe> [clipe...]

A tira de cima e o mannequim CC0 tocando o clipe original, a de baixo e o
Vharen com o clipe assado. E a unica forma honesta de dizer se uma pose
estranha e erro do retarget ou e assim mesmo na biblioteca.
"""
import bpy, os, sys, math
import numpy as np
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
ALVO_GLB, SAIDA = argv[0], argv[1]
CLIPES = argv[2:]
RAIZ = "/Users/igorjohn/GitHub/app-souls-web"
CC0 = os.path.join(RAIZ, "assets-src/models/personagem-cc0/AnimationLibrary.gltf")
L, A, COLS = 620, 400, 6


def log(*a):
    print("[cmp]", *a); sys.stdout.flush()


def malha_real(objs):
    return max((o for o in objs if o.type == "MESH"), key=lambda o: len(o.data.vertices))


def montar(caminho, deslocaX):
    antes = set(bpy.data.objects)
    acoes_antes = set(bpy.data.actions)
    bpy.ops.import_scene.gltf(filepath=caminho)
    novos = [o for o in bpy.data.objects if o not in antes]
    montar.acoes = [a for a in bpy.data.actions if a not in acoes_antes]
    arm = next(o for o in novos if o.type == "ARMATURE")
    malha = malha_real(novos)
    for o in novos:
        if o.type == "MESH" and o is not malha:
            bpy.data.objects.remove(o, do_unlink=True)
    arm.location.x += deslocaX
    return arm, malha


bpy.ops.wm.read_factory_settings(use_empty=True)
cena = bpy.context.scene
cena.render.fps = 24

# O alvo entra primeiro pra ficar com os nomes limpos: os dois arquivos tem
# clipes de mesmo nome e o Blender poe .001 no segundo que chegar.
arm_alvo, malha_alvo = montar(ALVO_GLB, 0.0)
acoes_alvo = {a.name: a for a in montar.acoes}
arm_fonte, malha_fonte = montar(CC0, -3.4)
acoes_fonte = {a.name.split(".00")[0]: a for a in montar.acoes}

# A fonte tem 1,83 m e o alvo 4,62. Iguala a leitura pra comparar a pose, nao
# o tamanho.
alt_alvo = 4.62
alt_fonte = 1.829
# So a armadura. A malha e filha dela, entao escalar as duas eleva ao quadrado.
arm_fonte.scale = (alt_alvo / alt_fonte,) * 3
arm_alvo.location.x = 3.4

cam_data = bpy.data.cameras.new("cam"); cam_data.type = "ORTHO"
cam_data.ortho_scale = alt_alvo * 2.6
cam = bpy.data.objects.new("cam", cam_data); cena.collection.objects.link(cam)
alvo_cam = bpy.data.objects.new("alvo", None); cena.collection.objects.link(alvo_cam)
alvo_cam.location = Vector((0, 0, alt_alvo * 0.5))
ang = math.radians(18); dist = alt_alvo * 3
cam.location = alvo_cam.location + Vector((math.sin(ang)*dist, -math.cos(ang)*dist, alt_alvo*0.25))
cam.constraints.new("TRACK_TO").target = alvo_cam
cena.camera = cam

cena.render.engine = "BLENDER_WORKBENCH"
cena.display.shading.light = "STUDIO"
cena.display.shading.color_type = "SINGLE"
cena.display.shading.single_color = (0.55, 0.55, 0.58)
cena.display.shading.show_cavity = True
cena.display.shading.show_shadows = True
cena.render.resolution_x, cena.render.resolution_y = L, A
cena.world = bpy.data.worlds.new("w"); cena.world.color = (0.06, 0.07, 0.09)
bpy.ops.mesh.primitive_plane_add(size=alt_alvo*4, location=(0, 0, -0.004))
tmp = "/tmp/cmp.png"
cena.render.image_settings.file_format = "PNG"
cena.render.filepath = tmp


def usar(arm, acao):
    if not arm.animation_data:
        arm.animation_data_create()
    arm.animation_data.action = acao
    try:
        if len(acao.slots):
            arm.animation_data.action_slot = acao.slots[0]
    except AttributeError:
        pass


def render():
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(tmp)
    px = np.array(img.pixels[:], dtype=np.float32).reshape(A, L, 4)
    bpy.data.images.remove(img)
    return px


tiras = []
rotulos = []
for nome in CLIPES:
    usar(arm_fonte, acoes_fonte[nome])
    usar(arm_alvo, acoes_alvo[nome])
    ini = int(round(acoes_fonte[nome].frame_range[0]))
    fim = int(round(acoes_fonte[nome].frame_range[1]))
    passo = max(1, (fim - ini) // (COLS - 1))
    frames = list(range(ini, fim + 1, passo))[:COLS]
    while len(frames) < COLS:
        frames.append(fim)

    fila = np.zeros((A, L*COLS, 4), dtype=np.float32)
    for i, f in enumerate(frames):
        cena.frame_set(f)
        fila[:, i*L:(i+1)*L, :] = render()
    tiras.append(fila)
    rotulos.append(nome)
    log("comparado", nome, frames)

folha = np.concatenate(tiras[::-1], axis=0)
h, w = folha.shape[0], folha.shape[1]
img = bpy.data.images.new("folha", width=w, height=h, alpha=True)
img.pixels = folha.ravel()
img.filepath_raw = SAIDA; img.file_format = "PNG"; img.save()
log("folha:", SAIDA, f"{w}x{h}", "de cima pra baixo:", list(reversed(rotulos)))
