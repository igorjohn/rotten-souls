# Decisões

Uma linha por decisão, com data e motivo. Inclui troca de asset e corte de escopo.

## 2026-09-08

- **Nomes definidos.** Chefe: Vharen, Vigília das Ruínas. Arena: Pátio das Cinzas. Escolha do Igor.
- **Arma do jogador: montante, sem escudo.** Escolha do Igor. Menos estados de animação que espada e escudo, telegrafia mais legível, defesa é rolar. Corta bloqueio e aparo do escopo de combate.
- **Three.js 0.185.1 com `WebGPURenderer`.** WebGPU confirmado funcionando no boot. Fallback pra WebGL2 implementado em `src/core/renderer.ts` via `forceWebGL`, com aviso discreto no canto.
- **`@types/three` 0.185.4 como dependência de desenvolvimento.** O pacote `three` não publica tipos próprios.
- **`HDRLoader` no lugar de `RGBELoader` e `Timer` no lugar de `Clock`.** Ambos depreciados na r185; trocados na primeira aparição pra não acumular dívida.
- **HDRI: `moonlit_golf_1k` do Poly Haven, CC0, 1,65 MB.** Céu noturno com lua, serve de luz ambiente fria e de reflexo. Vai ficar quase todo escondido pela névoa e pelos muros, então 1k basta.
- **Resolução adaptativa em `ResolutionGovernor`.** Se o frame passa de 15 ms por um segundo, encolhe a escala até 0,62 e devolve quando sobra folga. Segura os 60 fps sem mexer no look.
- **Agendador híbrido no `Loop` e piso de resolução no `applySize`, só em desenvolvimento.** O painel de preview roda a página como documento oculto: `requestAnimationFrame` não dispara e o `Timer` do Three zera o delta. Sem isso não dá pra verificar nada visualmente, que é regra da seção 8.
- **Endpoint `/__shot` no Vite, só em desenvolvimento.** Grava o canvas em `docs/screenshots` via `window.shot('nome')`. Todo marco fecha com imagem.
- **Geração de imagem no Gemini bloqueada.** A chave autentica (HTTP 200 em `models.list`) e os modelos `gemini-3.1-flash-image` e `gemini-3-pro-image-preview` existem, mas toda chamada de geração volta 429 com `limit: 0` no free tier, em todos os modelos de imagem. Não é rate limit passageiro, é ausência de cota: exige faturamento ativo no projeto do Google Cloud. Concept art fica pendente. Não bloqueia M0 a M2, que são gray box e look dev.

## 2026-09-08, M1

- **Física com Rapier e `KinematicCharacterController`.** Cápsula de 1,85 m por 0,36 m de raio. Passo fixo de 1/60 com acumulador, pra combate previsível independente do fps.
- **Nada de gravidade empurrando pra baixo quem já está no chão.** O controlador do Rapier zera todo o movimento horizontal quando a cápsula está penetrando o colisor, e um milímetro de penetração trava o personagem pra sempre. No chão o movimento vertical vira um empurrão de 2 cm pra cima e o `snapToGround` devolve o contato no mesmo frame. Custou uma sessão inteira de depuração; está registrado pra não voltar.
- **Offset do controlador em 0,05 em vez de 0,02.** Margem maior contra o mesmo problema de penetração.
- **O piso vai até embaixo do muro, não até o raio jogável.** Antes sobrava um anel vazio de 1,4 m entre a borda do piso e a face interna da parede, e dava pra cair por ele correndo de lado.
- **Relógio de `MessageChannel` em desenvolvimento.** O Chrome estrangula `setTimeout` pra um por segundo em documento oculto, e o painel de preview trata a página assim. Com `setTimeout` o jogo rodava a 1 fps, o `dt` batia no teto de 1/20 e a física se comportava de um jeito que não acontece de verdade.
- **`renderer.info.autoReset` desligado e média por delta.** O contador do WebGPU é preenchido depois do render assíncrono; zerar antes de desenhar lia frame incompleto e não zerar lia soma de frames.
- **Medidas de movimento:** andar 2,6 m/s, correr 5,6 m/s, deslize com lock-on 2,9 e 4,9 m/s. Esquiva de 0,62 s com pico de 11,5 m/s, invencibilidade de 0,06 s a 0,42 s, custo de 25 de estamina. Estamina de 100, regeneração de 26 por segundo com atraso de 0,55 s, ou 1,2 s se zerou. Corrida drena 12 por segundo.
- **Câmera de ombro com corte por raio.** Distância base 4,3 m, 5,4 m com lock-on. Um raio do pivô até a posição desejada corta a distância quando tem parede no meio, com mínimo de 1,5 m. Com lock-on o ombro abre pra 1,05 m, senão o jogador tapa o alvo.
- **Alvo provisório de lock-on:** um cilindro no lugar de Vharen, pra desenvolver a câmera antes de existir chefe.

