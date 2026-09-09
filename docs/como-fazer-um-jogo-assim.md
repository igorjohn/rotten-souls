# Como fazer um jogo assim

Receita completa do Rotten Souls, um vertical slice de Souls-like que roda no
navegador em WebGPU. Não é teoria: é o que foi feito de verdade, com os números
medidos, os custos reais e principalmente as armadilhas em que a gente caiu.

Serve para quem quer reproduzir o fluxo em outro jogo. Leia até o fim antes de
começar, sobretudo a seção 8, que é onde está o dinheiro.

---

## 1. O que sai disso

Um jogo jogável num link público, com:

- Arena em ruínas gerada inteiramente por código, sem modelo de arquitetura importado
- Personagem em terceira pessoa com câmera de ombro, lock-on, esquiva com invencibilidade, ataque leve e pesado encadeáveis, estamina
- Um chefe com telegrafia, duas fases e ciclo completo de morrer e voltar
- Iluminação noturna, névoa em camadas, pós-processo, som

Números reais deste projeto, medidos e registrados a cada marco:

| Item | Medido | Teto que a gente se deu |
|---|---|---|
| Frame time | 4,7 ms | 16 ms |
| Draw calls | 104 | 300 |
| Triângulos por frame | 161 mil | 1,5 milhão |
| Download de assets | 19 MB | 60 MB |

Tempo: os cinco marcos saíram em poucos dias de trabalho dirigido. O que come
tempo não é escrever código, é decidir e verificar.

---

## 2. As ferramentas, e o papel de cada uma

Nada aqui é obrigatório, mas cada peça está no lugar por um motivo.

| Ferramenta | Para quê | Custo real |
|---|---|---|
| **Claude Code** | escreve o jogo inteiro, roda o Blender, mede performance, tira screenshot no navegador e faz o deploy | assinatura |
| **ChatGPT** | identidade visual: logo, arte de capa, banner do README, fundo do menu | assinatura |
| **OpenRouter** | texturas PBR e trilha por API, num único lugar com preço na tabela | **US$ 0,96 no projeto inteiro** |
| **Higgsfield (MCP)** | modelo 3D do chefe a partir de imagem, com rig | créditos, ver seção 5 |
| **Blender 4.5 LTS** | retarget de animação e assadura de textura, tudo em modo headless por script | grátis |
| **ambientCG e Poly Haven** | texturas PBR e HDRI, CC0 | grátis |
| **Quaternius** | personagem riggado provisório com 46 animações, CC0 | grátis |
| **ffmpeg e yt-dlp** | cortar, normalizar e comprimir áudio e imagem | grátis |
| **Cloudflare Workers** | hospedar o build estático | grátis |

### A stack de código

```
TypeScript + Vite + pnpm
three ^0.185          WebGPURenderer, com fallback automático pra WebGL2
                      TSL para o pós-processo, sem biblioteca de efeito
@dimforge/rapier3d-compat ^0.20    física e controlador de personagem
three-mesh-bvh ^0.9   raycast rápido, câmera que não atravessa parede
@gltf-transform/cli   compressão de GLB
Web Audio API direto, sem biblioteca
HUD em HTML e CSS por cima do canvas
```

Nada de React, Next, R3F, Babylon ou PlayCanvas. O jogo é um `index.html`, um
bundle e uma pasta `public/assets`. Isso não é purismo: engine em cima de engine
é onde o frame time some.

---

## 3. O passo zero, e é o mais importante

**Escreva um briefing antes de escrever uma linha de código.**

O arquivo `CLAUDE.md` na raiz do projeto foi o que fez isso funcionar. Ele tem
dez seções e o agente relê a cada sessão. O que precisa estar lá:

1. **Papel e objetivo.** Quem é o agente, quem é você, e o que conta como pronto.
   Definição de pronto escrita em lista, não em adjetivo.
2. **Stack, marcada como não negociável.** Sem isso o agente troca de biblioteca no meio.
3. **Direção de arte em regras, não em referências.** "Escuro de verdade, fogo como acento, névoa em camadas, materiais gastos" mais a paleta em hexadecimal.
4. **Orçamento técnico com número.** Triângulos, draw calls, textura, download, frame time. Número, não "leve".
5. **Pipeline de asset**, dizendo o que vem de IA, o que vem de banco CC0 e o que sai de código.
6. **Arquitetura de pastas**, com uma responsabilidade por módulo.
7. **Marcos**, cada um terminando em screenshot, número de performance e commit.
8. **Regras de trabalho.** As três que mais renderam: verifique visualmente com screenshot, meça antes e depois de otimizar, registre toda decisão numa linha com o motivo.
9. **O que NÃO fazer.** Corte de escopo explícito. "Sem inventário, sem múltiplas armas, sem mapa aberto, sem multiplayer, sem save."
10. **Primeira ação ao receber este prompt.**

