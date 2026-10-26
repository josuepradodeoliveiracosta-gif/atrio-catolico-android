# Átrio 0.16.0 — Central de notificações

## Entrega
- Filtros Todas, Não lidas e Administração (somente administradores habilitados).
- Respostas agrupadas por discussão, ordenação pela ocorrência mais recente, data/hora e indicador de grupos não lidos no sino.
- Leitura individual ou de todos os grupos carregados; dispensar respostas exige confirmação e não remove o conteúdo da discussão.
- Resultado mais recente da própria verificação de selo, com texto público genérico. Não exibe reviewNote nem reviewedBy. Ao reapresentar um pedido, o resultado anterior deixa a central.
- Filas administrativas agrupadas por denúncias e solicitações. Os grupos se atualizam quando as decisões mudam; ler não altera status nem concede selos.
- Respostas abrem a discussão com retorno à central. Resultados abrem Meus selos. Pendências abrem o painel administrativo correspondente.
- Preferências separadas para respostas, resultados de verificação e administração. Afetam central e contador do sino.

## Persistência e limites
- Nenhuma mudança em regras, coleções, índices compostos ou backend; nenhum deploy Firebase é necessário.
- Leituras de respostas continuam sincronizadas pelo campo read existente. Operações em massa são divididas em lotes de até 400 e informam falhas.
- Leitura dos avisos derivados e preferências são locais, por UID/aparelho, com até 4000 identificadores de leitura. Não representam permissões. Reinstalar/limpar dados pode reapresentar esses avisos.
- A central começa com 50 registros por fonte paginada e oferece carregar mais. Contagens não representam todos os registros não carregados. Denúncias legadas sem status são pendentes; a consulta preserva essa compatibilidade.
- O pedido de selo é um documento reutilizado: a central mostra o resultado atual, não um histórico imutável. Não notifica alterações manuais de outros selos.
- Leituras administrativas são desligadas e o conteúdo removido ao revogar o papel. A composição também filtra eventos administrativos defensivamente.
- Não há push com app fechado nem comunicados gerais nesta etapa.

## Validação
- Testes JVM para agrupamento, ordenação, não lidos, revogação de papel na composição, leitura diferente de resolução e resultados de selo.
- CI executa os testes JVM, compilação Android e a suíte de segurança Firestore.
- Instalação: applicationId preservado, versionCode 22, versionName 0.16.0; mesma assinatura permanente do release.

## Roteiro de conferência no dispositivo
1. Instalar release por cima da versão anterior. Conferir respostas antigas, Não lidas, agrupamento e leitura em massa.
2. Receber outra resposta na mesma conversa: o grupo deve voltar a não lido. Abrir e voltar deve retornar à central. Uma discussão removida deve apresentar mensagem apropriada.
3. Desativar uma categoria, reabrir app e conferir preferência. Entrar em outra conta deve usar preferências próprias.
4. Verificar resultado de pedido aprovado/rejeitado sem expor justificativa interna. Abrir o resultado deve levar a Meus selos.
5. Administrador: conferir pedidos e denúncias; marcar lido sem resolver; decidir no painel e conferir atualização. Com mais de 50 documentos, buscar os anteriores.
6. Revogar acesso administrativo e conferir desaparecimento do filtro e das pendências. Conta comum não deve consultar as coleções administrativas.
7. Testar conexão interrompida, teclado/fonte ampliada e tela pequena. Compilação não substitui esta conferência visual.