## 2026-09-08, M2

- **Pós-processo em TSL com `PostProcessing`.** Passe de cena com MRT de cor e normal, oclusão de ambiente por GTAO em meia resolução, bloom largo e de limiar alto, tonemapping explícito, grading, vinheta e grão. Em WebGL2 a oclusão sai, que é a parte cara; o resto continua.
- **`beginFrame` tocando o relógio dos nós à mão.** O `nodeFrame.frameId` do Three só avança dentro do loop de animação do renderer, e este projeto tem loop próprio. Sem isso, todo nó de update por frame roda uma única vez na vida: imagem congelada no primeiro frame, bloom e oclusão nunca recalculando, e `time` do TSL parado, o que deixava chama e faísca imóveis. Foi o bug mais caro do dia.
- **`GTAONode` lido por `getTextureNode().r`.** Usar o nó direto entrega o resultado do setup, não a textura de canal único que ele desenha, e a cena inteira ia a quase zero. Sintoma: tudo vermelho, só a luz de fogo sobrevivendo.
- **Grão e vinheta depois do tonemapping.** `outputColorTransform` desligado e `renderOutput` chamado no meio da cadeia. Antes, o grão era somado em espaço linear e explodia nas sombras; e o `clamp(0,1)` antes do tonemapping matava o alcance dinâmico do fogo.
- **Chama e faísca por atributo de instância, não por matriz.** `SpriteNodeMaterial` num `InstancedMesh` ignora a matriz de instância, porque o sprite se orienta pra câmera em espaço de visão. Todas as 28 chamas empilhavam na origem do mundo. A posição agora vem de um atributo lido pelo `positionNode`, e a escala vem do `scaleNode`.
- **Faísca animada inteiramente na GPU.** Origem, deriva e fase são atributos estáticos; a vida sai de `fract(time)`. Zero trabalho de CPU por frame para 140 faíscas.
- **Nunca chamar `material.needsUpdate` em material de nós durante o look dev.** Trava a reconstrução do shader e congela o render. Custou uma rodada inteira de diagnóstico falso.
- **Captura de tela por alvo de render, não pelo canvas.** Num canvas de WebGPU o primeiro `toDataURL` congela o conteúdo devolvido e toda captura seguinte repete a primeira imagem. O frame é redesenhado num alvo próprio e os pixels são lidos de lá, o que pode ser repetido à vontade.
- **Valores de look aprovados:** exposição 1,32, lua 0,78, ambiente do HDRI 0,10, névoa de distância 0,0115, névoa de chão 0,042 até 2,4 m, cor da névoa `#131c29`, bloom 0,42 com raio 0,85 e limiar 0,62, oclusão 0,8, vinheta 0,8, grão 0,028. Chão com rugosidade 0,45 e metalicidade 0,1, pra devolver o fogo como poça.
- **Painel de look dev em `F4`.** Sliders sem dependência externa, ligados direto nos uniforms do TSL.

## 2026-09-08, M3

