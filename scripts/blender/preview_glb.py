"""
Folha de contato de um GLB animado, renderizada no Blender sem interface.

    blender --background --python scripts/blender/preview_glb.py -- <glb> <saida.png> [clipes...]

Carrega o arquivo *exportado*, nao o estado em memoria do retarget: o objetivo
e provar que o que foi pro disco anima certo, o que tambem pega erro de
exportacao. Cada clipe vira uma tira de seis quadros vista de tres quartos.
"""

import bpy
import os
import sys
import math
import numpy as np
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
GLB = argv[0]
SAIDA = argv[1]
CLIPES = argv[2:] or None

LARGURA, ALTURA = 400, 560
COLUNAS = 6


def log(*a):
    print("[preview]", *a)
    sys.stdout.flush()


bpy.ops.wm.read_factory_settings(use_empty=True)
cena = bpy.context.scene
cena.render.fps = 24
bpy.ops.import_scene.gltf(filepath=GLB)

arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
# O importador de glTF do Blender deixa uma "Icosphere" de apoio na cena que
# nao esta no arquivo. Pega a malha de verdade, que e a mais pesada.
malha = max((o for o in bpy.data.objects if o.type == "MESH"),
            key=lambda o: len(o.data.vertices))
log("objetos:", [(o.name, o.type, tuple(round(v, 4) for v in o.matrix_world.to_scale())) for o in bpy.data.objects])

# Enquadramento a partir da caixa envolvente real da malha em repouso.
coords = [malha.matrix_world @ v.co for v in list(malha.data.vertices)[::17]]
alto = max(c.z for c in coords)
baixo = min(c.z for c in coords)
altura = alto - baixo
centro = Vector((0, 0, (alto + baixo) / 2))
log(f"malha {malha.name}: altura de repouso {altura:.4f} m")

cam_data = bpy.data.cameras.new("cam")
cam_data.type = "ORTHO"
cam_data.ortho_scale = altura * 1.55
cam = bpy.data.objects.new("cam", cam_data)
cena.collection.objects.link(cam)
ang = math.radians(35)
dist = altura * 3
cam.location = centro + Vector((math.sin(ang) * dist, -math.cos(ang) * dist, altura * 0.28))
alvo = bpy.data.objects.new("alvo", None)
cena.collection.objects.link(alvo)
alvo.location = centro
c = cam.constraints.new("TRACK_TO")
c.target = alvo
cena.camera = cam
log(f"camera em {tuple(round(v,3) for v in cam.location)}, ortho {cam_data.ortho_scale:.3f}, alvo {tuple(round(v,3) for v in centro)}")

cena.render.engine = "BLENDER_WORKBENCH"
cena.display.shading.light = "STUDIO"
cena.display.shading.color_type = "SINGLE"
cena.display.shading.single_color = (0.55, 0.55, 0.58)
cena.display.shading.show_cavity = True
cena.display.shading.show_shadows = True
cena.render.resolution_x = LARGURA
cena.render.resolution_y = ALTURA
cena.render.resolution_percentage = 100
cena.render.film_transparent = False
cena.world = bpy.data.worlds.new("w")
cena.world.color = (0.06, 0.07, 0.09)

# Grade de chao: um plano fino em z=0 pra dar leitura de contato do pe.
bpy.ops.mesh.primitive_plane_add(size=altura * 4, location=(0, 0, -0.004))

tmp = "/tmp/preview_frame.png"
cena.render.image_settings.file_format = "PNG"
cena.render.filepath = tmp

acoes = [a for a in bpy.data.actions]
if CLIPES:
    acoes = [a for a in acoes if a.name in CLIPES]
acoes.sort(key=lambda a: a.name)

# Os dois esqueletos que passam por aqui usam nomes diferentes de pe.
PES = [n for n in ("LeftFoot", "LeftToeBase", "RightFoot", "RightToeBase",
                   "DEF-footL", "DEF-toeL", "DEF-footR", "DEF-toeR",
                   "DEF-foot.L", "DEF-toe.L", "DEF-foot.R", "DEF-toe.R")
       if n in arm.pose.bones]
tiras = []
rotulos = []

for acao in acoes:
    if not arm.animation_data:
        arm.animation_data_create()
    arm.animation_data.action = acao
    try:
        if len(acao.slots):
            arm.animation_data.action_slot = acao.slots[0]
    except AttributeError:
        pass
    ini = int(round(acao.frame_range[0]))
    fim = int(round(acao.frame_range[1]))
    passo = max(1, (fim - ini) // (COLUNAS - 1))
    frames = list(range(ini, fim + 1, passo))[:COLUNAS]
    while len(frames) < COLUNAS:
        frames.append(fim)

    tira = np.zeros((ALTURA, LARGURA * COLUNAS, 4), dtype=np.float32)
    medidas = []
    for i, f in enumerate(frames):
        cena.frame_set(f)
        deps = bpy.context.evaluated_depsgraph_get()
        aval = malha.evaluated_get(deps)
        m = aval.to_mesh()
        pts = [aval.matrix_world @ v.co for v in list(m.vertices)[::7]]
        zmin = min(p.z for p in pts); zmax = max(p.z for p in pts)
        aval.to_mesh_clear()
        pe = min(arm.pose.bones[n].head.z for n in PES)
        medidas.append((f, round(zmax - zmin, 3), round(zmin, 3), round(pe, 3)))

        bpy.ops.render.render(write_still=True)
        img = bpy.data.images.load(tmp)
        px = np.array(img.pixels[:], dtype=np.float32).reshape(ALTURA, LARGURA, 4)
        tira[:, i * LARGURA:(i + 1) * LARGURA, :] = px
        bpy.data.images.remove(img)
    tiras.append(tira)
    rotulos.append(acao.name)
    log(f"{acao.name:14s} (frame, altura, base_malha, pe_osso): {medidas}")

# O Blender guarda a imagem de baixo pra cima, entao a primeira tira do array
# vira a linha de baixo do PNG. Invertendo a lista, o primeiro clipe fica em
# cima, na ordem alfabetica em que foram renderizados.
folha = np.concatenate(tiras[::-1], axis=0)
h, w = folha.shape[0], folha.shape[1]
saida = bpy.data.images.new("folha", width=w, height=h, alpha=True)
saida.pixels = folha.ravel()
saida.filepath_raw = SAIDA
saida.file_format = "PNG"
saida.save()
log("folha:", SAIDA, f"{w}x{h}", "clipes de cima pra baixo:", rotulos)
