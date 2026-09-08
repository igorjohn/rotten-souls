# Perf

Regra da seção 4 do briefing: sem número aqui, o marco não fecha.

Como medir: rodar `pnpm dev`, abrir o jogo, apertar `F3` pro painel, ou chamar
`window.perf()` no console em modo de desenvolvimento.

## Orçamento (limites duros)

| Item | Limite |
|---|---|
| Download inicial | 60 MB, meta 40 MB |
| Triângulos por frame | 1 500 000 |
| Draw calls por frame | 300 |
| Frame time | 16 ms em M-series a 1080p |
| Luzes com sombra em tempo real | 1 |

## M0, setup

Data: 2026-09-08
Máquina: Mac M-series, navegador embutido do Claude Code
Backend: **WebGPU** confirmado no boot (`[boot] backend webgpu`)
Resolução do buffer: 1600x900 com pixel ratio 1,5, ou seja 2400x1350

| Métrica | Valor | Limite | Situação |
|---|---|---|---|
| Frame time | 7,01 ms | 16 ms | dentro |
| Draw calls | 28 | 300 | dentro |
| Triângulos | 21 907 | 1 500 000 | dentro |
| Escala de resolução | 1,00 | mínimo 0,62 | sem redução |
| Download de asset | 1,65 MB (HDRI 1k) | 60 MB | dentro |

Ressalva honesta: o painel de preview roda a página como documento oculto, então
o `requestAnimationFrame` não dispara e o loop cai num agendador de `setTimeout`
de 16 ms. Por isso o **fps medido ali não vale** (aparece por volta de 20, é a
cadência do timer, não o custo do frame). O número que vale é o **frame time**,
que mede trabalho real de CPU mais submissão de GPU. Os 28 draw calls e os 21 907
triângulos numa cena "vazia" são do fundo equiretangular e do pré-filtro de
ambiente do HDRI.

Medição definitiva de fps fica pra quando houver build publicado, aberto numa
janela de navegador de verdade.

## M1, gray box jogável

Data: 2026-09-08
Máquina: Mac M-series, navegador embutido do Claude Code
Backend: WebGPU
Resolução do buffer: 1600x900 com pixel ratio 1,5, ou seja 2400x1350
Cena: arena completa em gray box, jogador na arena com lock-on ativo

| Métrica | Valor | Limite | Situação |
|---|---|---|---|
| Frame time | 6,76 ms | 16 ms | 42% do orçamento |
| Draw calls | 10 | 300 | 3% do orçamento |
| Triângulos | 3 185 | 1 500 000 | 0,2% do orçamento |
| Luzes com sombra | 1 (a lua) | 1 | no limite |
| Luzes sem sombra | 14 braseiros | sem limite | ok |
| Escala de resolução | 1,00 | mínimo 0,62 | sem redução |
| Download de asset | 1,65 MB | 60 MB | 3% do orçamento |

Os 10 draw calls saem do uso de `InstancedMesh` no muro, nos pilares e na
escadaria: 28 blocos de muro custam uma chamada, não 28. É folga que vai ser
gasta no M3, quando entrar o kit modular com textura, e no M4, com o chefe.

Sobre a medição: `renderer.info.autoReset` está desligado e o painel calcula a
média por frame a partir do delta acumulado na janela. O contador do WebGPU é
preenchido depois do render, que é assíncrono, então zerar antes de desenhar
leria sempre um frame incompleto. Sem esse cuidado o número saía 138 vezes maior.

O fps de 143 medido aqui roda num relógio de `MessageChannel`, não no
`requestAnimationFrame`, porque o painel de preview trata a página como
documento oculto. Serve pra comparar entre marcos, mas o fps definitivo continua
pendente de um build aberto numa janela de navegador de verdade.

## M2, look dev

Data: 2026-09-08
Máquina: Mac M-series, navegador embutido do Claude Code
Backend: WebGPU
Resolução do buffer: 1600x900 com pixel ratio 1,5, ou seja 2400x1350
Cena: arena em gray box, jogador dentro, lock-on ativo, pós-processo completo