- **Arena escolhida: A, anel preservado.** Escolha do Igor entre os três concepts. É quase exatamente a planta que o gray box já tinha, então o M3 virou troca de forma sem mexer no jogo.
- **Chefe escolhido: Vharen A, cavaleiro de brasa.** Escolha do Igor. A imagem já saiu em vista frontal quase em pose A, que é o ideal pra entrada do image-to-3D.
- **Texturas CC0 do ambientCG,** baixadas por `scripts/fetch-textures.mjs`: `Tiles130` no piso, `Bricks089` em muro e arcada, `PavingStones131` em degraus e parapeito, `Metal063` nos ferros, `Rock064` nos escombros. Cinco materiais com cor, normal, rugosidade e oclusão.
- **KTX2 fora por ora.** O codificador do KTX-Software não está instalado nesta máquina e não existe formula do Homebrew pra ele. O `optimize-assets.sh` recomprime JPEG em vez disso, com qualidade diferente por tipo de mapa: normal aguenta menos compressão, porque artefato de JPEG em mapa de normal vira relevo falso. Resultado: 16 MB viraram 4,9 MB. Quando o `toktx` entrar na máquina, o script ganha a etapa e o ganho é de VRAM, não de download.
- **UV em metros, não por peça.** Toda geometria do kit reescreve o UV em unidades de mundo, incluindo as faces de caixa, que no Three saem de 0 a 1 por face. Sem isso a mesma pedra estica num muro de nove metros e encolhe num degrau.
- **Arco ogival equilátero por `ExtrudeGeometry` com furo.** Dois arcos de raio igual à largura do vão, cada um centrado no pé oposto. O painel arruinado é o mesmo vão com o topo em linha quebrada e um arco mais baixo por baixo.
- **Escadaria passou pra fora do anel da arcada.** Antes começava dentro dele e enterrava a base do portão de névoa nos degraus.
- **Braseiros de raio 16,4 para 19,6.** Encostados na arcada eles acendem os arcos, que é o que faz a arquitetura ser lida. No centro da arena eles não alcançavam a parede.
- **Colisão da arcada só nos pés de cada vão.** O vazado do arco fica passável e quem entra nele esbarra no muro externo logo atrás, o que dá profundidade sem parede invisível.
- **Simulação do jogador dentro do passo fixo da física.** Era um bug do M1 que só apareceu agora: um corpo cinemático só anda quando o mundo dá um passo, e o passo é fixo em 60 Hz. Calcular o deslocamento por frame fazia o jogo andar mais devagar quanto maior o fps, porque cada passo aplicava só o último alvo agendado. A 130 fps o jogador andava a 1,65 m/s em vez de 2,6. Agora `Physics.step` recebe um retorno de chamada que roda uma vez por passo fixo.
- **Contato com o chão por empurrão curto pra baixo, com recuperação só quando trava.** O empurrão constante pra cima do M1 fazia a cápsula subir de frame em frame até flutuar 11 cm do chão, e aí o movimento passava a ser tratado como queda. Agora o normal é um contato de 5 cm pra baixo, e o empurrão pra cima só entra no frame seguinte a um travamento detectado, que é quando o movimento pedido no plano não sai do lugar.
- **Leitura de captura respeita o alinhamento de linha do WebGPU.** A largura do buffer é arredondada pra cima até um múltiplo de 64 pixels, então copiar o buffer inteiro de uma vez corta a imagem em diagonal.

## 2026-09-08, M4

- **Personagens provisórios: Universal Animation Library do Quaternius, CC0.** 46 clipes num esqueleto humanoide de 1,83 m, incluindo `Sword_Attack`, `Roll`, `Hit_Chest` e `Death01`, que é exatamente o conjunto que um Souls precisa. Baixada do espelho em glTF no GitHub, porque o site original entrega por itch.io e não dá pra roteirizar.
- **O mesmo arquivo serve de jogador e de chefe.** `SkeletonUtils.clone` copia malha e esqueleto sem recarregar nada, e a escala faz o resto: 1,0 pro jogador, 2,53 pro Vharen, que dá 4,62 m, ou seja duas vezes e meia o jogador, como manda a seção 3.
- **`gltf-transform optimize --compress meshopt`**, 4,05 MB para 1,82 MB com os 46 clipes preservados. Meshopt em vez de Draco porque comprime também as faixas de animação, que aqui são a maior parte do arquivo.
- **Janela de dano em fração do clipe, não em segundos.** É o que faz o ataque pesado ser o mesmo clipe mais lento sem sair de sincronia com a animação.
- **Caixa de golpe é uma esfera à frente de quem ataca, na altura do peito.** Num slice de arena com um chefe, caixa por osso não muda a sensação e custa muito mais.
- **Poise no chefe:** ele só cambaleia depois de acumular 62 de dano. Sem isso o Vharen vira saco de pancada e o combate perde a conversa.
- **Vida do chefe em 420.** Golpe leve tira 17 e pesado 34, então dá por volta de 18 a 20 golpes bem colocados. Comecei com 900, que dava 53 golpes só de leve, e a luta virava repetição.
- **Três golpes com telegrafia diferente:** corte alto lento e forte, varredura média que pega os lados, estocada rápida com avanço longo que castiga quem fica de longe curando distância. Na segunda fase os clipes rodam 28% mais rápido, o dano sobe 20%, o intervalo entre golpes cai pela metade e a chance de emenda vai de 18% para 55%.
- **Nomes de osso perdem o ponto no carregador do Three.** `DEF-hand.R` chega como `DEF-handR`, e por isso a arma não prendia na mão. O código aceita as duas formas.
- **HUD trocou `requestAnimationFrame` por reflow forçado.** As telas de morte e de vitória usam uma transição de CSS que precisa de um quadro entre tirar o `display:none` e adicionar a classe. Com `requestAnimationFrame` isso não acontece em documento oculto e as telas nunca apareciam. Um `void element.offsetWidth` resolve de forma síncrona e sempre.
- **Bloqueio segue fora do escopo,** consequência da escolha de montante sem escudo lá no M1. A defesa é rolar.

