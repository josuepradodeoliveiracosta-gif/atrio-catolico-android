# Abertura eucarística — GIF convertido para MP4

Mídia eucarística enviada e identificada pelo blob esperado. A implementação experimental do decodificador GIF foi revertida para reaproveitar o VideoView original. A integração depende dos checks e da revisão.

## Mídia candidata

- Destino: `app/src/main/res/raw/abertura_atrio.mp4`.
- Fonte: GIF eucarístico escolhido pelo fundador (305 × 553 px, nove quadros).
- MP4 H.264, 1080 × 1920, yuv420p, 50 fps, 1,62 s, sem faixa de áudio, 830469 bytes.
- SHA-256: `5b264941084b175687fc0ad0100903cd73d50b968d541c184964e3bb24d7a53c`.
- Git blob SHA-1: `e6a37c04c5bb552a6d7f209889d949a66c3ec35c`.
- Conversão mantém a composição com ampliação e recorte central mínimo. A barra desenhada indica o andamento da animação, não o carregamento real do Firebase.

## Validação obrigatória antes de integrar

- [x] Novo MP4 enviado com o blob esperado; confirmar o caminho no head da PR.
- [ ] Compilar e executar os testes existentes de abertura.
- [ ] Conferir tela 9:16 e 20:9, modo offline, Pular, Voltar, pausa/retorno e restauração das barras.
- [ ] Conferir abertura em aparelho Android, sem áudio e sem regressão na autenticação.
- [ ] Atualizar a documentação histórica da abertura e integrar somente após revisão e CI.

Sem alteração de versão, assinatura ou backend nesta preparação.
