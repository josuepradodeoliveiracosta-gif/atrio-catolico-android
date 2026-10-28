# Política de segurança — Átrio Católico

Este repositório contém código público de aplicativo Android. **Nunca** envie:
- chaves privadas Firebase Admin, Cloudflare ou Google Cloud;
- credenciais de usuários, senhas, refresh tokens, arquivos `.env`, `.jks`, `.pem`;
- resultados de testes com dados pessoais, dumps do Firestore ou cópias de bancos;
- backups privados e arquivos de assinatura Android.

`app/google-services.json` é **configuração do cliente Android**, não autenticação administrativa. A chave de API do cliente pode estar embutida no aplicativo, mas deve ser restringida no Google Cloud ao uso necessário. Todas as regras do Firestore e proteções de backend continuam essenciais.

## Reportar vulnerabilidade

Não publique vulnerabilidades exploráveis, dados pessoais, tokens ou detalhes de exploração em uma issue ou pull request pública. Quando a opção estiver disponível, use **Security → Advisories → Report a vulnerability** para enviar um alerta privado aos mantenedores. Se o repositório ainda não disponibilizar esse recurso, entre em contato privadamente com o proprietário pelo perfil do GitHub; **não inclua credenciais** em mensagens públicas.

## Resposta a incidente

1. Suspeita de vazamento: bloqueie o uso da credencial e revogue/rotacione no provedor (Google Cloud/Firebase, Cloudflare, GitHub). Não espere a próxima versão Android.
2. Avalie logs de acesso, alterações de IAM, regras Firebase, Actions, tags, releases, artefatos e branches.
3. Revise o histórico Git: apagar um segredo em novo commit **não remove versões anteriores**, forks ou cópias já baixadas.
4. Caso necessário, limpe o histórico com procedimento coordenado e proteção de backups **sem jamais reescrever o backup protegido por padrão**. Rotação continua obrigatória.
5. Corrija a origem, adicione testes de regressão e confirme as regras de acesso antes de recuperar o serviço.

## Regras para contribuições

- Trabalhe em branches e abra PRs para `main`, evitando alterações diretas.
- Revise alterações em `.github/workflows`, `firestore.rules`, `app/google-services.json`, `cloudflare/` e scripts de deployment com cuidado adicional.
- Workflows de PR não recebem secrets nem credenciais de assinatura; builds de release assinados exigem disparo manual da `main`.
- Use apenas versões de dependências confiáveis; examine os PRs do Dependabot antes de integrar.
- Alterações propostas na segurança não se tornam proteção operacional enquanto a PR correspondente não for revisada e integrada à `main`.

Nenhum scanner substitui revisão humana, testes de permissão e proteção real no Google Cloud e no GitHub.
