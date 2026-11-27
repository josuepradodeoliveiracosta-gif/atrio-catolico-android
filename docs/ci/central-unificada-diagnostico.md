# Central unificada de diagnóstico — marco 1

Escopo: unificar evidências de CI e inventário operacional em um relatório local
JSON/Markdown. Não é uma plataforma de telemetria implantada. Nenhuma alteração
de Firebase, Cloudflare, credenciais, permissões, dados reais ou produção.

## Executar (Debian, Termux ou CI)
Na raiz do repositório, com Python 3 e um ci-report.json do SHA desejado:

```bash
python3 -m unittest scripts.test_operational_diagnostic_center -v
python3 -m scripts.operational_diagnostic_center \
  --ci-report ci-report.json \
  --json /tmp/atrio-central.json \
  --markdown /tmp/atrio-central.md
```

Use destinos novos. O relatório é gerado também pelo workflow de qualidade
existente, sem novos gatilhos ou permissões. Artefatos mantêm retenção de 14 dias.
O workflow não faz sondas operacionais nem recebe observações manuais.

Opcionalmente, em ambiente local, passe --observations caminho.json.
Exemplo artificial (use horário UTC real da observação):

```json
{"schema_version":1,"observations":[{"environment":"perfil_qa","component":"authentication","state":"degraded","observed_at":"2026-11-26T11:00:00Z"}]}
```

Ambientes: production, qa_geral, perfil_qa, chat_qa, ota_pilot.
Componentes: android_crash, android_memory, android_performance, authentication,
connectivity, firebase_firestore, firebase_messaging, cloudflare, guardian, ota.
Estados de entrada: ok, degraded, failed. Nenhuma informação livre é admitida:
não incluir tokens, logs, conteúdo de mensagens, UID, e-mail ou dados pessoais.
Observações são declaradas, não verificadas, e vencem após 24 horas. Não
interpretar ausência, expiração ou sucesso de CI como saúde comprovada.
Gravidade inicial é triagem (failed=high, degraded=warning), não diagnóstico causal.
As combinações ambiente/componente são inventário candidato, não prova de
implantação ou aplicabilidade de cada serviço. O relatório não consulta a rede,
não confirma HEAD atual e não autoriza correções, merge ou deploy.

## Próximos marcos
1. Fundação: inventário, agregador, privacidade, testes e integração CI.
2. Coletores QA autenticados somente leitura: confirmar mapeamento de variantes,
   endpoints permitidos e escopo de projetos; avaliar Firestore, FCM e Cloudflare
   com evidências datadas, falhas simuladas e isolamento.
3. Diagnóstico Android: coleta local de travamentos, memória, desempenho,
   conectividade e autenticação; consentimento, minimização e retenção antes
   de qualquer transmissão. Avaliar Crashlytics sem ativar serviços por padrão.
4. Painel administrativo com autorização de servidor, estados desconhecidos,
   acessibilidade, histórico e classificação de incidentes; sem dados pessoais.
5. Homologar por variante e, após autorização específica, piloto em produção.
   Métricas causais e reparo não são inferidas de checks verdes.

Sem mudança da política de autocorreção automática suspensa.
