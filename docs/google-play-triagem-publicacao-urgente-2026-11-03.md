# Átrio Católico — central de publicação prioritária (03/11/2026)

> TRIAGEM URGENTE — não é autorização de lançamento. Nenhum gate de segurança deve ser alterado artificialmente.

## Objetivo
Preparar uma versão para **envio à revisão da Google Play**, começando por teste interno/fechado. Não prometer disponibilização pública em uma hora: o Google decide aprovação, e contas pessoais novas podem requerer 12 testadores por 14 dias antes de ter acesso à produção.

## Fonte comprovada agora

- PR de candidata Play: **#71** — `feature/play-closed-testing-aab-20261031`, ainda *draft* e fora da `main`.
- App ID `br.com.atriocatolico`, versão **0.20.2** (`versionCode=37`), `targetSdk=36` e `compileSdk=36`: código validado.
- Workflow Play QA [41731950354](https://github.com/josuepradodeoliveiracosta-gif/atrio-catolico-android/actions/runs/41731950354): 3 jobs aprovados; o job AAB **pulou a compilação integral** nesta revisão por mudanças restritas a backend/QA. Logo, **não** prova a existência de AAB novo nem assinado neste commit.
- `.github/workflows/play-signed-aab-manual.yml`: somente manual, a partir de `main`, requer `GERAR AAB PLAY`, aprovação das variáveis, SHA-256 de chave upload, compatibilidade da assinatura, `--enforce` e URLs públicas antes de carregar segredos. Produz AAB assinado **somente no Actions**, sem publicar automaticamente.
- Privacidade: **0/9 evidências**; UGC: **0/6**; `releaseAuthorized:false`. Não preencher `verified:true` sem evidência.
- Projeto Cloudflare `atrio-catolico-privacidade-qa` existe, mas **não tem deploy**. O domínio QA não pode ser tratado como URL definitiva da loja.
- Não há acesso à Play Console por ferramenta conectada para confirmar cadastro, assinatura, testes, acesso à produção ou status de revisão.

## Via rápida segura, por dependência

1. **Responsável abre Play Console** e confirma: conta verificada, app `br.com.atriocatolico` cadastrado, acesso a teste interno/fechado, acesso à produção se objetivo for lançamento público, eventuais 12 testadores/14 dias e pendências da seção `Painel`. Sem isso não há como afirmar entrega em uma hora.
2. **Escolher e comprovar a via de exclusão:** o Google permite página pública HTTPS com endereço de e-mail de suporte para iniciar a solicitação, além do caminho dentro do app. A PR já dispõe de um modo `manual-support` opcional. Isso **não dispensa** excluir realmente contas/dados após pedido, comprovar controle de titularidade, atendimento, exceções legais/retention e disponibilidade do canal. Não ativar página pública sem essas condições.
3. **Publicar política HTTPS e termos de comunidade revisados**, declarar privacidade e Segurança dos dados com base no funcionamento real. O app contém conteúdo de usuários; confirmar denúncias, bloqueio e moderação no backend efetivamente ativo.
4. **Assinatura:** comparar certificado de app signing da Play com o certificado de APK OTA já instalado; conferir certificado de upload SHA-256. Nunca mover chaves e senhas para GitHub público ou conversa.
5. **Validação funcional curta de aparelho:** login, postagem, comentário, denúncia, bloqueio, Push, exclusão real, URL web e versão Play sem sideload. Não considerar QA de SQLite um substituto.
6. **Somente após evidências reais:** remover impedimentos legítimos, revisar PR, mesclar candidato aprovado, disparar assinatura manual em `main`, obter AAB assinado, abrir a faixa Play disponível, preencher formulário e enviar para análise.

## Textos prontos para ficha da loja (revisar antes de usar)

**Nome:** Átrio Católico

**Descrição curta:** Comunidade católica para conversar sobre a fé e compartilhar reflexões.

**Descrição geral:**
O Átrio Católico é um espaço de conversa e partilha dedicado a temas da fé católica. Participe de discussões, publique reflexões e acompanhe respostas de outros participantes. O aplicativo reúne recursos de perfil, interações e notificações, conforme disponibilizados na versão instalada. Mantenha o respeito nas conversas e utilize os recursos de denúncia disponíveis quando necessário.

Aplicativo de comunidade independente; não representa oficialmente a Igreja Católica.

**Notas da versão candidata (menos de 500 caracteres):**
Primeira versão do Átrio Católico destinada a testes de estabilidade e experiência de uso. Recursos de comunidade, perfil e discussões, sujeitos à validação dos participantes. Se encontrar problemas, envie feedback pelo canal de suporte informado no teste.

## Intertravamentos e datas

- **Proibido** alterar `releaseAuthorized:false`, evidências de privacidade/UGC e segredos só para forçar assinatura.
- **Proibido** implementar descarte parcial de Auth/Firestore sem coordenar dados de outros usuários, Cloudinary, FCM e retenção.
- **Proibido** indicar status `Publicado` sem release e confirmação reais da Play Console.
- Documentação oficial:
  - https://support.google.com/googleplay/android-developer/answer/9859348
  - https://support.google.com/googleplay/android-developer/answer/14151465
  - https://support.google.com/googleplay/android-developer/answer/13327111?hl=pt-br
  - https://support.google.com/googleplay/android-developer/answer/11926878
  - https://support.google.com/googleplay/android-developer/answer/9859654

**Prioridade desta hora:** concluir o máximo de material comprovável e verificar acesso da conta Play, não produzir novas compilações de QA que não atinjam os bloqueadores.
