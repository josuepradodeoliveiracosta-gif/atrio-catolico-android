# Privacidade — trava geral no código real do Push Worker (somente homologação)

**Data:** 31/10/2026  
**PR:** #98 (rascunho) · **Issue bloqueadora:** #72  
**Publicação:** NÃO autorizada; nenhum deploy ou merge foi executado.

## O que mudou no Worker executável

O arquivo de produção `cloudflare/push-worker/src/index.js` agora importa
`cloudflare/push-worker/src/privacy-qa-write-fence.js`. A opção
`ATRIO_PRIVACY_QA_WRITE_FENCE`, quando definida com qualquer valor diferente
de vazio/`false`, **fecha todas as rotas HTTP do Push Worker** antes de
verificar credenciais, autenticar no Firebase, gravar no D1 ou enviar ao FCM.

- `GET /health`: HTTP 200, estado sanitizado `privacy_qa_sealed`;
- todos os demais métodos e caminhos HTTP: HTTP 503, `privacy_qa_sealed`;
- fila de bots: devolve `retry({delaySeconds:60})` para cada mensagem,
  sem reconhecer como concluída, ler o conteúdo ou autenticar;
- handlers exportados `handleBroadcast`, `handleGuardiaoEvent`,
  `handleGuardiaoReview`: recusa imediata com HTTP 503;
- auxiliares com referência ao `env`: auditoria D1, avaliação de IA,
  enriquecimento, quarentena, reserva de cooldown, envio/limpeza de
  dispositivos e avisos de discussão respeitam a trava quando recebem
  o contexto do Worker.

**A ausência da opção preserva o comportamento anterior.** Nenhuma alteração
de binding, segredo, deploy, URL, Cron, certificado Android ou conta foi feita.
O objetivo é possibilitar um ensaio de **isolamento total** antes de conectar
um bloqueio distribuído por UID. Não ative esta opção em produção, pois
interromperia inclusive notificações legítimas.

## Validação do código executável

O teste `cloudflare/account-deletion-audit/src/qa-push-real-worker-seal.test.js`
importa o *próprio Worker* e exerce seus endpoints, fila e funções exportadas.
O ambiente simulado utiliza getters que falham caso alguém tente acessar
credenciais Firebase/D1 e substitui o fetch global por função que falha se
qualquer requisição de rede for tentada. As verificações exigem que:

- todas as entradas mutantes respondam antes de qualquer efeito;
- fila não reconheça mensagens e somente solicite retry;
- os principais handlers exportados não escapem pelo acesso direto;
- um valor inválido da opção continue bloqueando, em vez de reabrir writes;
- sem a opção, `GET /health` conserve a resposta existente.

O pin de blob do Worker e as quatro linhas alteradas do inventário
`qa-worker-sink-manifest.json` foram revisados. A CI que já usa
`node --experimental-sqlite --test cloudflare/account-deletion-audit/src/*.test.js`
incorpora os novos cenários sem criar outra PR.

## O que isto NÃO entrega

1. **Não é bloqueio seletivo por usuário** e não lê a conta em exclusão. A trava
   afeta o Worker inteiro e só funciona se a opção estiver configurada no
   ambiente correspondente.
2. **Não elimina chamadas internas feitas sem o contexto `env`** fora dos
   endpoints oficiais nem impede revisões antigas do Worker.
3. Os outros Workers (Avatar e Guardião) e todos os serviços Firebase Admin,
   Cloudinary e FCM remotos ainda precisam de uma barreira durável compartilhada.
4. Não garante descarte ou retenção segura de dados, nem foi homologado contra
   todos os backends em ambiente de estágio real.
5. Não prova a entrega de nenhuma mensagem FCM nem autoriza excluir contas de
   produção ou distribuir a aplicação pela Google Play.

As nove evidências no `docs/google-play-privacidade-evidencias.json`
continuam **não verificadas**. O desenvolvimento deve seguir para a
integração segregada com bloqueio por UID, validação de assinatura/escopo
e reconciliação das operações pendentes.
