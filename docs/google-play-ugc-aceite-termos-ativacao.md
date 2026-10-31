# UGC — aceite versionado de termos (não ativar em produção)

Estado: **implementado em branch da PR #71 e submetido a QA, sem deploy**. 31/10/2026.

## Contrato do Firestore

Somente um operador autorizado via Admin SDK/Console pode criar ou mudar `app_config/community_terms`. Nenhum APK possui permissão de escrita nesse documento.

Exemplo estritamente **ilustrativo**, não usar como configuração de produção:

```json
{
  "version": "community-v1",
  "url": "https://substituir.example.test/termos-da-comunidade",
  "published": true,
  "enforce": true
}
```

O documento real deverá conter URL HTTPS pública validada e versão efetivamente aprovada, sem placeholder; a política não está hoje publicada/homologada. A versão aceita deve seguir `community-v[0-9]{1,4}`.

- `users/{uid}/acceptedTerms/{version}` contém **apenas** `version` e `acceptedAt` (timestamp do servidor). Gravação somente pelo titular autenticado e apenas para a versão da política atualmente publicada com `enforce:true`; sem atualizações ou exclusões via cliente.
- Quando `enforce:true`, novas discussões, respostas e publicações/edições de apresentação pública exigem aceite da versão exata. A consulta do documento de aceite é feita pelas Rules, não por flag do Android.
- Quando a configuração **não existe** ou está com `enforce:false`, a compatibilidade com APKs já distribuídos é preservada nas Rules. Isso **não comprova conformidade** para liberar o canal Play. A build `playRelease` bloqueia publicação até a configuração oficial estar ativa e o aceite confirmado no servidor.
- A UI mostra um link para os Termos aprovados, um checkbox de consentimento não pré-selecionado e o botão para aceitar. Ela nunca usa a minuta `google-play-termos-comunidade-minuta-nao-publicar.md` como texto vigente. Leituras locais em cache não comprovam aceite.
- O processo de exclusão de conta deverá avaliar a retenção legal/minimização do histórico de aceites; não prometer eliminação nem conservar indefinidamente sem fundamento jurídico.

## Ordem de ativação segura, não executada

1. Aprovar texto, responsável legal, suporte, público-alvo, endereço HTTPS real da política, política de privacidade e tratamento de dados sensíveis da religião.
2. Validar regras `community_terms` e aceites no Firestore Emulator; verificar usuário antigo, cliente novo, sessão trocada, falha de rede, duplicação e segunda conta.
3. Homologar a versão Android OTA e Play com tela de aceite em dois dispositivos e o fluxo completo; preservar os aparelhos já instalados e avaliar migração de versões antigas.
4. Publicar a política aprovada de forma acessível, revisar `enforce` e fazer rollout controlado do backend *somente com autorização operacional*, após garantir que clientes antigos não fiquem impossibilitados de participar sem um caminho de atualização.
5. Com a política efetiva e regras realmente implantadas, validar tentativas por REST/cliente legado, UI, respostas, postagens, perfis e o caminho de moderadores/Workers. Registrar evidência genuína com revisor e data no manifesto UGC.
6. Só então considerar `terms_accepted_before_ugc.verified:true`. Este documento e a compilação não justificam tal alteração.

## Limitações

O filtro de bloqueio de usuários implementado na PR #71 tem partes no cliente e ainda depende da integração com Workers de Push e testes completos. A política de privacidade e o portal de exclusão real continuam pendentes na PR #98. O gate de assinatura Play continua bloqueado. **Não executar o exemplo de configuração acima em Firebase real.**

Teste de contrato: `tests/security/community-terms.test.mjs`; suite no `tests/security/package.json`. A PR #98 rastreia `acceptedTerms/*` no inventário de exclusão, ainda sem apagar dados.