## 2026-09-08, M5

- **Áudio inteiro sintetizado na Web Audio API, nenhum arquivo de som no bundle.** Som de arena escura é vento, passo em pedra, corte no ar, impacto e um bordão grave, e tudo isso é ruído filtrado e oscilador com envelope. Sai mais leve que qualquer amostra comprimida, não tem licença pra rastrear, e responde a parâmetro: o mesmo gerador de passo faz andar seco e correr pesado só mudando um número, sem precisar de uma gravação pra cada caso.
- **Música do chefe é bordão, não melodia.** Ré e Lá numa quinta aberta, quatro serras levemente desafinadas passando por filtro grave, e um tambor a cada dois segundos e meio fora do quadrado. Melodia cansa em cinco minutos de luta; bordão não.
- **Passo por distância percorrida, não por tempo.** A passada acompanha a velocidade sozinha, sem precisar de evento dentro da animação.
- **Cutscene de entrada em 4,2 segundos.** A câmera sai de trás do jogador, sobe e corre até enquadrar Vharen de baixo, que é o ângulo que faz ele parecer grande. O controle fica desligado até o fim e só então o nome e a barra entram. A câmera volta pro ombro a partir de onde parou, sem corte seco.
- **Brasa do chefe acende na segunda fase,** de 2,6 para 5,4 de intensidade emissiva. É a leitura mais barata e mais clara de que a luta mudou, e por ser emissiva o bloom pega: dá pra ver do outro lado da arena.
- **Verificação de áudio por medição, não por suposição.** Um `AnalyserNode` nos barramentos mede o RMS do sinal real. Sem isso não dava pra afirmar que o som existe, já que a sessão de desenvolvimento não tem alto-falante.

## Escopo que ficou de fora, e por quê

- **Link público.** Decisão do Igor de deixar pra depois. O critério do M0 segue pendente.
- **Props do Tripo, 2 a 4 no M3.** Não cabe no saldo. Sobraram 56 créditos na Higgsfield; o Meshy com rig custa 47,5 e cada prop do Tripo custa 9. Ou o chefe definitivo ou os props. Reservei o saldo pro chefe, que é o centro do slice, e a arquitetura por código já entrega bem sem eles.
- **Chefe definitivo gerado e riggado, com retarget.** Depende da decisão de gastar os 47,5 créditos. O Vharen atual é o mannequim CC0 escalado com material de brasa, que funciona mas não é o cavaleiro do concept.
- **Texturas em KTX2.** O codificador do KTX-Software não está instalado nesta máquina e não há formula do Homebrew pra ele. O ganho seria de VRAM, não de download, e o download já está em 9,54 MB contra teto de 60.
- **Bloqueio e aparo.** Cortados lá no M1 pela escolha de montante sem escudo. A defesa é rolar.

## 2026-09-08, correção reportada pelo Igor

- **A e D estavam invertidos desde o M1.** O vetor "direita" da câmera estava com o sinal trocado: `getRight` devolvia `(cos yaw, 0, -sin yaw)`, que é a esquerda. A direita é `frente cruzado com cima`, e num sistema destro com Y pra cima isso dá `(-cos yaw, 0, sin yaw)`. Conferido de três formas: pela álgebra do produto vetorial, medindo o deslocamento com a tecla pressionada, e projetando o vetor na tela pra ver em que metade ele cai. O erro também deslocava a câmera pro ombro errado, então a composição mudou junto.

