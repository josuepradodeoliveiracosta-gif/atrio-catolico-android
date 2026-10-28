package br.com.atriocatolico

/** Mesmo ID para a mesma pessoa e o mesmo conteúdo: protegido também pelo Firestore. */
internal object ReportDocumentIds {
    fun post(uid: String, postId: String): String = "${uid}_post_${postId}"

    fun reply(uid: String, postId: String, replyId: String): String =
        "${uid}_reply_${postId}_${replyId}"
}
