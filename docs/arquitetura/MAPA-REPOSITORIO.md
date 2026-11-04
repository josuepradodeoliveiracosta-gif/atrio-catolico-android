# Arquitetura — mapa de responsabilidades

**Decisão:** manter um único repositório GitHub. Este trabalho adiciona estrutura de navegação e de design sem mover código, renomear módulos compiláveis ou dividir projetos.

```text
atrio-catolico-android/
├── app/                     Android — Kotlin / Jetpack Compose
├── cloudflare/              Workers, handlers, D1 e testes dos Workers
│   ├── avatar-worker/
│   ├── guardian-worker/
│   └── push-worker/
├── tests/                   Emuladores, segurança e QA
├── scripts/                 Ferramentas de manutenção/Termux
├── .github/workflows/       CI e fluxos operacionais
├── docs/                    Índice, decisões, referência e histórico
├── design/                  Conceitos visuais, sem implantação
├── firestore.rules          Regras do Firestore
├── firebase.json            Configuração do Firebase
├── app/build.gradle.kts     versionCode/versionName
└── README.md
```

| Área | Evidência | Regra para mudanças futuras |
| --- | --- | --- |
| Android | [`app/`](../../app/) | Preservar `applicationId`, assinatura e `versionCode`; testar Android |
| Firebase | [Regras](../../firestore.rules), [configuração](../../firebase.json) | Emulador, revisão de permissões e autorização separada para produção |
| Cloudflare | [Workers](../../cloudflare/) | Auditar imports, bindings, D1, cron e deploy |
| Testes | [`tests/`](../../tests/) | Preservar cobertura e ambiente sintético |
| Scripts | [`scripts/`](../../scripts/) | Verificar referências em Termux, CI e documentação |
| CI | [`.github/workflows/`](../../.github/workflows/) | Separar revisão de disparos automáticos de publicação |
| Design | [`design/`](../../design/) | Proposta não altera diretamente o APK |
| Docs | [`docs/`](../) | Não quebrar links existentes |

As pastas `ops/` e `fastlane/` aparecem na [PR #71](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/pull/71); não são consideradas integradas à `main` sem verificar a integração.

**Movimentação futura:** inventariar imports, caminhos relativos, plugins Gradle, scripts, Actions, links externos, requisitos de segurança e rollback antes de alterar um diretório técnico.
