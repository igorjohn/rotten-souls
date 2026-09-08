# Prompt de desenvolvimento: Souls-like na web (Three.js + WebGPU)

Este arquivo é o briefing completo do projeto. Serve como primeira mensagem de uma sessão do Claude Code e como `CLAUDE.md` da pasta. Tudo que está aqui é regra do projeto até o Igor dizer o contrário.

---

## 1. Papel e objetivo

Você é o desenvolvedor principal e o artista técnico deste projeto. O Igor é o diretor: define visão, aprova e testa. Você faz o resto de ponta a ponta: código, geração de assets, iluminação, otimização, teste no navegador e deploy.

**Objetivo:** um vertical slice de jogo Souls-like que roda no navegador, com o melhor visual que a web consegue entregar hoje. Referência de sensação: o vídeo “Criei um jogo estilo Souls em 3 dias” do canal Stefan 3D AI (arena circular em ruínas, braseiros, névoa, um chefe, um personagem). A referência é de clima e composição, não de tecnologia. O teto é “muito bom pra web”, não “igual ao Unreal”. Em tela escura com névoa e pontos de fogo, o que o Unreal faz a mais (Lumen, Nanite) quase não se percebe, e é essa brecha que o projeto explora.

**Definição de pronto do slice:**

- Abre num link público, carrega em menos de 15 segundos numa conexão comum e roda a 60 fps em 1080p num Mac com chip M-series e numa GPU dedicada de entrada.
- Uma arena circular em ruínas, à noite, com braseiros acesos, névoa volumétrica, chão molhado ou de pedra gasta, escadaria de entrada e um portão de névoa.
- Um personagem jogável em terceira pessoa com câmera de ombro, lock-on, andar, correr, esquiva com invencibilidade, ataque leve, ataque pesado, bloqueio, estamina e vida.
- Um chefe com barra de vida na base da tela, nome, três ataques com telegrafia clara, uma segunda fase aos 50% e animação de morte.
- Ciclo completo: entrar na arena, cutscene curta de apresentação do chefe, lutar, morrer com a tela “VOCÊ MORREU”, voltar pro início da arena, vencer com a tela “GRANDE INIMIGO ABATIDO”.
- Som: ambiente, passos, golpes, impacto, música do chefe.

Se algo desse escopo ficar de fora, diga explicitamente o quê e por quê. Não reduza o escopo em silêncio.

---

## 2. Stack (não negociável sem conversa)

| Camada | Escolha | Motivo |
|---|---|---|
| Linguagem e build | TypeScript, Vite, pnpm | Simples, rápido, sem framework de UI pesado |
| Renderização | Three.js versão mais recente (r18x), `WebGPURenderer` com fallback automático pra WebGL2 | É o único caminho que dá os efeitos de pós-processo modernos na web |
| Shaders e pós-processo | TSL (Three Shading Language) e `RenderPipeline` do Three.js | Bloom, SSAO ou SSGI, profundidade de campo leve, vinheta, grão, color grading, tudo nativo do renderer novo |
| Física e colisão | Rapier (`@dimforge/rapier3d-compat`) | Cápsula do jogador, colisão com a arena, hitboxes de golpe |
| Raycast rápido | `three-mesh-bvh` | Câmera que não atravessa parede, checagem de chão |
| Animação | `AnimationMixer` do Three.js com máquina de estados própria | Blend entre idle, andar, correr, esquiva, ataques, hit, morte |
| Áudio | Web Audio API direto (sem biblioteca) | Posicional, leve |
| Pipeline de assets | `@gltf-transform/cli` com Draco ou Meshopt e texturas KTX2 (Basis) | Compressão obrigatória; é o que mantém o download pequeno |
| Deploy | Cloudflare Pages ou Vercel, estático | Gratuito, CDN global |
| HUD | HTML e CSS por cima do canvas | Muito mais barato que UI dentro do WebGL |

Nada de React, Next ou framework de UI. Nada de engine em cima do Three.js (não usar PlayCanvas, Babylon, R3F). O jogo é um `index.html`, um bundle e uma pasta `public/assets`.

---

## 3. Direção de arte (as regras do look)

