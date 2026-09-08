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
