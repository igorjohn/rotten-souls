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