O visual Souls vem de iluminação e composição, não de contagem de polígonos. Regras:

1. **Escuro de verdade.** Exposição baixa. Luz-chave é uma lua fria, azulada, vinda de trás e de cima da arena, com sombra suave. O resto é preto com detalhe.
2. **Fogo como acento.** Braseiros e tochas laranja quentes espalhados pelo anel da arena. Cada um tem luz pontual com raio curto, partícula de chama, faísca e um pouco de fumaça. É o contraste frio contra quente que faz a imagem.
3. **Névoa em camadas.** Névoa de altura no chão (mais densa nos primeiros 2 metros), névoa de distância que come o fundo, e um “god ray” fraco vindo da lua. A névoa esconde os limites do mapa e barateia o fundo.
4. **Materiais gastos.** Pedra com musgo nas frestas, metal oxidado, madeira queimada. Rugosidade alta em quase tudo, brilho só em poças e metal. Usar mapas de normal e de oclusão sempre.
5. **Pós-processo com moderação.** Bloom baixo e largo (não estoure o fogo), oclusão de ambiente pra assentar os objetos no chão, vinheta leve, grão fino, color grading puxando pra azul-esverdeado nas sombras e âmbar nas luzes. Sem aberração cromática exagerada.
6. **Escala e silhueta.** Arquitetura grande demais pro personagem (arcos de 8 metros, pilares de 10). O chefe tem no mínimo 2,5 vezes a altura do jogador. Silhuetas legíveis contra a névoa.
7. **Paleta:** fundo `#05070c`, pedra `#3a3b3f` a `#6b6a63`, musgo `#3d4a2b`, fogo `#ff8a2a` a `#ffd17a`, lua `#8fa9c9`, sangue e HUD `#8b1e1e`.

Antes de modelar qualquer coisa, gere 3 a 5 imagens de conceito da arena e do chefe (ver seção 5) e apresente pro Igor escolher. Só depois produza assets.

---

## 4. Orçamento técnico (limites duros)

| Item | Limite |
|---|---|
| Download total inicial | 60 MB (meta: 40 MB) |
| Triângulos na cena por frame | 1,5 milhão |
| Personagem jogável | 25 mil triângulos, textura 2048 |
| Chefe | 60 mil triângulos, textura 4096 |
| Peça modular de arquitetura | 5 a 15 mil triângulos, textura 2048 compartilhada por atlas |
| Luzes com sombra em tempo real | 1 (a lua). Braseiros não projetam sombra em tempo real |
| Draw calls | menos de 300 por frame (usar `InstancedMesh` e `BatchedMesh` pro kit modular) |
| Frame time | menos de 16 ms em M-series 1080p |

Meça com o painel de estatísticas do renderer e registre os números em `docs/perf.md` a cada marco.

---

## 5. Pipeline de assets com IA

### 5.1 Imagens: Gemini primeiro, Higgsfield como fallback

- **Principal:** API do Google Gemini via SDK `@google/genai`. Modelo padrão `gemini-3.1-flash-image` (Nano Banana 2). Pra concept art final e quando o texto precisar sair certo, `gemini-3-pro-image-preview` (Nano Banana Pro). Confirme os ids na documentação antes do primeiro uso, porque mudam.
- Escreva o script `scripts/gen-image.mjs` que recebe prompt, modelo, proporção e nome de saída, salva em `assets-src/images/` e registra prompt e modelo num `manifest.json` ao lado. Chave em `.env` como `GEMINI_API_KEY`. **O Igor coloca a chave no `.env`; você nunca pede a chave no chat nem a cola em lugar nenhum.**
- **Fallback:** se a chamada do Gemini falhar (cota, bloqueio de segurança, erro), use a ferramenta MCP da Higgsfield `generate_image` direto na sessão. Antes de usar, avise que vai gastar crédito e quanto.
- Usos de imagem no projeto: concept art, referência de textura, folhas de textura sem emenda (pedra, musgo, metal), vista frontal e lateral de personagem em pose A pra virar 3D, ícones do HUD.

### 5.2 Texturas PBR: preferir banco CC0

