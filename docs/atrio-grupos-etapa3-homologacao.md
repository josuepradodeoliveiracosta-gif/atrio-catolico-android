# Átrio Grupos — etapa 3 experimental (somente texto)

Base do plano: *Átrio Conversas — Plano Completo*, edição de 06/11/2026,
páginas 5–7, 9–11. O PDF propõe grupos de **estudo, oração e comunidades**,
com administradores, convites e regras de participação, mas **não aprova**
limites numéricos, política para menores ou regras finais de permanência.

## Implementado na ramificação de homologação

- Grupos **privados** com três categorias: estudo, oração e comunidade.
- Criador administrador inicial. Controle de funções: promoção de membros
  a administrador e revogação pelo criador. O criador não pode ser removido.
  Para um coadministrador sair, o criador deve revogar primeiro sua
  função. A interface não exibe um botão de saída que o servidor negaria;
  a saída direta de administrador continua proibida.
- Convites pessoais somente por administrador para contatos com conversa
  individual **previamente aceita**, com revalidação dos bloqueios.
  O servidor recusa convites para UIDs aleatórios e contatos bloqueados.
- Convite recebido não concede acesso ao grupo. A entrada é efetivada
  com **aceite explícito e atualização atômica** de convite e participantes.
  Um bloqueio criado após o envio do convite também impede o aceite.
- Recusa, saída voluntária de integrante não administrador, remoção por
  administrador e reconvite após a saída ou recusa.
- Mensagens somente em texto, enviadas atomicamente com atualização
  da prévia e da última mensagem. Há denúncia individual de mensagem:
  somente o trecho denunciado e o motivo são disponibilizados à moderação
  central autorizada, sem liberar o histórico integral do grupo.
  Denúncias repetidas pela mesma conta e mensagem são recusadas.
  Sem upload, áudio, foto, vídeo, GIF,
  documento, chamadas, mensagens temporárias ou criptografia ponta a ponta.
- Leitura de mensagens apenas por participantes ativos. Removidos perdem
  o direito de novas leituras e envios **no servidor**.
- Pré-requisito adicional: registro de elegibilidade **por conta**, gravado
  somente pela administração. Se ausente ou suspenso, o servidor nega leitura,
  envio, convites e demais ações; o Android limpa as listas de grupos.
  A permissão global sozinha não habilita todos os usuários.
- Evitamos assinatura de perfil por bolha de mensagem: os nomes dos
  participantes são consultados uma vez por usuário presente no grupo,
  reduzindo listeners Firestore e custo.
- Preparação para testes com consultas de grupos por participação e convites
  recebidos por usuário. Convites pertencem à coleção exclusiva
  `atrioGroupInvites`, para validar consultas de grupo de coleções.
- Etapa de design em Jetpack Compose no arquivo `AtrioGroups.kt`,
  reutilizando as cores vinho/dourado do Átrio.

## Limites **provisórios**, não aprovados pelo produto

- Até **8 participantes** por grupo.
- Até **2 grupos novos por criador em 24 horas**, com contador
  transacional e janela de tempo validada pelo servidor.
- Até **1.500 caracteres** por mensagem.
- Intervalo de **3 segundos** para mensagens consecutivas do mesmo
  participante num grupo.
- Lista inicial de até 50 grupos, 100 convites e histórico paginado
  de 40 em 40 mensagens.

São limites técnicos conservadores para testes; não são decisões finais
da comunidade. Os custos gratuitos do Firebase e Cloudflare são cotas
variáveis e devem ser medidos, não presumidos ilimitados.

## Ativação em duas barreiras (fail-closed)

**O grupo permanece desligado**. Não publicar o fragmento no Firebase
de produção nem acionar estas configurações em contas reais.

1. O Átrio Conversas individual já precisa estar homologado, implantado
   e ativado pela administração. Desativá-lo também fecha o acesso
   aos grupos pelo servidor.
2. O fragmento `firebase/atrio-grupos-v1.rules.fragment` deve passar por
   auditoria própria, combinado às regras de conversas individuais.
3. A configuração `app_config/chat_groups`, gravável **somente via
   Console/Admin SDK autorizado**, precisa conter os três campos abaixo
   para abrir no ambiente de teste:

```json
{
  "enabled": true,
  "minorPolicyApproved": true,
  "version": "2026-11-groups-v1"
}
```

A presença de `minorPolicyApproved: true` **não comprova idade**.
Um segundo portão exige para cada participante o documento
`users/{uid}/chatGroupAccess/eligibility`, provisionado apenas pelo
Console/Admin SDK autorizado, com status `approved` e
`policyVersion: "2026-11-group-safety-v1"`. A conta não consegue escrever
ou autorizar a si própria, nem visualizar os registros de outros usuários.

**Atenção:** nem esse documento nem a configuração global constituem
verificação de idade ou política real de proteção de menores. São travas
administrativas adicionais, inicialmente fechadas. A forma de verificar
elegibilidade e proteger menores **continua pendente** de definição e
homologação; não criar esses registros em produção como atalho.

O teste do emulador configura essa flag artificialmente, **somente** em
projeto `demo-atrio-v11`, para testar os fluxos de permissões.

## Integridade do projeto

- **Não alterar `firestore.rules` oficial.** O arquivo é protegido pelo
  fingerprint de Selos V2 e deve permanecer byte a byte igual ao `main`.
- O teste `tests/security/atrio-grupos.test.mjs` combina os fragmentos
  apenas em memória. Não atualiza Firestore, Cloudflare, Auth ou o APK
  de produção.
- Nenhuma credencial privada, nova assinatura, novo bucket, backup ou
  configuração externa é necessária para executar os testes locais.
- Não conceder acesso à moderação ou ao fundador a mensagens de grupos
  dos quais não participam. A exceção é o conteúdo **específico**
  encaminhado numa denúncia por um participante autorizado.

## Validações pendentes antes de qualquer rollout

- Decidir e implementar elegibilidade/segurança de menores e revisar
  comportamento de bloqueios dentro de um mesmo grupo.
- Definir a responsabilidade e a sucessão do criador em caso de
  exclusão de conta ou necessidade de encerrar o grupo.
- Revisar o fluxo de denúncias seletivas já implementado, inclusive
  responsabilização e tempo de retenção das denúncias.
- Definir limites numéricos finais, tratamento de spam em muitos grupos,
  retenção e exclusão.
- Avaliar custos e índices das consultas `collectionGroup` no Firestore
  real; não presumir que índices do emulador equivalem a produção.
- Tratar falhas de rede, reconvite, concorrência de vários convites e
  participação máxima em testes com duas ou mais contas e dispositivos.
  O envio usa um ID estável durante a tentativa para não criar duplicatas
  em caso de resposta perdida, porém exige teste de rede intermitente.
- Verificar acessibilidade, telas pequenas, fonte ampliada, teclado,
  rotação, troca de conta, Android em segundo plano e estado offline.
- **Não foram integradas notificações push de grupos**. Mensagens podem
  ser consultadas com o grupo aberto, mas a entrega por FCM demanda
  validação de destinatários, silenciamento e prevenção de duplicação.
- Sem E2EE; não anunciar criptografia ponta a ponta.

A PR segue como rascunho até essas decisões, homologação e aprovação
explícita de implantação.
