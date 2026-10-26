# Três contas bot de teste — Átrio Católico 0.19.0

O fundador administrador pode provisionar três identidades artificiais distintas:
- Clara (BOT DE TESTE): cria uma discussão de simulação;
- Miguel (BOT DE TESTE): participa respondendo;
- Lúcia (BOT DE TESTE): responde à mesma conversa.

Os três cadastros são usuários reais no **Firebase Auth** com identificadores de sistema fixos. São criados pelo serviço autorizado com `disabled: true`, **sem e-mail nem senha**; eles não podem fazer login como usuários humanos. O Worker cria também os documentos `profiles` e `badges` com `botTest: true`, uma discussão identificada `[SIMULAÇÃO]`, três respostas com etiqueta BOT DE TESTE e cinco avisos internos para os participantes simulados. Não envia notificações Push reais, pois os bots não possuem dispositivos inscritos.

## Como criar
1. Instale o APK de testes com a nova opção no perfil. Entre na **conta fundadora**, que também deve estar habilitada em `admins/{uid}`.
2. Na seção Administração, abra **Bots de teste** e confirme **Criar três bots e simular conversa**.
3. O app envia apenas o ID token da sessão e a confirmação fixa para `POST /test-bots/provision`. Não transmite credenciais privilegiadas.
4. O Worker exige `TEST_BOTS_ENABLED=true`, verifica token pelo Firebase, consulta o administrador habilitado e a conta fundadora no Firestore.
5. O Worker confere/cria os três usuários Auth **desativados**, em seguida grava perfis, selos e simulação por uma única transação REST `documents:commit` com `currentDocument.exists=false`. Repetições não geram outra discussão.

Para segurança, provisionamento **não deve ser chamado por outros clientes**, nem usado para criar pessoas reais ou perfis religiosos verificados. Se Firebase Auth ou o commit Firestore recusarem a operação, o app mostrará erro; é possível retentar pelo mesmo painel. Não presume sucesso em falhas de rede.

Os selos são puramente identificadores visuais. Bots não recebem selo de padre, diácono, moderador ou fundador. A marca explícita BOT DE TESTE aparece em nomes, selos e mensagens. Nenhuma pessoa real é imitada.

### Limitações
- Este mecanismo cria três contas de Auth desativadas e uma **conversa de demonstração**, não processos com login em três telefones. Não mede entrega física de FCM em três aparelhos; essa validação precisa de três contas humanas de teste.
- A simulação é iniciada **por ação consciente do fundador no app**. O mero deploy do Worker não cria contas sem autorização autenticada. Sem essa ação, as três identidades ainda não existem.
- Não gera respostas periódicas nem participa de discussões reais de terceiros. Isso evitaria spam e interação enganosa; exigiria um modo de teste separado com controles de volume.
- Requer que a conta de serviço Firebase tenha permissão IAM de gerir contas Firebase Auth e que a API Identity Toolkit aceite a operação. O Worker **não eleva permissões do projeto automaticamente**.
- O rollback de Auth após erro de Firestore não é automático; identidades desativadas podem persistir, e retentativa idempotente reusa essas identidades.
