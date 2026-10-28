# Checklist de proteção do repositório público

Auditoria inicial: 2026-10-28. Repositório:
`josuepradodeoliveiracosta-gif/atrio-catolico-android`.

## Estado verificado

- API do GitHub identifica a visibilidade como **public**; o repositório já está acessível a terceiros.
- `main` foi mantida inalterada durante a preparação desta proteção; as correções estão em uma PR de segurança independente do desenvolvimento Android.
- O `app/google-services.json` contém **chave de API de cliente** (esperado para Firebase Android). Isso não equivale a uma chave privada do Firebase Admin, mas exige restrições de API/aplicativo no Google Cloud.
- A rotina original em `.github/workflows/build-apk.yml` usava secrets de assinatura de release no job de build em cada push na `main`. Esta proposta restringe a etapa de assinatura a `workflow_dispatch` **somente na `main`**, e define retenção curta de artefatos.
- O arquivo `.gitignore` anterior dizia que o repositório era privado, ao contrário da visibilidade atual.
- O GitHub não permitiu confirmar a proteção da branch por esta integração (resposta 403), e configurações de Code Security, Actions e colaboradores não foram verificadas. **Não assumir que estão ativadas.**
- A verificação automática de padrões de segredos é heurística: não garante ausência de credenciais e pode exigir correção caso aponte segredos em commits antigos.
- O backup original e sua história de Git devem ser preservados até existir um plano aprovado de resposta a incidentes. Não editar backups sem autorização.

## Ações no GitHub (conta do proprietário)

1. **Rulesets / proteção da main**: Settings → Rules → Rulesets → New branch ruleset; aplicar à `main`; exigir PR antes do merge, proibir force push e exclusão de branch. Se houver colaborador confiável, exigir revisão e rejeitar aprovações obsoletas. Não bloquear o próprio proprietário com regra impossível de cumprir sem avaliar as exceções.
2. **Checks**: após integrar a PR de segurança, exigir como status checks os nomes de jobs **Detectar segredos em arquivos e histórico Git**, **Evitar regressão de versionCode e versionName**, **Regras de seguranca Firestore** e os demais testes de produção realmente usados; não exigir um job que nunca rode na branch alvo.
3. **Actions**: Settings → Actions → General: permissões de workflow padrão **Read repository contents** e desabilitar a criação/aprovação automática de PRs por Actions. Revisar quais Actions terceiros são permitidas; prefira fixação por SHA revisado em workflows sensíveis.
4. **Code Security**: Settings → Advanced Security / Code security and analysis: habilitar Secret scanning, Push protection, Dependabot alerts e Dependabot security updates quando disponíveis no plano/repositório. Ativar Private vulnerability reporting.
5. **Colaboradores e tokens**: revisar Settings → Collaborators / Manage access e Settings → Actions → Secrets and variables. Remover acessos não necessários e conferir permissões por segredo. Não publicar os valores. Proteger a conta de proprietário com passkeys/2FA.
6. **Histórico e artefatos**: executar `python3 scripts/check_public_secrets.py --history` em um clone completo; revisar manualmente Git history, tags, releases, Actions artifacts e branches antigas. Se houver vazamento, **rotacionar imediatamente** as credenciais, mesmo após remover código.
7. **Firebase**: restringir chaves de API clientes em Google Cloud → APIs & Services → Credentials aos apps/APIs apropriados, registrando pacote e certificados oficiais (e validar o login após alterar). Manter Security Rules do Firestore restritas e considerar Firebase App Check. A chave pública de configuração não substitui autenticação.
8. **Cloudflare**: conferir que os segredos são Worker Secrets, não variáveis em Git; rotacionar credenciais expostas e avaliar separar serviços por identidade com menor privilégio. O papel `roles/datastore.user` concede leitura/escrita ampla e deve ser revisado para produção.

## Antes de considerar encerrada a auditoria

- PR de segurança revisada, checks concluídos e integrada; `main` protegida.
- Nenhum alerta de segredo real sem tratamento; rotações executadas quando necessário.
- Dependências críticas revisadas e alertas de segurança monitorados.
- Testes de autenticação, regras Firestore e builds de assinatura verificados.
- Nenhum compromisso de “100% seguro”: segurança é contínua.

## Comandos locais seguros

```sh
python3 scripts/check_public_secrets.py
python3 scripts/check_public_secrets.py --history
```

A execução imprime apenas nomes de arquivos, objetos e categorias de risco, nunca o conteúdo das credenciais encontradas.