E as regras de dinheiro e de segredo:

> Nunca peça, cole ou logue chave de API. O `.env` está no `.gitignore` desde o
> primeiro commit. Avise antes de gastar crédito, dizendo o modelo, o custo e o
> que vai sair. Não invente fato sobre custo, crédito ou modelo. Se não mediu, mede.

Essa última frase, **se não mediu, mede**, é a que mais mudou a qualidade do
resultado. Ela transforma "acho que melhorou" em "caiu de 125 cm para 36 cm".

---

## 4. A ordem dos marcos, e por que ela é essa

Não pule. A ordem existe para você reprovar cedo, quando refazer é barato.

**M0, setup.** Vite, TypeScript, `WebGPURenderer` com fallback, cena vazia com
HDRI, painel de estatísticas, deploy de teste. Critério: link público abrindo.

**M1, gray box jogável.** Arena de cilindros e caixas, cápsula do jogador,
câmera de ombro, andar, correr, esquiva, lock-on, colisão. **Você testa aqui.**
Se o controle não é bom com caixas, não vai ficar bom com arte.

**M2, look dev.** Lua, braseiros, névoa, pós-processo, sliders de debug. Ainda
com gray box. Critério: screenshot que já parece Souls mesmo com caixas.
Aprovação obrigatória antes de seguir.

**M3, arena de verdade.** Kit modular por código com texturas CC0.

**M4, combate e chefe.** Máquina de estados de animação, ataques, estamina,
hit, dano, IA com fases, HUD, telas de morte e vitória. Com personagem CC0.

**M5, personagens finais e polimento.** Só agora o chefe gerado, retarget, som,
música, cutscene, otimização.

O princípio: **arte por último, controle primeiro.** Todo mundo faz ao contrário
e todo mundo perde o asset bonito no lixo.

---

## 5. O pipeline de asset, peça por peça

### Arquitetura: por código, sempre

Arcos, pilares, muros preservados e arruinados, chão em anel, escadaria e
braseiros saem de um kit paramétrico com um pouco de ruído. Custo zero, ajuste
instantâneo, e textura CC0 boa em cima de geometria simples engana muito bem no
escuro. Foi o que mais rendeu por real gasto no projeto inteiro.

### Texturas de cenário: banco CC0 primeiro

ambientCG e Poly Haven, PBR completo e sem emenda. Gere textura com IA só quando
não existir equivalente no banco.

### Texturas de personagem: **só o albedo vem da IA**

Esta é a lição mais transferível do projeto.

Modelo de imagem **não faz normal map nem roughness confiável**. Peça só o
albedo, sem emenda, com iluminação chapada, e derive o resto por código:

- **altura**: luminância menos uma versão muito borrada dela, o que remove a iluminação que a imagem já traz embutida. Sem isso, um degradê do modelo vira duna no normal.
- **normal**: Sobel na altura, com vizinhança circular, senão o mapa deixa de ser ladrilhável.
- **rugosidade**: luminância invertida, normalizada por percentil e remapeada na faixa da peça. Metal polido embaixo, tecido em cima.
- **AO**: cavidade, que é o borrado menos o original.
- **metalness**: constante por peça, sem mapa nenhum.

Duas armadilhas que só apareceram olhando:

**Em metal, o albedo é a refletância especular.** O aço veio sete vezes escuro
demais e a esfera de teste saiu preta. Cada peça precisa de alvo físico de
refletância, com o ganho aplicado em espaço linear.

**Meça a emenda antes de remendar.** Remendar um eixo que já fechava criou uma
faixa fantasma pior que a costura original.

Faça **peça a peça**, não uma textura de personagem inteiro: aço de placa, malha
de ferro, couro, tecido, aço de lâmina, latão. Cada uma com a própria densidade
de ladrilho, e a escala como parâmetro, porque um chefe de 4,6 m com a mesma
textura do jogador de 1,85 m fica com cara de brinquedo.

> Custo real das seis peças no `google/gemini-3.1-flash-image` via OpenRouter:
> **US$ 0,471**, sete chamadas, medido pela diferença de saldo.

