"""
Pele do jogador: desembrulha o mannequim CC0 e assa uma armadura gasta.

    blender --background --python scripts/blender/skin_player.py

Por que assar em vez de gerar textura com IA: o mannequim da Quaternius **nao
tem UV utilizavel**. Ele traz duas camadas, `UVMap` inteira em (0,0) e
`UVMap.001` cobrindo 1% do quadrado, porque o material original e cor chapada
por slot e nao precisa de mapa. Sem correspondencia entre imagem e corpo, uma
textura pintada por fora cai em qualquer lugar. Entao o caminho e o inverso:
desembrulha aqui, monta a armadura como material procedural em 3D, e assa pra
um mapa. Sem costura visivel, porque o procedural e continuo no espaco do
objeto, e com oclusao e desgaste de aresta assados junto, que e o que faz um
mannequim liso ler como metal batido.

Sai um `personagem-cc0.glb` com os 46 clipes preservados, um material so,
mapa de cor e mapa de rugosidade e metalicidade.
"""

import bpy
import bmesh
import math
import os
import sys
from mathutils import Vector

RAIZ = "/Users/igorjohn/GitHub/app-souls-web"
CC0 = os.path.join(RAIZ, "assets-src/models/personagem-cc0/AnimationLibrary.gltf")
SAIDA = os.path.join(RAIZ, "assets-src/models/personagem-cc0/personagem-cc0.glb")
TEXTURAS = os.path.join(RAIZ, "assets-src/textures/jogador")
RES = 1024

# Paleta da secao 3 do briefing: ferro escuro, couro, nada saturado.
#
# Os valores sao mais claros e bem menos metalicos do que a fisica pediria, e e
# de proposito. Numa arena com uma lua fraca e nenhum ambiente, metal puro nao
# tem o que refletir e some: a primeira assadura saiu com metalicidade 0,92 e o
# jogador virou recorte preto no chao molhado. Metade da metalicidade devolve o
# termo difuso, que e o unico que sobrevive nesse nivel de luz.
FERRO = (0.115, 0.121, 0.133, 1.0)
FERRO_POLIDO = (0.34, 0.355, 0.385, 1.0)
FERRUGEM = (0.135, 0.078, 0.047, 1.0)
COURO = (0.052, 0.042, 0.031, 1.0)
COURO_GASTO = (0.115, 0.090, 0.062, 1.0)


def log(*a):
    print("[pele]", *a)
    sys.stdout.flush()


bpy.ops.wm.read_factory_settings(use_empty=True)
cena = bpy.context.scene
cena.render.fps = 24
bpy.ops.import_scene.gltf(filepath=CC0)

# O importador de glTF deixa uma "Icosphere" de apoio que nao esta no arquivo.
malha = max((o for o in bpy.data.objects if o.type == "MESH"),
            key=lambda o: len(o.data.vertices))
arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
for o in list(bpy.data.objects):
    if o.type == "MESH" and o is not malha:
        bpy.data.objects.remove(o, do_unlink=True)
log(f"malha {malha.name}: {len(malha.data.vertices)} vertices, "
    f"{len(malha.data.polygons)} poligonos, {len(bpy.data.actions)} clipes")


# ------------------------------------------------------------ imagens do bake

cor = bpy.data.images.new("jogador_cor", RES, RES, alpha=False)
orm = bpy.data.images.new("jogador_orm", RES, RES, alpha=False, float_buffer=False)
orm.colorspace_settings.name = "Non-Color"