| Métrica | Valor | Limite | Situação |
|---|---|---|---|
| Frame time | 6,25 ms | 16 ms | 39% do orçamento |
| Draw calls | 41 | 300 | 14% do orçamento |
| Triângulos | 6 186 | 1 500 000 | 0,4% do orçamento |
| Luzes com sombra | 1 (a lua) | 1 | no limite |
| Luzes sem sombra | 14 braseiros | sem limite | ok |
| Escala de resolução | 1,00 | mínimo 0,62 | sem redução |

Comparando com o M1: o frame ficou **mais rápido** (6,25 contra 6,76 ms) mesmo
com bloom, oclusão de ambiente, névoa em camadas, tonemapping explícito, grão e
vinheta por cima. O motivo está na seção seguinte, e não é mágica: no M1 os nós
por frame nunca atualizavam, então parte do custo simplesmente não existia. O
número do M1 estava otimista; o do M2 é o real.

Os 41 draw calls incluem tudo: passe de sombra da lua, passe de cena com MRT de
cor e normal, o alvo de meia resolução da oclusão, as passagens de bloom e o
quadro final. Chama e faísca de todos os braseiros custam duas chamadas no
total, porque são malha instanciada com posição por atributo.

### Como a medição foi consertada

O relógio interno do sistema de nós do Three (`nodeFrame.frameId`) só avança
dentro do loop de animação do próprio renderer. Este projeto tem loop próprio,
então o relógio ficava parado em 1 pra sempre. Consequências, todas verificadas:
o passe de cena renderizava uma vez e congelava, a imagem parava de atualizar,
bloom e oclusão nunca recalculavam e o `time` do TSL ficava zerado, deixando
chama e faísca imóveis. O `beginFrame` em `src/core/renderer.ts` agora avança
esse relógio e zera os contadores uma vez por frame, o que também tornou a
leitura de perf direta: no fim do frame os contadores já são o total do frame.

## M3, arena de verdade

Data: 2026-09-08
Máquina: Mac M-series, navegador embutido do Claude Code
Backend: WebGPU
Resolução do buffer: 1752x985 com pixel ratio 1,5
Cena: arena completa com kit modular texturizado, jogador dentro

| Métrica | Valor | Limite | Situação |
|---|---|---|---|
| Frame time | 7,45 ms | 16 ms | 47% do orçamento |
| Draw calls | 56 | 300 | 19% do orçamento |
| Triângulos | 14 200 | 1 500 000 | 0,9% do orçamento |
| Luzes com sombra | 1 (a lua) | 1 | no limite |
| Escala de resolução | 1,00 | mínimo 0,62 | sem redução |

### Download

`pnpm build` gera 13 MB em disco, mas o que o navegador realmente baixa pra
abrir o jogo é menor, porque parte dos pedaços nunca é pedida:

| Parte | Tamanho na rede |
|---|---|
| Texturas, 5 materiais PBR com 4 mapas cada | 5,5 MB |
| HDRI do céu noturno | 1,65 MB |
| Rapier, comprimido | 1,08 MB |
| Código do jogo, comprimido | 254 KB |
| Three.js, comprimido | 70 KB |
| **Total inicial** | **cerca de 8,6 MB** |

Contra um teto de 60 MB e uma meta de 40 MB, sobra muita folga. Os pedaços do
Draco e do Basis aparecem no `dist` mas não são baixados: o decodificador é
apontado pra CDN e nenhum asset do projeto usa esses formatos ainda.

### Como o frame caiu de 17,6 ms para 7,45 ms

A primeira versão do M3 rodava a 17,58 ms **já com a resolução reduzida a 0,72**
pelo governador automático, ou seja bem pior que o número cru sugere. O que
resolveu, em ordem de impacto:

1. **Muro externo deixou de lançar sombra.** São 36 blocos que saíram do passe
   de sombra de uma vez. Nada fica atrás deles, então a sombra não pagava nada.
2. **Mapa de sombra de 2048 para 1536 e câmera de sombra apertada** de ±34 para
   ±27, que é o raio real da arena. Antes metade da resolução do mapa caía fora.
