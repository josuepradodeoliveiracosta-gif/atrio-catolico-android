# Átrio Católico — ficha da loja e operação do teste fechado

**RASCUNHO INTERNO, NÃO ENVIAR À GOOGLE PLAY SEM REVISÃO.**
Data: 31/10/2026. Pacote previsto: `br.com.atriocatolico`.
Não anuncia segurança, exclusão efetiva ou benefícios ainda não homologados.
Este documento não cria um app, uma faixa de teste ou uma publicação.

## Texto proposto para ficha da loja

**Nome (rascunho):** Átrio Católico

**Descrição curta (rascunho):**
Uma comunidade católica para conversar sobre a fé e compartilhar reflexões.

**Descrição completa (rascunho):**

> O Átrio Católico reúne pessoas interessadas em aprofundar a fé católica e participar de uma comunidade de diálogo e partilha.
>
> Explore discussões sobre temas da Igreja, publique reflexões, acompanhe conversas e interaja com outros participantes.
>
> Recursos já presentes no projeto Android, sujeitos a validação na versão Play:
> - Fóruns e discussões organizados por temas.
> - Publicações e respostas na comunidade.
> - Perfil e recursos de interação entre participantes.
> - Notificações sobre a atividade da comunidade, quando habilitadas.
> - Recursos de denúncia e moderação para ajudar a manter o respeito.
>
> O Átrio Católico busca promover uma conversa respeitosa, com atenção à doutrina e à vida da Igreja.
>
> Aplicativo de comunidade independente. A revisão humana deverá confirmar a relação institucional e evitar sugerir um endosso oficial da Igreja que não tenha sido documentado.

**Evitar na ficha:** “exclusão completa de dados disponível”, “todos os dados são apagados automaticamente”, “proteção infalível”, “rede social oficial da Igreja”, ou funcionalidades não testadas no AAB submetido.

## Dados que exigem preenchimento pelo titular no Play Console

- Nome do desenvolvedor e contato público de suporte; não colocar e-mail pessoal privado no repositório.
- Política de privacidade **publicada e acessível por HTTPS**, conforme práticas reais e LGPD.
- URL HTTPS funcional para solicitação de exclusão de conta e dados, verificada de fora do aplicativo.
- Declaração de Segurança dos dados baseada na versão final, SDKs e sistemas ativos.
- Classificação indicativa e público-alvo coerentes com conteúdo gerado por usuários.
- Declarações sobre moderação, denúncia, bloqueio e tratamento de dados religiosos.
- Ícone, imagens de destaque, capturas reais da variante Play e recursos gráficos com direitos de uso.
- Países, categoria, disponibilidade, conta de teste/revisão (sem inserir credenciais públicas).
- Decisão sobre **certificado de assinatura do app** na Play versus certificado do APK OTA já instalado; não confundir com certificado de upload.

## Organização do teste fechado

O teste fechado só começa de verdade quando o Play Console concluir o cadastro, a faixa estiver configurada, houver um AAB aceito e os testadores aderirem pelo link correspondente. **Nenhuma dessas ações é considerada concluída por este documento.**

Preparação sugerida:
1. Definir lista privada de testadores (endereços pessoais não devem ser commitados no GitHub).
2. Configurar a faixa “Teste fechado” no Play Console, adicionar lista ou Google Group e um canal de feedback.
3. Publicar uma candidata aprovada após privacidade funcional, assinatura, AAB e inspeção externa.
4. Distribuir o link oficial opt-in e registrar **aceite**, aparelho, versão e feedback em local privado.
5. Validar atualização sem desinstalar e preservação de dados, especialmente para quem já usa APK OTA.
6. Corrigir falhas, incrementar versionCode e atualizar a faixa sem reutilizar código de versão já consumido.

Para contas pessoais de desenvolvedor criadas após 13/11/2023, o Google exige pelo menos **12 testadores inscritos por 14 dias consecutivos** para **pedir acesso à produção**. Esses 14 dias não são uma etapa obrigatória *antes* de iniciar a faixa fechada. Confirmar a elegibilidade real da conta Play.

## Matriz de validação em aparelho Android

| Área | Cenário mínimo de aceite |
| --- | --- |
| Instalação | AAB Play instalado pela Play; pacote correto e assinatura conferida |
| Migração | Instalar sobre APK release anterior sem apagar conta/dados, se a chave Play for compatível |
| Autenticação | Login, logout, sessão, nova conta e recuperação |
| Discussões | Publicar, responder, abrir tópicos, salvar e exibir em segunda conta |
| Perfil | Editar e visualizar dados, foto, rótulos de perfil e opções do usuário |
| Guardião | Testar denúncias e moderação sem expor conteúdo restrito |
| Notificações | Mensagens recebidas fora do app com opt-in e permissões corretas |
| Privacidade no app | Localizar e iniciar solicitação de exclusão; confirmação de recebimento |
| Privacidade web | Abrir URL pública em navegador sem app; verificar titularidade e protocolo |
| Exclusão real | Teste segregado de Auth, Firestore, Cloudinary, tokens, dados relacionais e retenção |
| UX Android 16 | Bordas do sistema, teclado, navegação, rotação e acessibilidade |
| OTA | Nenhuma rotina de download/instalação externa é executada na variante Play |
| Erros | Falha de rede, sessão expirada, duplicidade de pedidos e reenvio não destrutivo |

**Bloqueadores confirmados em 31/10/2026:** issue #72 sobre exclusão real; 0/9 evidências de privacidade; falta de política pública HTTPS/portal funcional; comparação de certificados; AAB Play ainda sem assinatura; integração com PRs #70 e #98 pendente. Candidata OTA código 36; workflow Play deve exigir >36 até revisão de novas versões.

## Texto de convite aos testadores (usar só após faixa realmente existir)

> Estamos preparando um teste fechado do Átrio Católico, uma comunidade dedicada a conversas e reflexões sobre a fé católica. Quem participar deverá instalar o app pelo link **oficial** da Google Play e nos ajudar a testar cadastro, fóruns, notificações, perfil e estabilidade. Enviaremos o link de participação e o canal de feedback quando a versão estiver liberada. A adesão é voluntária.

Não divulgar link fictício, data de publicação ou exclusão de dados como concluída.

## Fontes oficiais

- Google Play — teste fechado: https://support.google.com/googleplay/android-developer/answer/9845334
- Requisito de 12/14 para contas elegíveis: https://support.google.com/googleplay/android-developer/answer/14151465
- Exclusão de conta/dados: https://support.google.com/googleplay/android-developer/answer/13327111
- Versão e código: https://support.google.com/googleplay/android-developer/answer/9859152
- API 36: https://developer.android.com/google/play/requirements/target-sdk
