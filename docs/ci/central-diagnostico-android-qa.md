# Marco 3 — diagnóstico operacional Android (QA)

Painel local, voluntário e efêmero, com entrada de launcher separada "Diagnóstico · ... QA".
Registrado somente nos manifests Perfil QA, Chat QA, QA Geral padrão, remote e push.
Produção, debug, OTA piloto, fixture fictícia e laboratórios especiais de avisos
não registram a Activity. Validação adicional de build type e pacote em runtime.
A entrada ignora extras de Intent. ACCESS_NETWORK_STATE somente nos manifests QA
participantes. Sem coleta automática, gravação, exportação, logs, crash handler,
Crashlytics ou chamadas explícitas de rede pelo painel.

- Travamentos e ANR: até cinco registros de saída do processo principal disponíveis
  via Android API 30+. Sem leitura de stack traces, descrições, datas ou UID.
- Memória: proporção do heap JVM e sinal lowMemory.
- Conectividade: rede ativa/VALIDATED do Android, sem ping, IP ou SSID.
- Autenticação: presença de sessão local no Firebase default já configurado,
  somente se o projeto QA corresponder. Não chama login, refresh ou Firestore.
  O SDK existente pode ter seu próprio comportamento de rede.
- Abertura: medição voluntária, após super.onCreate até primeiro pré-desenho da
  MainActivity ou PerfilQaActivity. Retornar ao painel e atualizar. Não é cold
  start completo, FPS, tempo até interatividade ou medição representativa.
- Limpar remove resultados e medição em memória, não o histórico Android.

A central CI não recebe automaticamente dados deste painel. Integração futura
requer consentimento, minimização, retenção e autorização de servidor.
Ausência de evidência não comprova saúde.

## Homologação pendente
Executar testes JVM, build das variantes participantes, verificar manifests
mesclados e ausência de launcher diagnóstico em release/OTA. Testar em API
26–29 (fallback), API 30+ (histórico), QA física (rede, sessão sintética,
medição, limpeza, TalkBack e fonte ampliada). Simular falhas apenas em fixture
descartável autorizada. Confirmar isolamento e ausência de transmissão pelo painel.
Não houve deploy, credenciais novas ou integração à main.
