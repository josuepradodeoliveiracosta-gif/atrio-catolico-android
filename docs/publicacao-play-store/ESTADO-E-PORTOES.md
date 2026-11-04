# Google Play — trilha de publicação

**Não há declaração de que o app foi publicado.** Código na `main`, build e verificação em emulador não substituem o Play Console.

1. **Código integrado:** `main` com SHA conhecido e `versionCode` maior que o anterior.
2. **Testes:** Android, Firebase, segurança, moderação e privacidade conforme o escopo.
3. **Artefato:** AAB com assinatura e identidade verificadas; credenciais protegidas.
4. **Políticas:** UGC, termos, bloqueio, denúncia, dados coletados, privacidade, exclusão e retenção.
5. **Console:** faixa, upload, testes fechados e aprovação verificados.
6. **Aparelho:** instalação e comportamentos relevantes efetivamente testados.

Fontes: [Checklist](../checklist-seguranca-publicacao.md) · [Assinatura permanente](../../README_ASSINATURA_PERMANENTE.md) · [Status da versão](../../scripts/status_versao.py) · [PR #71 de homologação](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/pull/71).

**Não acionar** deploy Firebase/Workers, Play Store ou assinatura Android como efeito desta reorganização.

[Índice](../INDEX.md).
