# Átrio Guardião V2 — núcleo de autonomia isolado

## Objetivo e proveniência
Etapa inicial da implementação do Guardião autônomo, **sem ativação remota**. O código do motor, classificador e testes foi selecionado da PR #44 (revisão `72cc20a78b860bac147bc79b6b035ae100e2e31b`) e transplantado para branch criada **a partir da main após o merge da PR #45** (`60eeb7300ac189ddeefada14432416739a03c1e3`).

## O que o código implementa
- Classificação determinística de conteúdo, considerando contextos religiosos e relatos, ameaças, golpes, dados pessoais e abuso de links.
- Varredura paginada de discussões, respostas, denúncias e **edições antigas**; checkpoints e repetição segura de páginas em caso de falhas.
- Lógica de geração de casos, avisos, auditoria e revisão humana testada offline. Denúncia por si só não é prova de culpa.
- Controles contra duplicação de caso e mudanças concorrentes, e reversão lógica de retenção em testes.
- Negação de autenticação de produção por **chave privada JSON permanente** e separação de modo QA; testes específicos para travas, identidade, fila e cron sintético.

## O que permanece DESLIGADO
**Não há Worker agendado em produção, implantação Cloudflare, banco D1 novo, deploy de regras Firebase, leitura/escrita do projeto real, alteração do Android, assinatura, APK, merge da PR #44, IAM, secrets ou faturamento.** A PR contém somente módulos de código e testes. O pipeline desta PR só roda Node.js offline e não possui `schedule`, chave OIDC, credenciais, permissões de escrita ou comandos de deploy.

O scanner remoto não pode ser ativado só por existir código: precisa de identidade de servidor **temporária e validada**, orçamento/cotas, permissões minimizadas, parada de emergência, ensaio QA integral e autorização específica. Com acesso de servidor OAuth/IAM, as Security Rules do aplicativo são ignoradas; isso **não** está resolvido por este transplante.

## Critérios para próximas etapas
1. Aprovar testes offline do núcleo com GitHub Actions sem novas dependências nem integrações remotas.
2. Definir identidade sem chave de longo prazo (avaliar GitHub Actions OIDC/WIF com isolamento de projeto), sem Cloud Billing/Blaze obrigatório; preferir somente **fila para revisão humana**, sem excluir automaticamente.
3. Integrar e validar **somente em emulador ou Firebase QA autorizado** scanner + casos + auditoria + aviso, respeitando custo atual R$ 0.
4. Auditoria e autorização explícita antes de fundir à `main` ou permitir escrita, cron produtivo, retenção, deploy, releases.

**Esta etapa prepara o motor autônomo: não é a ativação de moderação 24/7.**
