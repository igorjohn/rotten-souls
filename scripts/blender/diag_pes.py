"""Altura de cada pe, quadro a quadro, na fonte e no alvo, na mesma escala."""
import bpy, os, sys
RAIZ = "/Users/igorjohn/GitHub/app-souls-web"
CC0 = os.path.join(RAIZ, "assets-src/models/personagem-cc0/AnimationLibrary.gltf")
ALVO = os.path.join(RAIZ, "assets-src/models/vharen/vharen-animado.glb")
CLIPE = sys.argv[sys.argv.index("--")+1] if "--" in sys.argv else "Idle_Loop"
K = 2.8229


def montar(p):
    antes = set(bpy.data.objects); ant_a = set(bpy.data.actions)
    bpy.ops.import_scene.gltf(filepath=p)
    novos = [o for o in bpy.data.objects if o not in antes]
    montar.acoes = {a.name.split(".00")[0]: a for a in bpy.data.actions if a not in ant_a}
    return next(o for o in novos if o.type == "ARMATURE")


bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.scene.render.fps = 24
alvo = montar(ALVO); acoes_alvo = montar.acoes
fonte = montar(CC0); acoes_fonte = montar.acoes


def usar(arm, acao):
    if not arm.animation_data: arm.animation_data_create()
    arm.animation_data.action = acao
    try:
        if len(acao.slots): arm.animation_data.action_slot = acao.slots[0]
    except AttributeError: pass


usar(alvo, acoes_alvo[CLIPE]); usar(fonte, acoes_fonte[CLIPE])
a = acoes_fonte[CLIPE]
ini, fim = int(a.frame_range[0]), int(a.frame_range[1])

PARES = [("LeftFoot","DEF-foot.L"), ("RightFoot","DEF-foot.R"),
         ("LeftToeBase","DEF-toe.L"), ("RightToeBase","DEF-toe.R"),
         ("LeftUpLeg","DEF-thigh.L"), ("RightUpLeg","DEF-thigh.R"),
         ("LeftLeg","DEF-shin.L"), ("RightLeg","DEF-shin.R"),
         ("Hips","DEF-hips")]

# Repouso
print(f"{'osso':14s} {'repouso alvo':>13s} {'repouso fonte x K':>18s} {'diff':>8s}")
for ta, tf in PARES:
    za = alvo.data.bones[ta].head_local.z
    zf = fonte.data.bones[tf].head_local.z * K
    print(f"{ta:14s} {za:13.4f} {zf:18.4f} {za-zf:8.4f}")

print(f"\n{CLIPE}: altura de cada pe, alvo | fonte x K")
print(f"{'f':>3s} {'LFoot':>7s} {'RFoot':>7s} {'LToe':>7s} {'RToe':>7s} | "
      f"{'LFoot':>7s} {'RFoot':>7s} {'LToe':>7s} {'RToe':>7s} | {'Hips':>7s} {'HipsF':>7s}")
for f in range(ini, fim+1, max(1,(fim-ini)//10)):
    bpy.context.scene.frame_set(f)
    va = [alvo.pose.bones[n].head.z for n,_ in PARES[:4]]
    vf = [fonte.pose.bones[n].head.z * K for _,n in PARES[:4]]
    print(f"{f:3d} " + " ".join(f"{v:7.3f}" for v in va) + " | "
          + " ".join(f"{v:7.3f}" for v in vf) + " | "
          + f"{alvo.pose.bones['Hips'].head.z:7.3f} {fonte.pose.bones['DEF-hips'].head.z*K:7.3f}")