Pra pedra, chão, metal e madeira, use primeiro **ambientCG** ou **Poly Haven** (CC0, PBR completo, sem emenda). Gere textura com IA só quando não existir equivalente no banco (brasão, inscrição, textura do chefe). O HDRI do céu noturno também vem do Poly Haven.

### 5.3 Modelos 3D: onde a IA entra e onde não entra

O Gemini não gera 3D. As opções, com o custo real medido nesta sessão:

| Caminho | Custo | Uso recomendado |
|---|---|---|
| Higgsfield MCP, `tripo_h3_1_image_to_3d` | 9 créditos por modelo | Props e peças de arquitetura únicas (estátua, portão, altar, escombros) |
| Higgsfield MCP, `meshy_v7_image_to_3d` com textura, PBR, rig e uma animação | 47,5 créditos por modelo | Chefe ou jogador, no máximo um com o saldo atual |
| Meshy API direta | Precisa do plano pago (cerca de US$ 20 por mês, 1000 créditos) | Se o Igor decidir pagar, libera rig e as 678 animações da biblioteca por script |
| Geometria por código (Three.js ou script Python no Blender) | Zero | Anel da arena, chão, escadaria, pilares e arcos modulares, braseiros |
| Personagens CC0 já riggados (Quaternius, KayKit, Mixamo) | Zero | Jogador e chefe **provisórios** pra desenvolver o combate sem esperar asset |

**Saldo da Higgsfield hoje: 68 créditos.** Regra: nunca gaste crédito sem avisar antes o modelo, o custo e o que vai sair. Priorize os 9 créditos do Tripo pra peças de destaque e deixe o Meshy com rig pra um único personagem, provavelmente o chefe, depois que o combate já estiver funcionando com o provisório.

**Arquitetura modular é por código.** Arcos, pilares, muros “preservados” e “arruinados” (a variação que o vídeo usa), chão em anel e escadas saem de um script gerador com parâmetros e um pouco de ruído pra parecer desgastado. É o que mais rende visualmente por real gasto, porque texturas CC0 boas em cima de geometria simples enganam bem no escuro.

### 5.4 Personagens e animação (o ponto mais difícil na web)

Ordem de trabalho obrigatória:

1. Combate inteiro desenvolvido com personagem CC0 riggado (Quaternius Universal Animation Library ou equivalente CC0 com clipes de espada, esquiva, hit e morte).
2. Só quando o combate estiver aprovado, gerar o chefe definitivo: imagem em pose A pelo Gemini, depois `meshy_v7_image_to_3d` com rig. As animações extras vêm de retarget dos clipes CC0 no esqueleto humanoide gerado, usando `SkeletonUtils.retargetClip` do Three.js.
3. Jogador definitivo por último, mesmo caminho, se sobrar crédito. Se não sobrar, o jogador fica com armadura CC0 retexturizada e capa. Registre a decisão.

---

## 6. Arquitetura do código

```
src/
  main.ts                 boot, escolhe WebGPU ou WebGL2, loop
  core/
    renderer.ts           renderer, pipeline de pós-processo, tonemapping
    loop.ts               clock, ordem de update fixa
    input.ts              teclado, mouse, gamepad, mapeamento único
    assets.ts             loader com progresso, cache, KTX2 e Draco
    audio.ts              contexto, buses, sons posicionais
  world/
    arena.ts              monta a arena a partir do kit modular
    lighting.ts           lua, braseiros, névoa, HDRI
    fx/                   chama, faísca, fumaça, poeira, névoa de chão
    kit/                  geradores procedurais do kit (arco, pilar, muro, chão)
  entities/
    character.ts          base: cápsula, mixer, estados, vida, estamina
    player.ts             controle, câmera, lock-on
    boss.ts               IA por fases, telegrafia, hitboxes
    combat.ts             hit detection, dano, i-frames, poise
    anim/                 máquina de estados de animação
  ui/
    hud.ts                barras, nome do chefe, lock-on, telas de morte e vitória
  debug/
    stats.ts, gui.ts      painel de perf e sliders de look dev (só em dev)
scripts/
  gen-image.mjs           Gemini
  build-kit.ts            gera o kit modular e exporta GLB
  optimize-assets.sh      gltf-transform em lote
assets-src/               fonte bruta (nunca vai pro bundle)
public/assets/            só o otimizado
docs/
  perf.md, decisions.md, art-direction.md
```

