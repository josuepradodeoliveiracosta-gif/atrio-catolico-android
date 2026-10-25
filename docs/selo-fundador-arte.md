# Medalha Fundador — integração da arte aprovada

Esta branch usa o nome curto **Fundador** e preserva as regras de concessão do Firebase e o UID exclusivo do criador.

## Ativos visuais

Desenho aprovado: medalha circular, catedral dourada, fundo vinho profundo, ramos de louro, acabamento metálico.

O pacote exportado nesta conversa, `atrio_selo_fundador_android.zip`, contém:

- `res/drawable-nodpi/selo_fundador.png` (384 × 384, perfil).
- `res/drawable-nodpi/selo_fundador_icone.png` (192 × 192, publicações, respostas).

Esses arquivos são PNGs transparentes. Devem ser adicionados à pasta **`app/src/main/`** no repositório. A presença da arte é condição para concluir a integração visual, e o merge não deverá ocorrer antes disso. Enquanto os arquivos não estiverem no repo, o código preserva o símbolo antigo para continuar compilável.

## Segurança e compatibilidade

- Não foram alterados `firestore.rules`, documentos do Firebase, papéis administrativos ou autenticação.
- A identificação **Fundador** continua condicionada à comparação do UID autenticado com `app_config/founder.uid`.
- A imagem no perfil é mostrada só ao fundador; os demais continuam com ícone de perfil padrão.
- Em discussões, a imagem acompanha o selo se a publicação pertence ao fundador.
- Os selos Padre, Diácono, Moderador, Leigo e Leiga continuam iguais.
- A versão 0.13.0 e seu APK distribuído são preservados até aprovação dos PNGs, compilação e lançamento posterior.

## Conferência em dispositivo

1. Verificar que apenas a conta Fundador recebe a medalha.
2. Verificar que a imagem não é truncada em 28dp e 108dp.
3. Verificar contraste do nome "Fundador" com fundo claro e escuro.
4. Conferir que o toque na etiqueta continua abrindo a descrição correta.
5. Testar os demais selos e as regras de autorização.
