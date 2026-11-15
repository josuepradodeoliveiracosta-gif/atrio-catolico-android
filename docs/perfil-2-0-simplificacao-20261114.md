# Perfil 2.0 — simplificação funcional (14/11/2026)

## Escopo e base

- Branch: `feature/perfil-2-0-simplificacao-20261114`.
- Base remota da `main`: `5de225a5cc2c287faf51749c3a889e6d42929d96`.
- Objetivo: retirar controles redundantes e preservar as funções essenciais, sem mudar tema, autenticação, regras, backend, versão, assinatura, produção ou backups.
- Esta branch é **proposta**, não release integrado ou validado em aparelho.

## Critérios de aceitação

1. A aba Perfil expõe uma única entrada para "Minhas discussões"; o recorte do feed não é apresentado como histórico.
2. A consulta própria ocorre só quando a tela é aberta, ordenada por `createdAt DESC` e paginada em lotes de 20; carga, erro, nova tentativa e fim da lista são observáveis. O índice `posts(uid ASC, createdAt DESC)` já está declarado em `firestore.indexes.json`, mas a existência no backend em produção **não é presumida**.
3. O botão global inferior "Salvos" continua disponível; o atalho redundante de Perfil é retirado.
4. O painel de apoio apresenta uma única ação de cópia da chave Pix, mantendo o controle de edição por fundador autorizado e cópia dos dados bancários.
5. O atalho de avisos identifica o destino real (Central de Notificações) sem duplicar preferências.
6. A solicitação administrativa de exclusão da conta e o texto de confirmação próprios do painel continuam presentes; um texto técnico repetido no Perfil é retirado.
7. Selos, foto, apresentação pública opcional, revisões, notificações, OTA, conta e controles administrativos mantêm acesso e permissões.

## Mudanças implementadas nesta branch

- `ProfileDiscussionHistory.kt`: consulta ordenada/paginada a cada entrada; botão "Carregar mais discussões"; tentativa novamente em caso de erro; não presume histórico integral após a primeira página.
- `ProfileScreen.kt`: remove "Ver publicações carregadas" e atalho "Publicações salvas"; elimina parâmetros de UI sem consumidores, incluindo `savedCount`; simplifica a informação técnica repetida sobre exclusão.
- `OnlineAtrioApp.kt`: ajusta a invocação do Perfil; a aba inferior de Salvos e a navegação para Publicar permanecem inalteradas.
- `DeveloperSupportPanel.kt`: remove botão Pix duplicado; preserva o ícone acessível de cópia.
- `PushSettings.kt`: renomeia "Personalizar avisos" para "Abrir central de notificações".
- `ProfileLayoutUiTest.kt` e `ProfilePhotoUiTest.kt`: adequam os cenários à nova assinatura e à navegação consolidada.

## Riscos e verificações

- **Índice Firestore:** a consulta ordenada depende de índice composto em produção. Não há autorização para publicar índices ou alterar dados reais; verificar sua existência/efeito em ambiente autorizado antes de integrar a mudança. Sem índice, a tela apresenta erro com opção de tentar novamente.
- **Dados antigos:** documentos sem `createdAt` não aparecem em consultas ordenadas; conferir a existência de dados legados na homologação, sem tocar dados reais.
- **Regressões:** executar checks de PR, build Debug, suíte de UI em Firebase Emulator isolado (especialmente `ProfileLayoutUiTest` e `ProfilePhotoUiTest`), e revisar diferenças para garantir que as funções da aba inferior foram preservadas.
- **Aparelho:** depois da aprovação técnica, verificar lista paginada, scroll, rede lenta, fonte ampliada, TalkBack e atalho Salvos na instalação apropriada. Compilar não equivale a validar no celular.

## Continuidade

1. Conferir o SHA da PR, os checks de CI e as evidências do emulador.
2. Se houver falhas, corrigir a causa nesta mesma branch e repetir somente os testes necessários.
3. Confirmar a disponibilização do índice de histórico no destino autorizado, sem deploy automático.
4. Apresentar PR e limitações ao fundador para revisão. Não fazer merge na `main` sem autorização explícita.

## Retomada do Agente 3 — reforço de UI/UX e QA

