# Fundador — habilitação controlada pelo Termux

O app só reconhece o **Fundador administrativo** quando o usuário autenticado
corresponde a `app_config/founder.uid` **e** seu documento
`admins/{uid}.enabled` tem valor booleano `true`.

O selo visual de Fundador não substitui permissões reais.

## Conferência inicial (sem modificar o Firebase)

1. Confirme no [Firebase Authentication](https://console.firebase.google.com/project/atrio-catolico/authentication/users)
   que o UID corresponde à sua própria conta. **Não compartilhe senhas,
   tokens, códigos de recuperação ou arquivos de credenciais.**
2. No Termux, dentro do repositório atualizado do Átrio, execute:

```bash
cd ~/atrio-selos-v2-auditoria
git pull --ff-only origin main
node scripts/termux-founder-access-guard.mjs --uid=SEU_UID_AQUI
```

O modo padrão faz **somente duas consultas GET** ao projeto `atrio-catolico`:
`app_config/founder` e `admins/{uid}`. Nenhuma modificação, login novo,
backup, publicação de regras, chamada de GitHub Actions ou APK.

- `founderState: "this_account"` e `adminState: "enabled"`: já está configurado.
- `founderState: "absent"`: configuração de Fundador ainda não foi criada.
- `adminState: "absent"` ou `"disabled"`: falta habilitação de administrador.
- `anotherFounderExists: true`: **PARAR.** Não transferir privilégios;
  revisar a identidade e a titularidade pelo Console.

A saída não exibe o UID lido ou a identidade de outro Fundador.

## Aplicação (somente após conferir o relatório e confirmar o UID)

O procedimento exige dois parâmetros adicionais. É proposital que o comando
de consulta acima **não** faça nenhuma escrita. A concessão dos privilégios
deve ser uma decisão explícita e consciente do administrador do projeto.

```bash
node scripts/termux-founder-access-guard.mjs --uid=SEU_UID_AQUI --apply --confirm=atrio-catolico:fundador
```

O procedimento exige uma sessão Firebase CLI preexistente com permissões
administrativas reais do projeto. Revalida os documentos antes de qualquer
escrita e usa **um único commit atômico com precondições** no Firestore:

- `app_config/founder.uid` é criado somente se o documento não existir.
- `admins/{uid}.enabled` é escrito apenas se ainda não for `true`.
- Em documento administrativo já existente, altera-se **somente** `enabled`;
  todos os outros campos são mantidos, com `updateTime` como condição.
- Se o Fundador for outro UID, interrompe sem alterar nada.
- Verifica os dois documentos novamente após um commit bem-sucedido.
- Se houver falha da API ou verificação, interrompe e requer nova conferência;
  não repita cegamente nem tente sobrescrever o Fundador existente.

Nenhum arquivo de backup, conta de Auth, regras Firebase, APK ou Worker
é modificado pelo procedimento. O Firebase registra as alterações de
documentos; as permissões são efetivas para a conta quando o app receber
os snapshots mais recentes.

## Homologação no app

Entre novamente no aplicativo, se necessário, e confirme a exibição do
selo de Fundador, a disponibilidade das telas de Moderação/Verificação
e a capacidade de consultar solicitações. Teste com uma segunda conta
comum para confirmar que ela **não** recebeu acesso administrativo.

**Atenção:** não altere manualmente `app_config/founder` para outro UID
nem habilite `admins/` de contas não verificadas. Se já houver Fundador
diferente, a operação requer auditoria e procedimento de transferência
separados — não é uma situação tratada automaticamente por este script.
