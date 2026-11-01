# Privacidade — verificação dos destinos Cloudinary e Firestore do Avatar (QA)

Esta etapa da PR #98 usa o **Worker Avatar original** em testes, porém
intercepta toda chamada externa durante operações de escrita. O novo adaptador
`qa-avatar-outbound-gate.js` exige um transporte HTTP falso explicitamente
injetado, configuração de credenciais fictícias e só admite os destinos de
Firebase Auth, Firestore e Cloudinary usados pelo Worker.

O identificador da mídia `atrio-avatares/{uid}/{id}` e o documento
`profile_photos/{uid}` precisam corresponder ao proprietário que recebeu o
ticket de congelamento. Promoção, remoção, leitura da foto e moderação são
verificadas por rota, destino e parâmetros. Escrita em outro UID, URL arbitrária
ou configuração de uma nuvem real falham antes de chegar à rede falsa. Em erro
ou efeito externo ambíguo, o ticket é mantido e impede completar o freeze.

**Limites:** a proteção intercepta `globalThis.fetch` somente em testes Node
sequenciais com transporte explícito. Não é um mecanismo seguro de concorrência
para produção nem substitui IAM, reconciliação de Cloudinary/Firestore reais ou
integração com Workers ativos. A revisão do fluxo HTTP read-only e de várias
instâncias distribuídas continua necessária. Issue #72 permanece aberta.
Não alterar `main`, backups, assinatura, OTA, dados reais nem deploy.
