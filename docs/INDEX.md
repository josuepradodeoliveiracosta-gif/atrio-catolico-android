# Central do projeto — Átrio Católico

O índice é a **porta de entrada única** para conhecer os módulos, entender o progresso e localizar a documentação sem alterar o código existente.

| Necessidade | Abrir |
| --- | --- |
| Localizar os diretórios, sistemas e dependências | [Mapa técnico do repositório](arquitetura/MAPA-REPOSITORIO.md) |
| Saber o que está integrado ou em homologação | [Estado das funcionalidades](funcionalidades/STATUS.md) |
| Registrar uma tarefa, proposta ou bloqueio | [Gestão de demandas](organizacao/FLUXO-DE-TRABALHO.md) |
| Ver a fotografia do repositório e o plano gradual | [Inventário e migração](organizacao/INVENTARIO-E-PLANO.md) |
| Organizar e economizar GitHub Actions com segurança | [Automações](operacoes/AUTOMACOES.md) · [Auditoria de 300 execuções](operacoes/RELATORIO-CI-2026-11-04.md) |
| Saber os testes necessários e o que comprovam | [Homologação e evidências](qa-homologacao/CRITERIOS.md) |
| Acompanhar preparação para Play Store | [Portões de publicação](publicacao-play-store/ESTADO-E-PORTOES.md) |
| Trabalhar telas, animações e selos | [Biblioteca de design](../design/README.md) |
| Localizar guias de versões antigas | [Histórico preservado](historico/README.md) |

## Módulos

- **Aplicativo, comunidade e perfil:** [`app/`](../app/) · [Perfis](perfil-modernizacao.md) · [Engajamento](engajamento-0193.md).
- **Selos e cargos:** [Segurança](selos-seguranca.md) · [Design de selos e títulos](../design/selos-e-titulos/README.md).
- **Guardião:** [`cloudflare/guardian-worker/`](../cloudflare/guardian-worker/) · [Guia](atrio-guardiao.md).
- **Push e notificações:** [`cloudflare/push-worker/`](../cloudflare/push-worker/) · [FCM](push-fcm-v0170.md).
- **Avatares e mídias:** [`cloudflare/avatar-worker/`](../cloudflare/avatar-worker/) · [Cloudinary](cloudinary-fotos-0197.md).
- **Privacidade e exclusão de contas:** [PR #71, em homologação isolada](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/pull/71).
- **Distribuição:** [Checklist de segurança](checklist-seguranca-publicacao.md).

## Interpretação obrigatória de status

**Planejado** → **Em desenvolvimento** → **Em homologação** → **Integrado** → **Publicado**. **Bloqueado** pode ser atribuído enquanto faltarem autorização, evidência, recursos ou revisão.

- **Integrado** significa que o código está na `main`, com SHA identificado.
- **Homologado em CI/emulador** não significa que está publicado ou implantado.
- **Publicado** exige prova de deploy/release e, se aplicável, Play Console e testes operacionais.
- Consulte a [versão real no Gradle](../app/build.gradle.kts) e o [script de versão](../scripts/status_versao.py), não o número de um documento histórico.

**Proteção:** o repositório é público. Não colocar senhas, keystore, dados pessoais, dumps ou segredos aqui. A branch protegida de backup e a PR #71 não devem ser modificadas por esta organização.