### Modelo 3D: onde a IA entra e onde não entra

| Caminho | Custo | Use para |
|---|---|---|
| Higgsfield MCP, `tripo_h3_1_image_to_3d` | 9 créditos | props e peças únicas: estátua, portão, altar |
| Higgsfield MCP, `meshy_v7_image_to_3d` com textura, PBR, rig e uma animação | 47,5 créditos | **um** personagem, provavelmente o chefe |
| Geometria por código | zero | arena, arquitetura, braseiros |
| Personagem CC0 riggado (Quaternius, KayKit, Mixamo) | zero | jogador e chefe **provisórios**, para desenvolver o combate |

O fluxo que funcionou: gere a imagem do chefe em pose A no ChatGPT ou no Gemini,
mande para o Meshy pelo MCP, e **desenvolva o combate inteiro com o CC0
provisório enquanto isso**.

### Animação: retarget no Blender, nunca em runtime

Aqui mora a armadilha mais cara do projeto. Detalhe na seção 8.

A regra: **asse as animações no esqueleto do modelo gerado, dentro do Blender em
modo headless, e exporte um GLB que já chega com os clipes prontos.** Retarget em
tempo de execução, copiando pose a cada frame, é lento, frágil e impossível de
depurar.

O script roda assim, e o agente executa sozinho:

```bash
blender --background --python scripts/blender/retarget_vharen.py
```

### Áudio

Três origens, e cada uma tem seu lugar:

1. **Sintetizado na Web Audio API** para todo efeito curto: passo, impacto, corte, exaustão, lock-on. Sai mais leve que qualquer amostra e responde a parâmetro.
2. **Amostra gravada** para o que a síntese não alcança. Baixe com `yt-dlp -x`, fatie por detecção de silêncio no ffmpeg, normalize o pico e escreva um `manifest.json`. O runtime sorteia uma amostra por golpe e **nunca repete a anterior**, que é o que mata a sensação de som barato numa sequência de três ataques.
3. **Modelo de música** para ambiente e stinger. No OpenRouter, `google/lyria-3-clip-preview` custa **US$ 0,04 por clipe de 30 s** e `google/lyria-3-pro-preview` **US$ 0,08 por música**.

**Lyria é modelo de música, não de efeito.** Ele não faz um passo nem um clique
de menu. Não tente.

Trilha do menu: se você tem um arquivo próprio, use. Foi o caso aqui. Comprimir
para AAC 48 kbps estéreo levou 1,45 MB para 1,06 MB, e AAC decodifica em todo
navegador, o que Opus em WebM não garante.

### Identidade visual

Logo, arte de capa, banner e fundo de menu saíram do ChatGPT. Pedidos
importantes: **peça sem tipografia** para o fundo do menu, porque a logo entra
desenhada por cima em HTML, e peça na proporção larga, 16:6 ou 8:3, para banner.

Comprima sempre. O banner foi de 2,0 MB para 166 KB em JPEG, e o fundo do menu de
1,95 MB para 65 KB em WebP, sem perda visível. Imagem escura com degradê largo é
onde JPEG cria faixa, então **olhe a imagem depois de comprimir**.

---

## 6. Como trabalhar com o agente

### Delegue em subagentes, com território

Três coisas rodaram em paralelo aqui: animação no Blender, biblioteca de
materiais e áudio. O que faz isso funcionar sem os agentes se atropelarem:

- **Dê território explícito.** "Estes arquivos são seus. Nestes você pode fazer edição cirúrgica e só de chamada. Nestes você não encosta."
- **Dê teto de dinheiro por tarefa**, menor que o teto do projeto.
- **Exija preço confirmado na API antes do primeiro centavo**, e gasto medido pela diferença de saldo no fim, nunca estimado.
- **Diga o que já existe**, para ele não refazer.
- **Exija verificação visual ou medida**, com o método escrito.

E uma que custou caro aprender: **se o agente vai testar áudio, mande ele medir
em `OfflineAudioContext` ou com `AnalyserNode` sem conectar ao `destination`.**
Dá para medir RMS sem sair um decibel no alto-falante. Um agente tocando som na
máquina de quem está trabalhando é motivo de briga.

### Peça número, não adjetivo

Compare os dois relatórios:

> "Melhorei o encadeamento dos golpes, ficou mais fluido."

> "A mão do personagem saltava 125 cm num quadro no meio do corte, contra um
> pico legítimo de 88 cm no auge do golpe. Depois da correção, o quadro de troca
> mede 36 cm e 20 cm."