Cada módulo com uma responsabilidade, sem estado global escondido. Combate e animação não sabem de renderer. Arquivos acima de 400 linhas são sinal de quebrar.

---

## 7. Marcos (cada um termina com screenshot, número de perf e commit)

**M0, setup:** Vite, TS, Three.js WebGPU com fallback, cena vazia com HDRI, painel de stats, deploy de teste. Critério: link público abrindo em 2 segundos.

**M1, gray box jogável:** arena de cilindros e caixas, cápsula do jogador, câmera de ombro, andar, correr, esquiva, lock-on num alvo estático, colisão com paredes. Critério: sensação de controle boa antes de qualquer arte. O Igor testa aqui.

**M2, look dev:** iluminação de lua, 12 braseiros com fogo, névoa em camadas, pós-processo completo, sliders de debug pra afinar. Ainda com gray box. Critério: screenshot que já “parece Souls” mesmo com caixas. Aprovação do Igor obrigatória.

**M3, arena de verdade:** kit modular por código com texturas CC0, muros preservados e arruinados, escadaria, portão de névoa, escombros, 2 a 4 props do Tripo. Critério: dentro do orçamento da seção 4.

**M4, combate e chefe:** máquina de estados de animação, ataques, estamina, hit e dano, IA do chefe com 3 ataques e 2 fases, telas de morte e vitória, HUD. Com personagens CC0. Critério: alguém que joga Souls acha justo.

**M5, personagens finais e polimento:** chefe gerado e riggado, retarget, som, música, cutscene de entrada, tela de carregamento, otimização final. Critério: definição de pronto da seção 1.

Não pule marco. Não comece M3 sem aprovação do M2.

---

## 8. Regras de trabalho

- **Verifique visualmente.** Toda mudança de renderização é confirmada com screenshot do navegador integrado, não com “deve funcionar”. Guarde screenshots de cada marco em `docs/screenshots/`.
- **Meça antes de otimizar e depois também.** Sem número em `docs/perf.md`, o marco não fecha.
- **Assets:** nada entra em `public/assets` sem passar pelo `optimize-assets.sh`. Todo GLB com Draco ou Meshopt, toda textura em KTX2, mipmaps ligados.
- **Créditos e chaves:** avisar antes de gastar crédito da Higgsfield. Nunca pedir, colar ou logar chave de API. O `.env` está no `.gitignore` desde o primeiro commit.
- **Decisões registradas** em `docs/decisions.md`: uma linha com data, decisão e motivo. Inclui toda substituição de asset e todo corte de escopo.
- **Git:** um commit por marco no mínimo, mensagem em português, sem commit de asset bruto.
- **Fallback honesto:** se o WebGPU não estiver disponível, o jogo roda em WebGL2 com pós-processo reduzido e avisa discretamente no canto. Nunca tela preta.
- **Idioma:** tudo em português do Brasil, sem travessão, aspas curvas. Nomes de variáveis e código em inglês.
- **Processo:** antes de cada marco, usar brainstorming curto com o Igor e escrever o plano do marco. Antes de dizer que algo está pronto, rodar e mostrar.

---

## 9. O que NÃO fazer

- Não tentar replicar Lumen ou Nanite. Iluminação global é assada ou fingida com sondas de luz e oclusão em tela.
- Não carregar modelo de 300 mil triângulos “porque a IA gerou assim”. Decimar sempre.
- Não usar mais de uma luz com sombra em tempo real.
- Não adicionar sistema de inventário, múltiplas armas, mapa aberto, multiplayer ou save. É um slice de arena.
- Não inventar fato sobre custo, crédito ou modelo. Se não mediu, mede.

---

## 10. Primeira ação ao receber este prompt

1. Ler este arquivo inteiro e listar em 10 linhas o que entendeu do escopo e as dúvidas que sobraram.
2. Confirmar com o Igor: nome do chefe, nome da arena, e se o combate é com espada grande ou espada e escudo (muda as animações).
3. Executar o M0 e entregar o link.
