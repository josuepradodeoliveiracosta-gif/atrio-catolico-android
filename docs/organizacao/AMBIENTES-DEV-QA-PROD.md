# Átrio Católico — proposta de operação DEV → QA → Produção

**Estado: plano de arquitetura, não implantação nem autorização de publicação.**
Registro elaborado em 09/11/2026 para apoiar a evolução gradual do projeto.
A produção, a assinatura oficial, o Firestore oficial e os backups permanecem intocados.

## Finalidade dos ambientes

| Ambiente | Responsabilidade | Infraestrutura e limites |
| --- | --- | --- |
| **DEV — desenvolvimento** | Criar funções, prototipar e fazer testes rápidos, inclusive cenários destrutivos somente em dados fictícios | Inicialmente branches de trabalho + Firebase Emulator + testes Android locais/CI. **Não há novo Firebase/Cloudflare DEV provisionado** por este plano. Qualquer serviço remoto DEV exigirá contas, chaves, projeto, orçamento e autorização separados. |
| **QA — homologação** | Validar a compilação candidata, regras, migrações, incidentes, privacidade e testes em aparelhos, antes de autorizar a publicação | Firebase **`atrio-catolico-qa-geral`**, variante Android **`br.com.atriocatolico.chatqa`**, Cloudflare Worker **`atrio-qa-geral`**, D1 **`atrio-qa-geral-db`**. Firestore QA publicado **deny-all**; Worker apenas bootstrap e sem eventos/push. Não afirmar FCM real. |
| **PROD — produção** | Executar exclusivamente mudanças aprovadas para os usuários oficiais | Infraestrutura e pacote oficiais existentes. Código integrado na `main` **não equivale** a Release, deploy ou instalação. Nenhum deploy em produção a partir desta proposta. |

## Fluxo de desenvolvimento recomendado

1. **Planejar em Issue:** objetivo, risco, modelo de dados, segurança,
   impactos no Firebase/Cloudflare, custo e critérios claros de aceite.
2. **Desenvolver na branch de trabalho (DEV):** usar fixtures e emuladores;
   credenciais e dados de produção são proibidos. Nenhum push real nem
   alterações nas Rules oficiais durante o desenvolvimento.
3. **Abrir PR para revisão:** compilar a variante correta, testar os cenários
   de sucesso e negação, verificar isolamento de `applicationId`, projeto,
   assinatura e endpoints. Os testes da PR são **evidência apenas do commit**.
4. **Homologar na infraestrutura QA:** **somente após aprovação específica**
   da mudança e da política correspondente, validar Auth, regras, Worker/D1,
   custos, logs sanitizados, APK, notificações e cenários reais.
5. **Decidir GO/NO-GO de produção:** responsável nomeado, revisão humana
   registrada, testes de privacidade, estratégia de recuperação/rollback,
   confirmação de `main` e autorização específica de publicação.
6. **Publicar e observar:** Release/deploy oficial somente após os portões;
   monitorar falhas e regressões com critérios de interrupção e reversão.
   Registrar evidência distinta para build, Release, deploy e dispositivo.

## Portões mínimos — não substituir CI por aprovação

| Portão | Evidência necessária |
| --- | --- |
| Isolamento | Pacote, projeto, Worker, D1 e credenciais separados; nenhuma URL/token de produção no QA/DEV |
| Testes funcionais | Casos positivos, negativos, mudanças de conta, bloqueio, perda de rede e concorrência |
| Segurança | Firestore Rules emuladas; política de menores, moderação e retenção formalmente aprovada antes de ativar conversas |
| Android real | Instalação e atualização comprovadas em aparelhos definidos, com logs privados sanitizados |
| Notificações | FCM verificado nos aparelhos, segundo plano e app encerrado; sem afirmar entrega a partir de teste sintético |
| Operação | Custos, backup/restauração testados, responsabilidades, incidentes, rastreabilidade e plano de rollback |
| Aprovação | Registro humano de GO/NO-GO para QA e **outro** para produção |

## Situação verificada no projeto (09/11/2026)

- **QA**: auditorias por consultas somente leitura confirmaram identidade
  Firebase e regras publicadas bloqueadas; testes automatizados no Firebase
  Emulator e no GitHub Actions aprovados. O laboratório não está liberado
  para conversas reais e os testes do Firebase Emulator não o demonstram.
- **Cloudflare QA**: Worker e D1 isolados provisionados; Worker ainda em
  bootstrap, sem API de eventos, FCM ou notificações habilitadas.
- **DEV remoto**: não foi criado; branches e emuladores bastam para iniciar
  um futuro desenvolvimento seguro, sem custos de infraestrutura extra.
- **Políticas**: issue **#200 aberta**; registro de decisões
  `docs/atrio-conversas-decisoes-seguranca-qa.md` é minuta sem aprovação.
- **Projeto oficial**: nenhuma alteração ou novo Release feito por este plano.

## Gestão de mudanças e decisões pendentes

- Não promover automaticamente DEV → QA → PROD a partir de workflow verde.
- Não usar o Firebase oficial como ambiente DEV, nem compartilhar a conta
  de serviço/identidade entre QA e produção.
- Não conectar bots ou testes automáticos a usuários reais sem autorização
  específica, anonimização e limitação de escopo.
- Não configurar alertas, custos, retenção, deleção ou backups automáticos
  sem revisão e definição de responsáveis.
- Antes de provisionar um Firebase/Worker **DEV remoto**, decidir
  necessidade real, isolamento IAM, orçamento/cotas, dados fictícios e
  procedimento de desligamento; priorizar emuladores quando suficientes.
- Atingir **nível empresarial** demanda ainda monitoramento real,
  recuperação testada, resposta a incidentes, supervisão, revisão
  independente e evidência contínua, além da separação dos três ambientes.

**Fontes internas de controle:** `AGENTS.md`,
`docs/organizacao/FLUXO-DE-TRABALHO.md`,
`docs/qa-homologacao/CRITERIOS.md`, PR #193,
issues #199, #200 e #201.

**Marco de QA:** 2/7 (29%) em 09/11/2026; etapa 3 ainda bloqueada
por decisões de política, apesar dos testes offline aprovados.
