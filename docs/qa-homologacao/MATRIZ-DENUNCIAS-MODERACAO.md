# Proteção de denúncias e papéis — matriz QA de moderação

**PR isolada, sem deploy, sem dados reais.** Evidência técnica para a
issue #200; não aprova nem define regras operacionais de moderação.

## Risco e cobertura

Existem dois protocolos privados: `chat_reports` e `chat_group_reports`.
O titular consulta apenas suas próprias denúncias; contas habilitadas
em `admins/{uid}` podem consultar protocolos, mas não recebem acesso
geral a DMs ou ao histórico de grupos.

A matriz dedicada verifica, no Firebase Emulator `demo-atrio-v11`,
que (1) titulares não listam protocolos de terceiros; (2) participantes
do mesmo chat não herdam acesso a denúncias; (3) moderador tem acesso
mínimo a protocolos e não lê mensagens por causa do papel; (4) a
revogação de `enabled` interrompe imediatamente leitura e listagem
do moderador; (5) usuários não conseguem autoatribuir `admins`;
(6) textos de denúncias precisam coincidir com mensagens existentes
e campos extras ou autor falso são rejeitados; (7) protocolos são
imutáveis via cliente e (8) suspensão do chat e revogação 18+
não apagam denúncias já existentes.

Os mesmos cenários executam em regras QA isoladas e no candidato de
paridade versionado, sem publicar nenhum dos dois.

## Decisões que a matriz NÃO toma

Não define equipe de moderação, SLA, categorização de gravidade,
recurso, procedimentos de emergência, julgamento de conteúdo,
prazo de preservação, fundamento jurídico ou descarte. Esses pontos
exigem decisão humana e revisão adequada na issue #200.
Não existe painel administrativo novo, automação de sanção nem
concessão de acesso geral a conversas privadas.

**NO-GO permanece:** acesso etário 18+ confiável, decisão sobre
denúncias/moderação e retenção, avaliação LGPD, auditoria remota
e autorização específica de QA. Marco geral 2/7 = 29%.
