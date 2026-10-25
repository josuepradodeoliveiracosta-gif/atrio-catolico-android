# Átrio Católico 0.13.3 — Medalha Diácono

## Arte oficial

O selo **Diácono** exibe uma medalha circular, Evangelhos abertos e estola diaconal em equilíbrio visual, fundo azul-petróleo e acabamentos ornamentados dourados. A imagem aprovada foi otimizada para 256 × 256 pixels em WebP com transparência e incorporada em `app/src/main/res/raw/selo_diacono_base64.txt`.

O componente `DeaconBadgeArt` decodifica o recurso local para exibição nas etiquetas dos perfis, discussões e respostas; em caso de falha, exibe uma cruz simples como fallback.

## Segurança

O desenho é exibido somente para o campo `clergy = "diacono"` do documento `badges/{uid}`. O usuário não pode alterar esse campo por conta própria: apenas a administração confiável pode verificar e registrar a condição de diácono. A imagem, por si só, não confere privilégios administrativos.

Os selos **Fundador** (catedral dourada) e **Padre** (cruz dourada) não foram modificados. Nenhuma alteração em `firestore.rules`, UID de fundador, assinatura ou dados existentes do Firebase foi necessária.

## Instalação e verificação

- Versão: `0.13.3`, `versionCode = 17`. Instalar release assinado sobre a versão `0.13.2` sem desinstalar.
- Confirmar a identidade do selo Diácono em perfil, publicações e comentários/respostas de conta verificada.
- Confirmar que Padre continua exibindo cruz dourada e Fundador continua exibindo catedral.
- Confirmar que conta comum não consegue se conceder selo de Diácono.
- Verificar o resultado da compilação Android e da suíte de segurança do Firestore antes de publicar.
