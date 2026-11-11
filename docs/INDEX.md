# Central do projeto — Átrio Católico

O índice é a **porta de entrada única** para conhecer os módulos, entender o progresso e localizar a documentação sem alterar o código existente.

| Necessidade | Abrir |
| --- | --- |
| Consultar autoria, direitos e evidências jurídicas | [Auditoria preliminar de 09/11/2026](juridico/AUDITORIA-AUTORIA-TITULARIDADE-2026-11-09.md) |
| Conferir licenças de bibliotecas, mídias e dados | [Inventário de terceiros de 09/11/2026](juridico/INVENTARIO-LICENCAS-TERCEIROS-2026-11-09.md) |
| Verificar origem do vídeo, áudio e identidade visual | [Auditoria de mídias de 09/11/2026](juridico/AUDITORIA-PROVENIENCIA-MIDIAS-2026-11-09.md) |
| Acompanhar minutas legais e pendências LGPD (não vigentes) | [Termos de Uso](juridico/MINUTA-TERMOS-USO-2026-11-09.md) · [Privacidade](juridico/MINUTA-POLITICA-PRIVACIDADE-2026-11-09.md) · [Plano de adequação](juridico/PLANO-ADEQUACAO-TERMOS-PRIVACIDADE-2026-11-09.md) |
| Consultar auditoria e limpeza de arquivos sem uso | [Auditoria de 07/11/2026](operacoes/AUDITORIA-LIMPEZA-2026-11-07.md) |
| Localizar os diretórios, sistemas e dependências | [Mapa técnico do repositório](arquitetura/MAPA-REPOSITORIO.md) |
| Consultar organização local do Termux (11/11/2026) | [Inventário do Termux](organizacao/INVENTARIO-TERMUX-2026-11-11.md) |
| Saber o que está integrado ou em homologação | [Estado das funcionalidades](funcionalidades/STATUS.md) |
| Registrar uma tarefa, proposta ou bloqueio | [Gestão de demandas](organizacao/FLUXO-DE-TRABALHO.md) |
| Ver a fotografia do repositório e o plano gradual | [Inventário e migração](organizacao/INVENTARIO-E-PLANO.md) |
| Ver o resultado e os limites da fase de organização | [Encerramento e matriz de aceite](organizacao/ENCERRAMENTO-FASE-2026-11-04.md) |
| Organizar e economizar GitHub Actions com segurança | [Automações](operacoes/AUTOMACOES.md) · [Auditoria de 300 execuções](operacoes/RELATORIO-CI-2026-11-04.md) |
| Consultar a meta 9,0 e o encerramento das otimizações de Actions | [Critérios, evidências e parada](ci/encerramento-meta-9-actions-2026-11-11.md) |
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
- **Privacidade e exclusão de contas:** [PR #98 consolidada, ainda em rascunho e QA isolado](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/pull/98). A [PR #71](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/pull/71) trata da preparação de AAB/Google Play.
- **Distribuição:** [Checklist de segurança](checklist-seguranca-publicacao.md).

## Interpretação obrigatória de status

**Planejado** → **Em desenvolvimento** → **Em homologação** → **Integrado** → **Publicado**. **Bloqueado** pode ser atribuído enquanto faltarem autorização, evidência, recursos ou revisão.

- **Integrado** significa que o código está na `main`, com SHA identificado.
- **Homologado em CI/emulador** não significa que está publicado ou implantado.
- **Publicado** exige prova de deploy/release e, se aplicável, Play Console e testes operacionais.
- Consulte a [versão real no Gradle](../app/build.gradle.kts) e o [script de versão](../scripts/status_versao.py), não o número de um documento histórico.

**Proteção:** o repositório é público. Não colocar senhas, keystore, dados pessoais, dumps ou segredos aqui. A branch protegida de backup e a PR #71 não devem ser modificadas por esta organização.
