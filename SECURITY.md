# Política de segurança — Átrio Católico

Este repositório é **público**. Relatórios de vulnerabilidades não devem revelar senhas, chaves privadas, tokens, contas de usuários ou métodos de exploração de dados reais em Issues públicos.

## Como relatar uma vulnerabilidade

1. Use [GitHub Security Advisories](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/security/advisories/new), quando habilitado, para enviar um relato privado.
2. Descreva o impacto, as versões afetadas e passos seguros para reproduzir usando dados fictícios.
3. Não anexe chaves privadas, tokens FCM reais, CPFs, credenciais ou logs de pessoas reais.
4. Aguarde a correção antes de divulgar detalhes técnicos que permitam exploração.

Para dúvidas gerais sem informação sensível, utilize Issues; não revele detalhes críticos de ataque publicamente.

## Modelo de confiança

- O APK e `app/google-services.json` são públicos e **não podem guardar segredos**.
- Validação e autorização devem ocorrer no Firebase Security Rules e no backend.
- Credenciais de Firebase Admin SDK, Cloudflare e assinatura Android devem permanecer exclusivamente em gerenciadores de segredos e sistemas de administração.
- `main` é a versão integrada. PRs de teste e branches experimentais não devem ativar serviços ou modificar dados de produção.
- A chave de assinatura Android permanente não deve ser compartilhada nem substituída por rotina de teste.

Consulte [o plano de proteção do repositório público](docs/seguranca-repositorio-publico.md).
