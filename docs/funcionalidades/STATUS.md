# Módulos e situação — catálogo de fontes

A presença de código na `main` comprova apenas **código integrado**; não prova que o serviço está implantado ou que determinada versão foi instalada no celular.

| Módulo | Fonte principal | Como classificar |
| --- | --- | --- |
| Android, autenticação e comunidade | [`app/`](../../app/), [README](../../README.md) | Código na `main`; funcionamento real requer verificação no aparelho |
| Perfil, fotos e avatares | [Perfil](../perfil-modernizacao.md), [Avatar Worker](../../cloudflare/avatar-worker/) | Código e guias; implantação externa não inferida |
| Selos, clero e cargos | [Selos](../selos-seguranca.md), [revisão do clero](../revisao-clero-v0140.md) | Código/documentação; cargos dependem de autorização |
| Reações e participação | [Engajamento](../engajamento-0193.md), [reações](../reacoes-emojis.md) | Código documentado; teste no dispositivo é distinto |
| Central de notificações / FCM | [Central](../notificacoes-v0160.md), [FCM](../push-fcm-v0170.md), [background](../avisos-background-v0180.md) | Componentes presentes; push real requer comprovação |
| Átrio Guardião V1/V2 | [Guia](../atrio-guardiao.md), [integração segura](../guardiao-v2-android-integracao-segura.md) | Candidatos e QA não são equivalentes a deploy |
| Bots de teste e QA | [Bots](../bots-de-teste.md), [QA](../qa-android-autenticado.md) | Testes com perfis sintéticos |
| Exclusão de contas | [PR #71](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/pull/71) | **Em homologação isolada; contas reais não autorizadas** |
| Play Store e distribuição | [Checklist](../checklist-seguranca-publicacao.md) | Preparação; publicação não deve ser presumida |

## Registro de status verificável

Em cada atualização, anotar: **módulo · branch/SHA · ambiente · resultado observado · evidência · limitações · situação**. Quando a fonte não permitir verificar, usar `Não verificado`, jamais `Publicado`.

[Índice](../INDEX.md).