O segundo é verificável e o primeiro não. Exija o segundo.

### Verifique visualmente, sempre

Toda mudança de renderização confirmada com screenshot do navegador integrado,
nunca com "deve funcionar". Guarde os screenshots por marco.

---

## 7. Verificação e deploy

Um truque que rendeu muito: um **plugin de Vite que recebe um POST com a imagem
e grava em `docs/screenshots/`**, mais um helper `window.shot('nome')` no jogo.
O agente tira o próprio screenshot de dentro do jogo, com o pós-processo
aplicado, sem depender de o painel do navegador estar visível.

Outro: um objeto de debug em `window.game` e um `window.perf()` que devolve fps,
frame time, draw calls, triângulos, estado e posição do jogador. É o que
transforma "está travando" em "14,64 ms de mediana com 159 mil triângulos".

Deploy: Cloudflare Workers apontado para o repositório, publicando a cada push.
Zero configuração no repositório e zero comando manual.

---

## 8. As armadilhas, que é o que ninguém conta

Todas medidas neste projeto. Cada uma custou horas.

### O `AnimationMixer` indexa a ação pelo clipe

Se o ataque leve e o pesado usam o mesmo clipe, pedir o clipe de novo devolve **a
mesma ação**, e `crossFadeFrom` precisa de duas ações diferentes para misturar.
Resultado: encadear um golpe no outro vira corte seco, com a mão saltando 125 cm
num quadro.

Solução: mantenha **duas instâncias por clipe**, a segunda criada sobre uma cópia
do clipe, que tem outro uuid, e alterne entre elas.

### O autostep do Rapier só entra se o deslocamento for mais horizontal que vertical

O personagem tinha um empurrão constante para baixo de 5 cm por tick, para manter
contato com o chão. Andando, ele avança 4,3 cm por tick. Vetor apontando 49 graus
para baixo, autostep nunca engata, e a escadaria vira parede. Só a esquiva subia,
porque é rápida o bastante para inverter a proporção.

Solução: o empurrão para baixo é **velocidade escalada pelo delta**, não um valor
fixo por tick. E quem cola o personagem na descida é `enableSnapToGround`, não ele.

### O buffer de comando precisa ser maior que a espera para usar o comando

O golpe leve dura 0,625 s e só aceita emenda a partir de 46% do clipe, ou seja
0,2875 s depois de começar. O buffer era de 0,28 s. O clique morria **7 ms antes
da janela abrir**. Martelando o botão, medimos 1,766 s seguidos de clique sem
resposta nenhuma.

Solução: buffer de 0,45 s, e **confira a estamina antes de consumir o comando**,
porque consumir apaga o clique do buffer mesmo quando o golpe não sai.

### O importador de glTF do Blender inventa a direção do osso

No glTF um osso é só um nó, sem comprimento nem direção. O Blender chuta. No
modelo gerado ele chutou o quadril apontando para o lado, e alinhar esse eixo com
o esqueleto fonte girava a pelve cem graus. Como as coxas saem do quadril por
deslocamento lateral, o giro jogava uma perna para cima e a outra para baixo.

Medido: pé esquerdo a 0,911 m do chão e direito a 0,339 m, com o clipe de idle
**parado**.

Solução: a direção do osso vem da cabeça dele para a cabeça do filho que continua
a cadeia, nunca da cauda inventada. E o rolamento vira quadro completo, não arco
mínimo, senão os filhos com deslocamento lateral saem torcidos.

### A cápsula de colisão não é o corpo

A cápsula do chefe tinha 1,05 m de raio e o corpo dele mede 0,74 m no ponto mais
largo. O jogador parava a 1,46 m do centro, ou seja 72 cm de ar antes de encostar,
e o contato virava parede invisível no meio do nada.

Solução: meça os ossos em mundo e ajuste. E **separe o raio de colisão do raio de
caixa de dano**, porque são coisas diferentes e amarrar um no outro faz o alcance
do combate mudar junto com o ajuste da física.

### Imagem de README em repositório privado pisca

Num repositório privado o GitHub não serve a imagem por endereço fixo: reescreve
o caminho relativo para uma URL assinada com token de vida curta. Página fresca
funciona, cache ou token vencido quebra.

Solução: sirva as imagens do README pelo **domínio público do deploy**, não pelo
caminho relativo do repositório. Endereço sem token não expira.

### Animar o painel inteiro do menu mostra o jogo por trás