def montar_material(nome, base, polido, sujeira, escala_ruido, metal, rug_base, rug_polido):
    """
    Material de armadura gasta, montado pra ser assado.

    Tres coisas empilhadas: manchas grandes de oxidacao por ruido em espaco de
    objeto, desgaste nas arestas convexas pela `pointiness` da geometria (e
    onde a peca esfrega e o metal aparece), e oclusao de ambiente pra fechar as
    frestas. O resultado entra num `Emission`, que e o unico jeito de assar
    exatamente o que o no calcula, sem luz da cena entrar na conta.
    """
    mat = bpy.data.materials.new(nome)
    mat.use_nodes = True
    nt = mat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)

    saida = nt.nodes.new("ShaderNodeOutputMaterial")
    emis = nt.nodes.new("ShaderNodeEmission")
    nt.links.new(emis.outputs[0], saida.inputs["Surface"])

    coord = nt.nodes.new("ShaderNodeTexCoord")

    # Manchas grandes de oxidacao.
    ruido = nt.nodes.new("ShaderNodeTexNoise")
    ruido.inputs["Scale"].default_value = escala_ruido
    ruido.inputs["Detail"].default_value = 6.0
    ruido.inputs["Roughness"].default_value = 0.62
    nt.links.new(coord.outputs["Object"], ruido.inputs["Vector"])
    faixa = nt.nodes.new("ShaderNodeMapRange")
    faixa.inputs["From Min"].default_value = 0.42
    faixa.inputs["From Max"].default_value = 0.66
    faixa.clamp = True
    nt.links.new(ruido.outputs["Fac"], faixa.inputs["Value"])

    mistura_sujeira = nt.nodes.new("ShaderNodeMix")
    mistura_sujeira.data_type = "RGBA"
    mistura_sujeira.inputs[6].default_value = base
    mistura_sujeira.inputs[7].default_value = sujeira
    nt.links.new(faixa.outputs["Result"], mistura_sujeira.inputs["Factor"])

    # Desgaste nas arestas.
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    ponta = nt.nodes.new("ShaderNodeMapRange")
    ponta.inputs["From Min"].default_value = 0.51
    ponta.inputs["From Max"].default_value = 0.60
    ponta.clamp = True
    nt.links.new(geo.outputs["Pointiness"], ponta.inputs["Value"])
    # Quebra o desgaste com ruido fino, senao vira contorno de desenho.
    grao = nt.nodes.new("ShaderNodeTexNoise")
    grao.inputs["Scale"].default_value = 55.0
    grao.inputs["Detail"].default_value = 4.0
    nt.links.new(coord.outputs["Object"], grao.inputs["Vector"])
    mult = nt.nodes.new("ShaderNodeMath")
    mult.operation = "MULTIPLY"
    nt.links.new(ponta.outputs["Result"], mult.inputs[0])
    nt.links.new(grao.outputs["Fac"], mult.inputs[1])

    mistura_polido = nt.nodes.new("ShaderNodeMix")
    mistura_polido.data_type = "RGBA"
    nt.links.new(mistura_sujeira.outputs[2], mistura_polido.inputs[6])
    mistura_polido.inputs[7].default_value = polido
    nt.links.new(mult.outputs[0], mistura_polido.inputs["Factor"])

    # Oclusao de ambiente, que e o que assenta a peca e cava as juntas.
    ao = nt.nodes.new("ShaderNodeAmbientOcclusion")
    ao.samples = 24
    ao.inputs["Distance"].default_value = 0.16
    ao.only_local = True
    ao_faixa = nt.nodes.new("ShaderNodeMapRange")
    ao_faixa.inputs["From Min"].default_value = 0.0
    ao_faixa.inputs["From Max"].default_value = 1.0
    ao_faixa.inputs["To Min"].default_value = 0.34
    ao_faixa.inputs["To Max"].default_value = 1.0
    nt.links.new(ao.outputs["AO"], ao_faixa.inputs["Value"])

    com_ao = nt.nodes.new("ShaderNodeMix")
    com_ao.data_type = "RGBA"
    com_ao.blend_type = "MULTIPLY"
    com_ao.inputs["Factor"].default_value = 1.0
    nt.links.new(mistura_polido.outputs[2], com_ao.inputs[6])
    nt.links.new(ao_faixa.outputs["Result"], com_ao.inputs[7])

    # Rugosidade e metalicidade no formato do glTF: verde rugosidade, azul
    # metalicidade. Aresta polida e mais lisa, ferrugem e mais fosca.
    rug = nt.nodes.new("ShaderNodeMapRange")
    rug.inputs["To Min"].default_value = rug_base
    rug.inputs["To Max"].default_value = rug_polido
    nt.links.new(mult.outputs[0], rug.inputs["Value"])
    rug_ox = nt.nodes.new("ShaderNodeMath")
    rug_ox.operation = "ADD"
    rug_ox.use_clamp = True
    nt.links.new(rug.outputs["Result"], rug_ox.inputs[0])
    ox_peso = nt.nodes.new("ShaderNodeMath")
    ox_peso.operation = "MULTIPLY"
    ox_peso.inputs[1].default_value = 0.28
    nt.links.new(faixa.outputs["Result"], ox_peso.inputs[0])
    nt.links.new(ox_peso.outputs[0], rug_ox.inputs[1])

    metal_no = nt.nodes.new("ShaderNodeValue")
    metal_no.outputs[0].default_value = metal
    combinar = nt.nodes.new("ShaderNodeCombineColor")
    combinar.inputs["Red"].default_value = 0.0
    nt.links.new(rug_ox.outputs[0], combinar.inputs["Green"])
    nt.links.new(metal_no.outputs[0], combinar.inputs["Blue"])

    # Nos de textura pro alvo do bake. O Blender assa no no de imagem ativo.
    tex_cor = nt.nodes.new("ShaderNodeTexImage")
    tex_cor.image = cor
    tex_orm = nt.nodes.new("ShaderNodeTexImage")
    tex_orm.image = orm

    mat.node_tree.nodes.active = tex_cor
    return mat, {
        "emissao": emis,
        "cor": com_ao.outputs[2],
        "orm": combinar.outputs[0],
        "tex_cor": tex_cor,
        "tex_orm": tex_orm,
    }


