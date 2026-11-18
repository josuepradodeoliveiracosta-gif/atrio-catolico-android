# Preparação de Firebase Spark isolado — Perfil 2.0

**Agente 2 • 14/11/2026 • Issue #105 • PR #295 • situação: PREPARADO, NÃO CRIADO.**

## Objetivo e isolamento

Preparar um projeto Firebase novo, exclusivo para homologação do Perfil 2.0. O fundador executará as operações reais **pelo Termux, após autorização específica de cada etapa**. A PR contém apenas documentação e um script **somente leitura**, sem alterar projetos existentes. O [parecer do Agente 4](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/issues/105#issuecomment-6884604241) é NO-GO para reutilizar o QA Geral na situação atual.

| Item | Proposta, ainda não provisionada |
| --- | --- |
| Nome | Atrio Catolico - Perfil QA |
| ID candidato | atrio-catolico-qa-perfil |
| Preço | Spark, sem conta de faturamento vinculada |
| App Android futuro | br.com.atriocatolico.perfilqa |
| Firestore futuro | Standard, modo Native, banco (default) |
| Regras iniciais | deny-all: nenhum cliente pode ler ou escrever |
| Dados e contas | exclusivamente sintéticos, sem usuários de produção |
| Projetos intocados | atrio-catolico; atrio-catolico-qa-geral; atrio-catolico-qa-v2 |

O ID do projeto é globalmente único e não pode ser alterado depois de criado. Não se deve presumir que está disponível ou reservar o ID por este documento. A cota de novos projetos Spark por conta é limitada; não contornar limites ativando cobrança.

## Etapa 0: Termux somente leitura — liberada

Revisar e executar o script versionado nesta PR no clone GitHub:

~~~bash
bash scripts/termux-perfil-qa-spark-preflight.sh
~~~

O script exige Firebase CLI e jq e chama apenas **firebase projects:list --json**. Resultados:
- PRE_FLIGHT_LEITURA_OK: o ID pretendido não aparece nos projetos acessíveis à conta; isso **não** garante disponibilidade global, capacidade de criar projeto, cota ou Spark.
- BLOQUEADO_EXISTENTE: o ID já aparece entre os projetos acessíveis; não criar nem reaproveitar sem investigar.
- BLOQUEADO: resposta inesperada ou falha; não executar criação.

Compartilhar somente o resumo apresentado pelo script. Nunca compartilhar tokens, dados de login, JSONs de credenciais nem arquivo completo do Firebase Android.

## Etapa 1: criar somente com autorização expressa posterior

**NÃO EXECUTAR AGORA — comando de referência para o fundador:**

~~~bash
firebase projects:create atrio-catolico-qa-perfil \
  --display-name "Atrio Catolico - Perfil QA" \
  --non-interactive
~~~

Essa operação cria um projeto novo Google Cloud + Firebase; é protegida. **Requisitos antes de liberar:** saída satisfatória do preflight, nome e ID aprovados, limite de criação disponível e ausência de qualquer exigência de cobrança. Após execução autorizada, consultar firebase projects:list e conferir **manualmente no Console Firebase** que o plano é Spark e não há Cloud Billing vinculado. A CLI criar projeto **não prova** por si só que o projeto continua sem faturamento.

## Etapa 2: app Android e banco — aprovações adicionais separadas

Somente após a autorização da Etapa 1, verificação Spark e autorização própria para registrar o app Android, comando de referência **NÃO EXECUTAR AGORA**:

~~~bash
firebase apps:create ANDROID "Atrio Perfil QA" \
  --package-name br.com.atriocatolico.perfilqa \
  --project atrio-catolico-qa-perfil \
  --non-interactive
~~~

Antes de criar o Firestore, o fundador precisa decidir explicitamente a localização; escolha de região pode ser irreversível. O Termux pode listar as regiões com:

~~~bash
firebase firestore:locations --project atrio-catolico-qa-perfil
~~~

Criar, **só após autorização separada**, um único banco Firestore Standard/Native (default), iniciando com **Security Rules deny-all**; nunca usar modo de teste aberto. Não habilitar PITR, backups/restore, múltiplos bancos, Cloud Functions ou outros produtos cobrados. Verificar efetivamente as Rules no projeto recém-criado antes de permitir clientes; criação do banco por CLI não é comprovação de sua política publicada. Revisão do Agente 4 é obrigatória.

Após revisão de Rules e autorização **específica de índices** no projeto novo, implantar apenas o índice composto necessário às consultas de histórico do Perfil: posts (uid ASCENDING, createdAt DESCENDING). Verificar o estado remoto READY usando exclusivamente o alvo:

~~~bash
firebase firestore:indexes --pretty \
  --project atrio-catolico-qa-perfil \
  --database '(default)'
~~~

**Não executar deploy genérico de índices com arquivo versionado de outro ambiente**: isso poderia reconciliar/apagar outras definições. Nenhum deploy foi autorizado nesta PR.

## Integração Android e gates de homologação

Os Agentes 3, 5 e 7 deverão planejar, em branch própria e com a PR #193 coordenada, a variante futura perfilQa:
- Desligada por padrão, com pacote br.com.atriocatolico.perfilqa, certificado de QA, sem substituir APK oficial ou Chat QA.
- Arquivo próprio app/src/perfilQa/google-services.json ligado exclusivamente ao novo projeto; sem fallback para app/google-services.json da produção.
- Compilação bloqueada se project_id, Firebase App ID, pacote ou endpoints não corresponderem ao esperado.
- Inspeção do APK compilado (pacote, certificado, hash, recursos Firebase), emulador offline e depois aparelho físico.
- Rules QA restritas, negativas testadas, contas sintéticas; a consulta de posts por uid não confere, sozinha, privacidade por autor.
- Índice READY e revisão Agentes 4 e 7, além de aprovação expressa para qualquer merge.

## Evidências e situação desta entrega

- O script somente leitura foi verificado localmente com **bash -n** e com Firebase CLI simulado: o cenário de ID ausente produz PRE_FLIGHT_LEITURA_OK; o cenário de ID existente produz BLOQUEADO_EXISTENTE e exit 2. **Esses testes não acessam Firebase real.**
- As leituras anteriores via Termux do fundador se referiam ao QA Geral, não ao futuro projeto.
- **Não foi criado projeto, aplicativo, banco, índice, usuário, build nem APK.** O plano Spark e a disponibilidade do ID não foram comprovados remotamente.
- Este trabalho não muda produção, QA Geral, QA Conversas, Guardião QA, dados, backups, Google Cloud Billing nem main.

## Documentação oficial

- CLI: https://firebase.google.com/docs/cli
- Spark e faturamento: https://firebase.google.com/docs/projects/billing/firebase-pricing-plans
- Limites e ID imutável: https://firebase.google.com/docs/projects/learn-more
- Firestore e Rules deny-all: https://firebase.google.com/docs/firestore/quickstart
- Único banco Firestore gratuito por projeto: https://firebase.google.com/docs/firestore/pricing

**Próxima ação concreta:** fundador executa APENAS o preflight de leitura no Termux e compartilha seu resumo; após isso, decide expressamente se autoriza criação do projeto candidato, sem autorizar automaticamente outras etapas.