O menu tinha a arte de fundo em pseudo-elementos. Animar a opacidade do painel
inteiro fazia a cena 3D aparecer atrás enquanto o fundo entrava.

Solução: o fundo entra cheio no primeiro quadro, e só o conteúdo por cima é que
tem transição escalonada.

### Meça a performance com uma aba só

Uma segunda página WebGPU aberta na mesma GPU inflou o frame time de 4,7 ms para
14,6 ms e quase virou uma caça a uma regressão que não existia.

---

## 9. O que isso custou de verdade

| Item | Custo medido |
|---|---|
| OpenRouter, projeto inteiro | **US$ 0,96** |
| das quais, as seis peças de material PBR | US$ 0,471 |
| das quais, os três clipes de trilha e stinger | cerca de US$ 0,16 |
| a rodada de calibragem de áudio | US$ 0,00, era medição, não material |
| Texturas de cenário, HDRI, personagem provisório e 46 animações | US$ 0,00, tudo CC0 |
| Higgsfield, chefe gerado com rig | 47,5 créditos |
| Hospedagem | US$ 0,00 |

Peso final dos assets: 19 MB, sendo 11 MB de textura, 4,1 MB de modelo, 2,5 MB
de áudio e 1,7 MB de HDRI. Teto que a gente se deu: 60 MB.

O gasto com IA generativa foi **menos de um dólar**. O que fez o jogo não foi
crédito, foi ordem de trabalho.

---

## 10. O prompt inicial, para copiar

Crie um `CLAUDE.md` na raiz e comece a primeira sessão com ele. Adapte:

> Você é o desenvolvedor principal e o artista técnico deste projeto. Eu sou o
> diretor: defino visão, aprovo e testo. Você faz o resto de ponta a ponta,
> código, geração de asset, iluminação, otimização, teste no navegador e deploy.
>
> Objetivo: **[descreva o jogo em duas frases, com uma referência de clima]**.
>
> Definição de pronto: **[lista, não adjetivo]**.
>
> Stack, não negociável sem conversa: **[sua stack, com o motivo de cada peça]**.
>
> Direção de arte: **[regras de luz, contraste, névoa e materiais, mais a paleta em hexadecimal]**.
>
> Orçamento técnico: **[triângulos, draw calls, textura, download, frame time, todos com número]**.
>
> Marcos: **[cinco ou seis, cada um terminando em screenshot, número de performance e commit]**. Não pule marco e não comece o seguinte sem minha aprovação.
>
> Regras de trabalho:
> - Verifique visualmente. Toda mudança de renderização é confirmada com screenshot do navegador, não com "deve funcionar".
> - Meça antes de otimizar e depois também. Sem número em `docs/perf.md`, o marco não fecha.
> - Registre toda decisão em `docs/decisions.md`, uma linha com data, decisão e motivo. Inclua os becos sem saída.
> - Nunca peça, cole ou logue chave de API. O `.env` está no `.gitignore` desde o primeiro commit.
> - Avise antes de gastar crédito, dizendo o modelo, o custo e o que vai sair.
> - Não invente fato sobre custo, crédito ou modelo. **Se não mediu, mede.**
>
> O que NÃO fazer: **[corte de escopo explícito]**.
>
> Primeira ação: leia este arquivo inteiro, liste em dez linhas o que entendeu e
> as dúvidas que sobraram, confirme comigo as decisões em aberto, e execute o M0.

---

## 11. A ordem em que eu faria de novo

1. Escrever o briefing. Uma hora aqui economiza um dia depois.
2. M0 e M1 com caixas. Testar o controle você mesmo. Só seguir se estiver bom.
3. Gerar a identidade visual no ChatGPT em paralelo, enquanto o combate anda.
4. M2, o look dev, e aprovar por screenshot.
5. M3 com kit por código e textura CC0.
6. M4, o combate inteiro, com personagem CC0 provisório.
7. Só agora gastar crédito: chefe gerado com rig, retarget assado no Blender.
8. Materiais por peça, e depois o som.
9. Deploy desde o M0, não no fim.
10. Narrativa por último, escrita **em cima do que o jogo já afirma**. Ela explica
    o que já está na tela em vez de pedir coisa nova, e aí a restrição técnica
    vira história: a altura do chefe vira o relógio da personagem, a telegrafia
    da armadura vira a contagem de uma pena, o laço de morte vira fato do mundo.

O jogo é o professor. Ele diz o que está errado se você medir.
