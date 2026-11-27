# Abertura eucarística em GIF

Proposta em rascunho. Não integrar antes da inclusão e verificação do GIF original, compilação e testes. O MP4 foi retirado somente na branch de trabalho.

## Asset obrigatório
- Caminho: `app/src/main/res/raw/abertura_atrio.gif`.
- GIF selecionado pelo fundador: 305 × 553 px, 9 quadros de 180 ms (1,62 s), 689.680 bytes.
- SHA-256: `b5742a1246efa7603cf0dd3c79b683ee2c189076d0d186769249737e49be4a7a`.
- Git blob SHA-1: `2cb91cf8a1da3303029d3be0cb537ad1bec053cf`.
- Não usar o spritesheet nem converter para outro formato. O recurso ausente impede a compilação intencionalmente.

## Comportamento
Abertura offline, sem áudio, uma passagem do GIF. Preserva a preferência anterior e o botão Pular para quem já concluiu a abertura. Em telas com proporções muito diferentes preserva a composição com fundo azul escuro, sem cortar título ou barra. A barra desenhada no GIF indica o andamento da animação, não o progresso real do Firebase. Sem mudança de versão, assinatura, backend ou publicação.

## Homologação
- [ ] Conferir blob do GIF exato e ausência do MP4.
- [ ] Compilar e executar testes de abertura, incluindo API 26/27 e API recente.
- [ ] Conferir primeira abertura, Pular, Voltar, pausa/retorno, falha de decodificação e restauração das barras.
- [ ] Conferir resolução e legibilidade em telas 9:16 e 20:9, autenticação e demo offline.
- [ ] Integrar somente após checks e revisão.