## 2026-09-08, balanceamento depois do Igor jogar

Reclamação: "eu dou hit no boss mas eu perco vida muito fácil".

- **Perseguição durante o golpe de 1,1 para 0,5 rad/s.** Era a causa principal, e não o dano. Num golpe de um segundo ele girava 63 graus atrás do jogador, então rolar pro lado não saía do caminho: ele acompanhava o rolamento. Agora a esquiva compensa a leitura, que é o contrato do gênero.
- **Dano do chefe pra baixo:** corte alto de 32 para 24, varredura de 24 para 18, estocada de 21 para 16. Multiplicador da segunda fase de 1,2 para 1,15. O corte alto matava em 4 golpes na primeira fase e 3 na segunda; agora são 5 e 4.
- **Invencibilidade do rolamento de 0,36 s para 0,44 s**, dentro dos mesmos 0,62 s de animação. Generoso de propósito: o chefe é grande e os golpes são largos.
- **Folga depois de apanhar de 0,30 s para 0,55 s,** pra emenda de golpes não matar em cadeia.
- **Intervalo entre golpes** de 1,5-2,4 s para 1,9-2,9 s na primeira fase, e de 0,75-1,35 s para 1,15-1,85 s na segunda. Chance de emenda na segunda fase de 55% para 38%. É o que cria a janela de punição.
- **Avanço da estocada de 7,5 para 5,4 m/s e alcance de 4,6 para 4,2 m.** Ela alcançava de longe demais pra ser lida a tempo.

## 2026-09-08, segunda rodada de jogabilidade

Reclamações do Igor jogando: o chefe parece se defender, a vida some fácil
demais, não existe correr, e a esquiva e o ataque parecem peso morto.

Medi as durações dos clipes no glTF antes de mexer em qualquer coisa:
`Sword_Attack` 1,50 s, `Roll` 1,46 s, `Sprint_Loop` 0,67 s.

- **Golpe leve de 1,07 s para 0,63 s** (velocidade 1,4 para 2,4) e **pesado de
  1,92 s para 1,11 s** (0,78 para 1,35). Um ataque leve de Souls fica na casa
  dos 0,6 s; 1,07 s é peso morto, e a reclamação estava certa.
- **A esquiva passou a caber no clipe.** O estado durava 0,62 s enquanto a
  animação de 1,46 s rodava a 1,61x, ou seja terminava no meio e o personagem
  dava um solavanco de volta pro idle. Agora o estado dura 0,52 s e o clipe roda
  na velocidade exata pra caber, 2,81x. Alcance do rolamento subiu de 11,5 pra
  13,5 m/s de pico pra compensar o tempo menor.
- **Poise do chefe de 62 para 34.** Ele atravessava os golpes sem reagir, o que
  se lê como "ele está se defendendo". Agora um pesado sozinho, ou dois leves,
  interrompem.
- **Vida do jogador de 100 para 130 e estamina de 100 para 110.** Junto com o
  dano do chefe mais baixo, o corte alto passou de 5 pra 6 golpes até matar.
- **Alcance e avanço dos golpes do jogador maiores** (leve de 1,9 pra 2,1 m,
  pesado de 2,3 pra 2,5 m), porque com o golpe mais rápido dá menos tempo de
  se posicionar. Recuperação depois do golpe menor: 0,12 pra 0,08 no leve e
  0,30 pra 0,18 no pesado.
- **Correr com a mira travada agora corre de verdade.** Existia desde o M1, mas
  com lock-on o personagem só deslizava de lado um pouco mais rápido, que não
  parece correr. Agora segurar Shift solta o deslize e vira o corpo pra direção
  do movimento, como em Souls.
- **O gamepad não sobrescreve mais o Shift do teclado.** `readGamepad` atribuía
  `running` direto, então com um controle conectado o Shift direito era ignorado.
- **Telegrafia por brasa.** A brasa do Vharen carrega durante a preparação do
  golpe e estoura no impacto. Sem um aviso que não seja a própria animação, um
  chefe grande com golpe largo vira sorte.
