# Átrio Católico 0.14.0 — Selos da comunidade

Atualização sobre o release 0.12.1; versionCode 14. Preserva a assinatura permanente,
applicationId br.com.atriocatolico e o vídeo após login. Não aplique o antigo patch v13.

## Como usar
Os selos aparecem sob o nome nas publicações, no detalhe, nas respostas e no perfil.
Nos cartões aparecem até dois selos e um botão +N quando houver outros. Toque em um selo
para ler a explicação. No próprio perfil aparecem todos. Não há pontos, níveis de fé
ou poderes administrativos associados aos selos religiosos.

- Padre: cruz vinho; atribuição manual após verificação pela administração.
- Diácono: estola diagonal vinho; atribuição manual após verificação.
- Leigo/Leiga: comunidade em tom neutro; opcional, autodeclarado no próprio perfil.
- Moderador: escudo azul; atribuição manual e acesso admins/UID ativo obrigatórios.
- Fundador do Átrio: portal com cruz dourada; exclusivo do UID configurado pelo dono do projeto.

Padre/Diácono são mutuamente exclusivos. Leigo/Leiga não aparece junto de selo clerical.
Uma pessoa pode combinar identidade religiosa, Moderador e, no caso do criador, Fundador.
Nenhum selo concede ou revoga permissões. O acesso continua controlado por admins/UID.

## 1. Publicar regras — antes de usar os selos
No projeto atrio-catolico, substitua TODO o conteúdo de Firestore > Regras pelo arquivo
atrio_catolico_firestore_rules_v014.txt e publique. O mesmo arquivo está em firestore.rules
no repositório. A atualização pelo GitHub não publica regras automaticamente.
https://console.firebase.google.com/project/atrio-catolico/firestore/rules

Alternativa pelo Termux, se Firebase CLI continuar autenticado:
```sh
cd ~/atrio
git pull --ff-only origin main
firebase deploy --only firestore:rules --project atrio-catolico
```
Isso publica somente as regras, sem alterar os documentos de publicações/contas.
Não foram executados comandos no seu Firebase real durante a preparação.

## 2. Ativar o selo exclusivo de Josué
Não presumimos o UID pelo nome e não o fixamos no código. O UID completo não estava
no histórico disponível. No novo APK, entre na SUA conta e abra Perfil > Copiar meu UID.
No Firebase > Firestore Database > Dados, crie na RAIZ:
- Coleção: app_config (abra a existente, preservando opening_video).
- Documento: community.
- Campo: founderUid.
- Tipo: string.
- Valor: cole o UID completo da sua conta.

Apenas esse UID recebe Fundador do Átrio. Não escolha ID automático, não coloque e-mail
ou nome no campo e não crie o documento dentro de admins/profiles. O campo é legível
por membros autenticados: guarde ali somente o UID público, nenhum dado sensível.
A gravação deste documento é exclusiva do Console/Admin SDK autorizado; nem moderadores
podem se promover a Fundador pelo aplicativo. Sem esse documento o selo fica ausente.

## 3. Conceder e retirar selos
Leigo/Leiga: Perfil > Minha identificação na comunidade > escolha > Salvar.
Sem selo clerical, o membro pode remover sua identificação quando quiser.

Padre/Diácono: usando uma conta com admins/UID enabled=true, abra Perfil > Administrar selos.
Peça ao membro que copie seu UID no próprio perfil. Cole esse UID e carregue os selos.
Confira a correspondência da conta com a pessoa e sua condição clerical por um canal
confiável antes de marcar a confirmação e salvar. Esta versão não recebe documentos
comprobatórios nem faz verificação automática. A equipe continua responsável pela análise.
Escolha Sem selo clerical para revogar a identificação verificada. A alteração limpa
qualquer autodeclaração anterior; o membro pode voltar a escolher Leigo/Leiga em seu perfil.

Moderador: no mesmo painel, conceda/retire o selo. Para conceder, o UID já deve possuir
admins/UID com enabled boolean true, configurado pelo dono do projeto no Console.
A concessão do selo não concede acesso administrativo. Retirar somente o selo também
não retira permissões. Para revogar acesso, altere enabled do documento admins para false.
As regras deixam de autorizar a leitura do selo ativo quando o acesso é revogado.
Após reativar um cargo anteriormente revogado, reabra a tela/app para renovar listeners
que possam ter sido encerrados por perda de permissão.

## Privacidade e sincronização
Identidades ficam em member_badges/UID (identity e layLabel); marcadores de moderador
em moderator_badges/UID (enabled). Só leitura por UID, sem listagem por membros.
Perfis privados, e-mails e biografias não foram abertos a outros usuários.
Selos só aparecem após confirmação do servidor, sem gravações locais pendentes. Quando
há falha/perda de conexão reconhecida, ficam ocultos em vez de exibir credenciais antigas.
Não há garantia de atualização instantânea durante os intervalos de sincronização.
As consultas são compartilhadas por UID enquanto o autor está visível. Podem acrescentar
leituras Firestore; nenhum Firebase Storage, extensão ou serviço pago novo foi habilitado.

## Teste no celular
1. Instale o release por cima do 0.12.1. Não desinstale.
2. Publique as regras e configure founderUid. Confira o selo dourado no seu perfil.
3. Crie uma publicação e uma resposta; confira o selo nas duas.
4. Em conta comum, escolha Leigo/Leiga e remova; confira por outra conta.
5. Pela conta admin, conceda Diácono/Padre a uma conta de teste aprovada; confira nas
   publicações antigas e nas respostas, sem reescrever textos antigos.
6. Confira que a conta comum não vê Administrar selos e que o selo não dá moderação.
7. Conceda Moderador a conta admin de teste, revogue admins/enabled e confira ocultação.
8. Tente alterar founderUid por cliente: regras proíbem inclusive a administradores.
9. Confira vídeo após login, comentários, salvos, denúncias e moderação.
O teste visual e a instalação no celular dependem de você; a compilação será feita pelo Actions.