- Verificado o head `4e49190a63fc` da PR #291: compilação Android, suíte emulador (grupos `profiles`, `interaction` e `bots`), selos/Firestore, segurança, versão e CodeQL aprovados. O job de prévia visual foi dispensado; nenhuma falha ativa identificada.
- Acrescentado contador explícito de **discussões carregadas** (não total global), indicação de fim da paginação, anúncio de erro via região acessível e descrição de carregamento para leitores de tela. Os cartões receberam identificadores de teste sem alterar seu comportamento.
- Acrescentados testes instrumentados na suíte `ProfileLayoutUiTest` com Auth/Firestore emulados: 21 publicações em conta exclusivamente sintética para conferir lotes de 20 e 1, e cenário de erro sem autenticação para verificar a ação de nova tentativa. A passagem no CI do novo SHA deve ser verificada antes de marcar esses testes como aprovados.
- Nenhum esquema, regra, índice, Worker, credencial, versão, assinatura ou ambiente real foi modificado.
- **Pendências externas:** confirmar índice composto no destino autorizado, avaliar documentos legados sem `createdAt` e homologar acessibilidade/navegação em Android físico. A consulta por `orderBy(createdAt)` continua excluindo registros antigos sem o campo.

## Auditoria de histórico e plano de homologação (Agente UI/UX)

**Índice versionado, mas não implantado comprovadamente.** O arquivo \`firestore.indexes.json\` declara em \`posts\` o índice \`uid ASC, createdAt DESC\` (escopo \`COLLECTION\`) e \`firebase.json\` aponta para esse arquivo. É necessária uma consulta administrativa **somente leitura e expressamente autorizada** para conferir o estado do índice no destino; o Firebase Emulator não comprova indexação em produção. Nenhum deploy ou migração foi executado.

**Problema identificado:** \`orderBy("createdAt")\` exclui documentos sem esse campo. A versão anterior podia exibir a mensagem de histórico vazio apesar de existirem publicações antigas.

**Correção proposta na PR:** preservar a ordenação/paginação da consulta normal (20 por página) e, no fim, oferecer a ação opcional **Procurar publicações antigas**. A varredura por \`uid\`, ordenada por ID do documento, percorre no máximo 20 registros por etapa; acrescenta apenas publicações sem \`createdAt\` e remove duplicações por ID. Se um lote não contiver legado, mantém a opção **Continuar buscando publicações antigas**: um lote vazio não prova que a busca terminou. Mostrar o fim definitivo somente depois da última página. Nenhum dado existente é alterado. A varredura pode custar leituras adicionais conforme o número de publicações; cada etapa exige ação explícita.

**Testes planejados no Firebase Emulator \`demo-atrio-v11\`:** \`ProfileLayoutUiTest\` preserva o caso 21 = 20+1 e verifica continuidade até o fim da pesquisa opcional. \`profile-history-legacy.test.mjs\` prepara 41 documentos datados, 2 sem \`createdAt\` e 1 de outra conta, verifica paginação 20+20+1, encontra os legados depois de dois lotes sem resultado, impede entradas duplicadas, exige data na criação de novos posts e impede enumeração sem autenticação. Até os checks do novo commit concluírem, esses novos resultados **não devem ser chamados de aprovados**.

### Homologação de acessibilidade — roteiro para Agente 5 e fundador

1. **Pré-condições:** verificar SHA e assinatura do APK, \`applicationId\`, perfil de Firebase e isolamento; não instalar um Debug genérico sobre a versão oficial nem usar dados pessoais reais.
2. **TalkBack:** ativar leitor, percorrer Meu Perfil → Minhas discussões → cartões → Voltar. Verificar título anunciado como cabeçalho, ordem de foco consistente, status de carregamento/erro anunciado e botões legíveis por nome, sem ícones anônimos.
3. **Tipografia e toque:** testar em um Android de tela estreita com fontes 150% e 200%, orientação retrato e rolagem até as ações de fim da lista; procurar truncamentos, sobreposição e alvo tocável mínimo de 48dp.
4. **Paginação e legado:** conta fictícia com 21 publicações recentes e 2 sem data; conferir 20+1, contador somente de itens carregados, opção explícita de pesquisa antiga, continuação após lotes sem resultados, ausência de duplicatas, erro e tentativa novamente, e fim verdadeiro do histórico.
5. **Regressões:** repetir edição de perfil/rascunho, foto, selos, conta, privacidade, notificações, revisões, OTA e navegação inferior para Salvos; garantir acessibilidade de todos esses caminhos.
6. **Evidência e decisão:** registrar modelo Android, versão do sistema, densidade/fonte, SHA, ambiente, resultado por cenário e capturas sem conteúdo privado. Separar teste instrumentado, inspeção visual, teste físico e autorização do fundador. A PR continua draft e sem merge/deploy.

**Pendências externas:** disponibilidade do índice em destino autorizado, quantitativo real de posts legados não verificado, homologação física e parecer cruzado. Não migrar dados ou alterar índices produtivos sem aprovação específica.