3. **Oclusão de ambiente de 16 para 10 amostras**, mantida em meia resolução.
4. **Anisotropia de 8 para 4**, que num chão em ângulo raso não muda o que se vê.
5. **Escombro e parapeito sem sombra própria**, por serem pequenos e escuros.

## M4, combate e chefe

Data: 2026-09-08
Máquina: Mac M-series, navegador embutido do Claude Code
Backend: WebGPU
Cena: arena completa, jogador e Vharen animados, lock-on ativo, chefe atacando

| Métrica | Valor | Limite | Situação |
|---|---|---|---|
| Frame time, média de 400 quadros | 5,09 ms | 16 ms | 32% do orçamento |
| Frame time, pior quadro | 5,19 ms | 16 ms | sem picos |
| Draw calls | 88 | 300 | 29% do orçamento |
| Triângulos | 71 566 | 1 500 000 | 4,8% do orçamento |
| Luzes com sombra | 1 (a lua) | 1 | no limite |
| Escala de resolução | 1,00 | mínimo 0,62 | sem redução |

Os dois personagens somam 57 mil triângulos e 32 draw calls a mais que o M3,
porque cada um é uma malha com pele desenhada duas vezes, uma pro passe de
sombra e outra pro passe de cena. A variação entre o pior e o melhor quadro é de
0,10 ms, ou seja o custo de animação e de IA não aparece no gráfico.

### Download

O personagem CC0 acrescenta 1,82 MB, já com Meshopt. Total inicial passa de
8,6 MB para **10,4 MB**, contra teto de 60 MB e meta de 40 MB.

## M5, som, cutscene e polimento

Data: 2026-09-08
Máquina: Mac M-series, navegador embutido do Claude Code
Backend: WebGPU
Cena: luta em andamento, áudio tocando, chefe na segunda fase

| Métrica | Valor | Limite | Situação |
|---|---|---|---|
| Frame time, média de 500 quadros | 7,68 ms | 16 ms | 48% do orçamento |
| Frame time, percentil 95 | 7,81 ms | 16 ms | sem picos |
| Frame time, pior quadro | 7,81 ms | 16 ms | variação de 0,13 ms |
| Draw calls | 75 | 300 | 25% do orçamento |
| Triângulos | 69 637 | 1 500 000 | 4,6% do orçamento |
| Luzes com sombra | 1 (a lua) | 1 | no limite |
| Escala de resolução | 1,00 | mínimo 0,62 | sem redução |

O áudio não aparece no frame time porque a Web Audio API roda no próprio fio de
áudio do navegador. Todos os sons são sintetizados, então o custo de CPU é de
alguns osciladores e filtros por evento, e o custo de download é zero.

### Download final

| Parte | Tamanho na rede |
|---|---|
| Texturas, 5 materiais PBR com 4 mapas cada | 4,89 MB |
| Personagem CC0 com 46 animações, Meshopt | 1,74 MB |
| HDRI do céu noturno | 1,65 MB |
| Rapier, comprimido | 1,03 MB |
| Código do jogo, comprimido | 0,25 MB |
| Three.js, comprimido | 0,07 MB |
| **Total** | **9,54 MB** |

Contra teto de 60 MB e meta de 40 MB. Numa conexão de 10 Mbps isso abre em
cerca de 8 segundos, dentro dos 15 que a definição de pronto pede. Falta medir
isso numa conexão real, o que só dá pra fazer com o link publicado.

Os decodificadores do Draco e do Basis estão no `dist` mas não entram na conta:
o caminho do decodificador aponta pra CDN e nenhum asset do projeto usa esses
formatos. Se o KTX2 entrar, o Basis passa a ser baixado, mais 248 KB, e as
texturas caem bem mais que isso.

### Medição de áudio

Feita com um `AnalyserNode` ligado nos barramentos, medindo RMS do sinal real:

| Situação | RMS |
|---|---|
| Só o vento ambiente | 0,080 |
| Com a música do chefe | 0,111 |
| Passo por cima da música | 0,115 |
| Depois de parar a música | 0,089 |
