# Átrio Católico — verificação Firebase pelo Termux (somente leitura)

**Finalidade:** preparar a versão de testes fechados do Google Play sem executar
deploy, apagar dados ou expor credenciais. Projeto esperado: `atrio-catolico`.
Esta etapa valida apenas metadados, não prova conformidade nem substitui testes
do Firebase Emulator.

## No Android / Termux

1. Abra o **Termux** e instale as ferramentas:

   ```bash
   pkg update
   pkg install -y git nodejs python
   npm install -g firebase-tools
   ```

2. Entre no Firebase com **sua própria conta** (não compartilhe tokens, QR ou senhas):
   `firebase login --no-localhost`. Siga as instruções do CLI; não coloque
   tokens no chat nem em arquivos do repositório. O Termux armazena sua sessão
   localmente — proteja o aparelho.

3. Na pasta já clonada do projeto, use a **branch da PR #71**:

   ```bash
   git fetch origin feature/play-closed-testing-aab-20261031
   git switch feature/play-closed-testing-aab-20261031
   git pull --ff-only origin feature/play-closed-testing-aab-20261031
   python3 scripts/validar_firebase.py
   python3 scripts/termux_firebase_play_audit.py
   ```

   Se houver alterações locais, resolva antes de `git switch` ou `git pull`.
   **Não** use `git reset --hard`, `git clean` ou sobrescreva seus backups.

4. Para testar a auditoria **sem conexão com o Firebase**:

   ```bash
   python3 -m unittest discover -s scripts -p 'test_termux_firebase_play_audit.py' -v
   ```

## O que a auditoria consulta

Por meio da Firebase CLI, consulta **somente leitura**:
`projects:list`, `apps:list ANDROID`, `apps:list WEB`,
`firestore:databases:list` e `firestore:indexes`. Os comandos do
projeto sempre usam `--project atrio-catolico`, sem trocar o alias local.
O script compara o App ID oficial com `app/google-services.json`, a presença
do banco `(default)`, os índices necessários e a existência de um app Web
para o futuro portal de exclusão. Saídas completas são processadas em memória
e não são impressas.

**Resultado esperado:** uma relação de pontos aprovados/pendentes sem
nomes, e-mails, tokens, dados de usuários, API keys ou identificadores de
dispositivos. O CLI pode precisar de permissões de visualização. Falha de
rede/permissão é **não verificado**, jamais confirmação de ausência.

**Limites:** a auditoria não lê nem compara as regras Firestore de produção,
não ativa Authentication (E-mail/Senha), não cria aplicativo Web, não configura
domínios autorizados e não testa a política de exclusão real. Um resultado
"OK" não libera assinatura, Play Console ou publicação de regras.

## Ações posteriores exigem revisão

A configuração real dos Termos da Comunidade, índice ausente, conta Web e
regras de segurança deve primeiro passar pelo Firebase Emulator, por revisão
da versão compatível com os APKs existentes e por aprovação de execução.
**Não execute** `firebase deploy`, `firebase init`, `firebase firestore:delete`
ou qualquer comando de escrita para resolver automaticamente uma pendência.

Se `npm install -g firebase-tools` falhar no Android, não use instaladores
de procedência desconhecida. Registre apenas o texto genérico do erro (sem
credenciais); será necessário ajustar a instalação do CLI.

Referência da Firebase CLI: https://firebase.google.com/docs/cli