ferro, laco_ferro = montar_material(
    "Armadura", FERRO, FERRO_POLIDO, FERRUGEM, 4.5, 0.45, 0.70, 0.26)
couro, laco_couro = montar_material(
    "Couro", COURO, COURO_GASTO, COURO_GASTO, 9.0, 0.02, 0.86, 0.58)

# --------------------------------------------------- capa e pauldrons

# O mannequim e um corpo liso de bola nas juntas. Textura resolve a cor, nao a
# silhueta: de longe, no escuro, ele continua sendo um boneco. O briefing ja
# previa o caminho, "armadura CC0 retexturizada e capa", entao a capa e os
# pauldrons entram como geometria, costurados na mesma malha com pele nos
# mesmos ossos. Nada de saia: a perna sobe muito em corrida e rolamento e
# atravessaria por fora, e capa e ombreira ficam onde a perna nao passa.

# Cadeia da coluna com a altura da cabeca de cada osso, pra pesar a capa por
# altura em vez de por distancia, que num plano fino erra feio.
COLUNA = [("DEF-hips", 0.9167), ("DEF-spine.001", 1.0505),
          ("DEF-spine.002", 1.1736), ("DEF-spine.003", 1.3148)]


def pesos_da_coluna(z):
    """Mistura de dois ossos vizinhos da coluna, pela altura do vertice."""
    if z <= COLUNA[0][1]:
        return [(COLUNA[0][0], 1.0)]
    if z >= COLUNA[-1][1]:
        return [(COLUNA[-1][0], 1.0)]
    for (n0, z0), (n1, z1) in zip(COLUNA, COLUNA[1:]):
        if z0 <= z <= z1:
            t = (z - z0) / (z1 - z0)
            return [(n0, 1 - t), (n1, t)]
    return [(COLUNA[-1][0], 1.0)]


def pintar(ob, pesos_por_vertice):
    for i, pesos in enumerate(pesos_por_vertice):
        for nome, peso in pesos:
            if peso <= 0.001:
                continue
            grupo = ob.vertex_groups.get(nome) or ob.vertex_groups.new(name=nome)
            grupo.add([i], peso, "REPLACE")


