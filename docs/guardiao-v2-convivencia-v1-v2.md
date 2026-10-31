# Átrio Guardião V2 — modelo oficial definido; V1 é legado

**Decisão do responsável (30/10/2026):** o **Guardião V1 é uma versão antiga**. O **Guardião V2 é o único modelo de moderação autônoma previsto para o APK oficial do Átrio Católico**. A presente alteração registra a direção do projeto, **não** representa ativação, publicação ou autorização para sanções automáticas.

## Responsabilidades definitivas

- **Guardião V2 — destino oficial:** o backend deve processar novos conteúdos e edições de modo independente de o aplicativo estar aberto. O APK oficial exibirá avisos, estado dos casos, painel administrativo e contestação/recursos compatíveis com o V2, mas não deverá carregar credenciais privilegiadas nem depender do aparelho para moderar a comunidade.
- **Guardião V1 — legado descontinuado para novas integrações:** sua lógica de classificação e moderação no `cloudflare/push-worker/src/index.js` não deve voltar a ser proposta como motor paralelo. Mantê-lo temporariamente no código é uma medida de compatibilidade até que seja possível comprovar, por testes e inspeção de dependências, que sua retirada não afetará push, dados anteriores ou revisão humana. O V1 **não será** o moderador ativo do APK oficial.
- **Infraestrutura de push:** preservar as funcionalidades gerais de notificação de `atrio-push`, separando-as da moderação V1. Não confundir desligar a triagem V1 com desligar notificações do aplicativo.
- **Moderação humana:** continuará disponível para supervisão, casos ambíguos, recursos, revogação de decisões e gestão de emergências. "Autônomo" não significa ausência de prestação de contas.

## Duplicações e riscos técnicos existentes

| Tema | V1 legado | V2 oficial a implementar |
| --- | --- | --- |
| Acionamento | `POST /moderation/event` originado pelo APK | Leitura/varredura no servidor, com checkpoints e idempotência |
| Classificação | `classifyGuardiao` | `classify` e política V2 |
| Registro de casos | `reports` | `guardian_cases`, `guardian_audit`, `guardian_notices` |
| Revisão | Fluxos legados do `atrio-push` | Fluxos V2 com revisão e recursos |
| Quarentena | `guardiao_quarantine` com esquema/IDs legados | Mesmo nome de coleção, porém IDs e estados diferentes; exige isolamento e testes de compatibilidade |
| Ativação | `GUARDIAO_ENABLED` e flags V1 | `GUARDIAN_V2_ENABLED` mais gates de identidade, aprovação e emergência |

**Consequência:** não executar V1 e V2 em paralelo como produtores de casos. Detectar duas vezes não demonstra maior confiabilidade: pode duplicar alertas e criar decisões contraditórias.

## Sequência de implantação do V2 oficial

1. **Congelar a evolução do V1:** não acrescentar detecção, IA de moderação, punições ou novos pontos de chamada V1. Inventariar referências e dados legados antes de retirar arquivos. O V1 não é considerado uma alternativa funcional para o lançamento oficial.
2. **Concluir o backend V2:** resolver identidade temporária e de menor privilégio para execução recorrente, autorização de IAM, custos/cotas, retries, limites, deduplicação, alertas e parada emergencial. O cron QA atual e o teste WIF isolado não satisfazem essa etapa.
3. **Validar autonomamente em laboratório:** emulador Firebase e, depois, QA autorizado com casos sintéticos; comprovar criação consistente de caso/auditoria/aviso, edição, paginação, reinício e falhas. Inicialmente **somente triagem**, sem remoção automática.
4. **Integrar o APK oficial ao V2:** painéis, histórico, notificações, contestação e experiência de moderação V2; retirar referências a acionamento V1 após verificar que nada quebra. Preservar atualização de assinatura e versão Android.
5. **Preparar transição de dados:** preservar `reports`, `guardian_cases` e `guardiao_quarantine` históricos; evitar migrar ou reinterpretar decisões automaticamente. Não mesclar IDs incompatíveis; definir exibição explícita de casos legados quando necessário.
6. **Ativar apenas o V2 depois de autorização e testes E2E:** primeiro triagem supervisionada; depois avaliar **ações autônomas proporcionais e reversíveis** com política explícita, prevenção de falsos positivos, avisos, recurso humano e autorização própria. Retenção/remoção/banimento não estão autorizados por esta decisão arquitetural.
7. **Descomissionar a moderação V1:** remover código e rotas legadas apenas após testes provarem a ausência de referências e integrações necessárias; manter notificações gerais. Em falhas V2, usar `emergencyStop` e revisão humana — não reativar V1 automaticamente.

## Critérios de aceite para o APK oficial

- Somente o V2 produz novos alertas autônomos.
- A ausência de conexão ou abertura do APK não impede o serviço servidor de executar quando habilitado.
- Há proteção contra alertas duplicados, corrida entre atualizações, casos obsoletos e abuso de denúncias.
- O sistema não decide culpa por divergência doutrinária, citações religiosas ou relatos de vítimas sem contexto e revisão adequada.
- Nenhuma chave de serviço administrativa no APK, GitHub ou logs; custos verificados antes do rollout.
- O fundador/administração pode interromper a automação, auditar casos e reverter medidas com registros consistentes.
- Contestações e denúncias permanecem acessíveis conforme política de privacidade e regras.

## Limites desta atualização

Esta decisão é **arquitetural e de escopo**. A V2 possui código de motor e QA, mas **não está comprovadamente em moderação produtiva recorrente**. Esta documentação **não altera** `main`, backup, Firebase oficial, IAM, Cloudflare, flags, APK, assinatura ou billing. A PR #50 continua dedicada à deduplicação offline e à documentação.

Referências de implementação: `cloudflare/guardian-worker/src/index.js`, `src/scan-paged.js`, `cloudflare/push-worker/src/index.js`, `app/src/main/java/br/com/atriocatolico/GuardianCaseOverview.kt`, `ModerationScreen.kt`, `firestore.rules`.
