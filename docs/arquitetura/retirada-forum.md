# Retirada do fórum

O controle de encerramento fica em `app_config/community_feed`. O valor `enabled: true` apresenta o feed antes do corte. O valor `forumRetired: true` transfere a página inicial e a publicação para o feed e fecha o acesso às coleções legadas, inclusive para APKs antigos conectados ao servidor.

## Ordem de homologação

1. Instalar as regras e os índices da versão em QA. Atualizar as Functions e os Workers do projeto de QA correspondente.
2. Ativar o feed e validar publicações, perguntas, comentários e avisos com contas fictícias.
3. Ativar `forumRetired` em QA. Validar o APK novo e um APK anterior. Conferir o encerramento das leituras e gravações de tópicos, respostas, reações e avisos antigos. Confirmar o caminho de volta para o feed ao abrir uma referência legada no APK novo.
4. Repetir a sequência em produção somente com autorização para o corte e depois da homologação. O envio de respostas do fórum fica bloqueado no Worker. Certificados, comunicados, perfis, conversas e projeções históricas de insígnias têm rotas próprias.
5. Depois do corte validado, revisar as dependências operacionais dos índices de `posts` e `replies` e dos gatilhos exclusivos do fórum antes de removê-los da infraestrutura. Conservar os registros históricos e as cópias até decisão específica sobre retenção.

As regras bloqueiam acessos futuros ao servidor em APKs antigos. Conteúdo já armazenado em cache nesses aparelhos depende da atualização do APK. O cliente novo interrompe o uso da navegação, das assinaturas e dos avisos legados ao receber a configuração de encerramento.
