# Átrio Católico — drenagem independente no motor de exclusão (QA)

**03/11/2026 — PR #71, ambiente fictício somente. Sem autorização para exclusão real ou deploy.**

## Risco

Um marcador de conta `frozen` bloqueia novas operações que respeitem o marcador, mas não comprova que escritas privilegiadas anteriormente admitidas terminaram. Um FCM, uma alteração Firestore, D1 ou Cloudinary ainda em trânsito pode fazer reaparecer conteúdo depois da limpeza.

## Contrato implementado

`createControlledQaDeletionExecutor` passa a exigir `freeze.enable`, `freeze.verify` e o **novo método separado `freeze.drained({uid,caseId,epoch})`**.

O adaptador de drenagem deve confirmar ausência de operações admitidas não reconciliadas em todas as rotas relevantes. `false`, `undefined`, erros e ausência do método impedem o avanço. A conferência ocorre no checkpoint de congelamento, antes de cada fase posterior, antes do apagamento Auth e após a autorização específica para repetir efeitos na recuperação.

Na recuperação com marcador congelado, uma drenagem ambígua aborta antes da segunda autorização; não converte estado desconhecido em permissão de reexecutar.

## Testes

- Marcador congelado com operação pendente: nenhuma exclusão de Firestore, mídia, FCM ou Auth.
- Método de drenagem ausente: rejeição antes da aquisição do caso.
- Escrita pendente surgida após a segunda autorização: pausa antes de `purge_firestore`, sem afetar a conta vizinha.
- Leitura de drenagem indefinida: falha fechada antes de pedir autorização de repetição.
- Regressões das sete fases, ledger persistente, três mídias fictícias e revisor assinado continuam obrigatórias.

## Limites

Os testes usam adaptadores sintéticos, não uma prova independente nos provedores remotos. Implantação real exigiria controle de admissão serializado e durável por UID, rastreamento de transações em andamento, reconciliação externa de resultados ambíguos e integração de todos os Workers de produção. `releaseAuthorized:false`. Nenhum usuário real, assinatura Play, Firebase/Cloudflare oficial ou backup deve ser alterado por esta revisão.