def construir_capa():
    """
    Manto preso nos ombros, aberto na frente, com barra rasgada.

    Um pano curvo em volta das costas: o angulo varre o dorso, o raio abre da
    nuca pra barra e a altura desce. A barra ganha um dente por coluna pra nao
    terminar em linha reta, que e o que denuncia geometria gerada.
    """
    LINHAS, COLUNAS_N = 14, 18
    ABERTURA = 1.48           # radianos pra cada lado, medidos a partir das costas
    verts, faces, pesos = [], [], []
    for i in range(LINHAS + 1):
        t = i / LINHAS
        raio = 0.168 + 0.152 * t ** 1.25
        z = 1.505 - 1.150 * t
        recuo = 0.055 * t ** 1.6
        for j in range(COLUNAS_N + 1):
            u = j / COLUNAS_N * 2 - 1
            a = u * ABERTURA
            zz = z
            if i == LINHAS:
                # Barra rasgada: dente por coluna, alternado.
                zz += 0.11 * (0.35 + 0.65 * ((j * 7 % 5) / 4.0))
            verts.append(Vector((raio * math.sin(a), 0.012 + recuo + raio * math.cos(a), zz)))
            pesos.append(pesos_da_coluna(zz))
    for i in range(LINHAS):
        for j in range(COLUNAS_N):
            a = i * (COLUNAS_N + 1) + j
            b = a + 1
            c = a + COLUNAS_N + 1
            d = c + 1
            faces.append((a, b, d, c))
    malha_capa = bpy.data.meshes.new("Capa")
    malha_capa.from_pydata([tuple(v) for v in verts], [], faces)
    malha_capa.update()
    ob = bpy.data.objects.new("Capa", malha_capa)
    bpy.context.scene.collection.objects.link(ob)
    pintar(ob, pesos)
    return ob


def construir_pauldron(lado):
    """Ombreira: uma calota achatada por cima do braco, presa no proprio braco."""
    osso = f"DEF-upper_arm.{lado}"
    sinal = 1 if lado == "L" else -1
    bpy.ops.mesh.primitive_uv_sphere_add(segments=14, ring_count=8,
                                         location=(sinal * 0.215, 0.045, 1.470))
    ob = bpy.context.active_object
    ob.name = f"Pauldron{lado}"
    ob.scale = (0.135, 0.125, 0.105)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    # Achata a parte de baixo pra virar calota em vez de bola. Os vertices da
    # malha estao em espaco local, com origem no centro da esfera: comparar com
    # a altura de mundo empurraria a peca inteira pra cima do personagem.
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    for v in bm.verts:
        if v.co.z < 0.0:
            v.co.z *= 0.55
    bm.to_mesh(ob.data)
    bm.free()
    pintar(ob, [[(osso, 1.0)]] * len(ob.data.vertices))
    return ob


capa = construir_capa()
pauldrons = [construir_pauldron("L"), construir_pauldron("R")]
capa.data.materials.append(couro)
for p in pauldrons:
    p.data.materials.append(ferro)

# O mannequim precisa dos dois slots na ordem certa antes de juntar: o Blender
# funde slots iguais, entao a capa cai no indice do couro e a ombreira no do
# ferro sem precisar remexer indice de face depois.
malha.data.materials.clear()
malha.data.materials.append(ferro)
malha.data.materials.append(couro)

bpy.ops.object.select_all(action="DESELECT")
for o in [capa] + pauldrons:
    o.select_set(True)
malha.select_set(True)
bpy.context.view_layer.objects.active = malha
antes_v = len(malha.data.vertices)
bpy.ops.object.join()
log(f"capa e ombreiras costuradas: {antes_v} -> {len(malha.data.vertices)} vertices, "
    f"{len(malha.data.polygons)} poligonos, "
    f"slots {[m.name for m in malha.data.materials]}")



# ------------------------------------------------------------------ UV nova

for camada in list(malha.data.uv_layers):
    malha.data.uv_layers.remove(camada)
malha.data.uv_layers.new(name="UVMap")

bpy.ops.object.select_all(action="DESELECT")
malha.select_set(True)
bpy.context.view_layer.objects.active = malha
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.0, correct_aspect=True)
# Densidade igual em todas as ilhas e reempacotamento apertado. A margem do
# proprio smart project e por ilha e come o quadrado inteiro quando sao muitas;
# empacotar depois com margem pequena rende o dobro de area util.
bpy.ops.uv.select_all(action="SELECT")
bpy.ops.uv.average_islands_scale()
bpy.ops.uv.pack_islands(rotate=True, margin=0.004)
bpy.ops.object.mode_set(mode="OBJECT")

# Eficiencia do empacotamento pela soma das areas dos triangulos no espaco UV,
# nao por amostragem de vertice: amostrar so os cantos de cada triangulo conta
# a borda das ilhas e ignora o miolo, e subestima por um fator de dois.
uvl = malha.data.uv_layers.active
area = 0.0
for p in malha.data.polygons:
    us = [uvl.data[i].uv for i in p.loop_indices]
    for k in range(1, len(us) - 1):
        a, b, c = us[0], us[k], us[k + 1]
        area += abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2
log(f"UV nova: {len(malha.data.polygons)} poligonos ocupam {area*100:.1f}% do quadrado")
assert area > 0.34, "desembrulho ruim, menos de 30% do quadrado ocupado"


# ------------------------------------------------------------------- assadura

cena.render.engine = "CYCLES"
cena.cycles.device = "CPU"
cena.cycles.samples = 1
cena.render.bake.margin = 10
cena.render.bake.use_clear = True
cena.render.bake.use_selected_to_active = False


def assar(alvo, saida_socket, tex):
    for mat, laco in ((ferro, laco_ferro), (couro, laco_couro)):
        nt = mat.node_tree
        emis = laco["emissao"]
        for link in list(emis.inputs["Color"].links):
            nt.links.remove(link)
        nt.links.new(laco[saida_socket], emis.inputs["Color"])
        nt.nodes.active = laco[tex]
    bpy.ops.object.bake(type="EMIT")
    log(f"assado {alvo.name}")


bpy.ops.object.select_all(action="DESELECT")
malha.select_set(True)
bpy.context.view_layer.objects.active = malha

assar(cor, "cor", "tex_cor")
assar(orm, "orm", "tex_orm")

os.makedirs(TEXTURAS, exist_ok=True)
cor.filepath_raw = os.path.join(TEXTURAS, "armadura-cor.png")
cor.file_format = "PNG"
cor.save()
orm.filepath_raw = os.path.join(TEXTURAS, "armadura-orm.png")
orm.file_format = "PNG"
orm.save()
log("texturas:", TEXTURAS)


# ------------------------------------------------- material final, um so slot

final = bpy.data.materials.new("Armadura_Gasta")
final.use_nodes = True
nt = final.node_tree
for n in list(nt.nodes):
    nt.nodes.remove(n)
saida = nt.nodes.new("ShaderNodeOutputMaterial")
bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
nt.links.new(bsdf.outputs[0], saida.inputs["Surface"])

t_cor = nt.nodes.new("ShaderNodeTexImage")
t_cor.image = cor
nt.links.new(t_cor.outputs["Color"], bsdf.inputs["Base Color"])

t_orm = nt.nodes.new("ShaderNodeTexImage")
t_orm.image = orm
t_orm.image.colorspace_settings.name = "Non-Color"
sep = nt.nodes.new("ShaderNodeSeparateColor")
nt.links.new(t_orm.outputs["Color"], sep.inputs["Color"])
# O exportador de glTF reconhece exatamente este desenho e junta os dois num
# unico `metallicRoughnessTexture`.
nt.links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
nt.links.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])

# Capa e uma casca de uma face so; sem desligar o descarte de face traseira ela
# some quando a camera passa pro outro lado.
final.use_backface_culling = False
malha.data.materials.clear()
malha.data.materials.append(final)
for p in malha.data.polygons:
    p.material_index = 0


# ------------------------------------------------------------------ exportacao

for a in bpy.data.actions:
    a.use_fake_user = True

bpy.ops.object.select_all(action="DESELECT")
malha.select_set(True)
arm.select_set(True)
bpy.context.view_layer.objects.active = arm

bpy.ops.export_scene.gltf(
    filepath=SAIDA,
    export_format="GLB",
    use_selection=True,
    export_animations=True,
    export_animation_mode="ACTIONS",
    export_nla_strips=False,
    export_bake_animation=False,
    export_skins=True,
    export_apply=False,
    export_yup=True,
    export_materials="EXPORT",
    export_image_format="AUTO",
)
log("exportado:", SAIDA, f"{os.path.getsize(SAIDA)/1e6:.2f} MB")
