package br.com.atriocatolico

import com.google.firebase.firestore.DocumentReference
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.Transaction

internal enum class ProfileV3Interest(val id: String, val label: String, val category: String) {
    PRAYER("oracao", "Oração", "Pedidos de oração"),
    FORMATION("formacao", "Formação", "Sagradas Escrituras"),
    COMMUNITY("comunidade", "Comunidade", "Juventude"),
    NEWS("noticias_catolicas", "Notícias católicas", "História da Igreja");

    companion object {
        fun forLabel(label: String): ProfileV3Interest? = entries.firstOrNull { it.label == label }
    }
}

internal const val PROFILE_V3_QUESTION_LIMIT = 140
internal val profileV3DocumentId = Regex("^[A-Za-z0-9_-]{1,128}$")

internal fun String.profileV3Question(): String = trim {
    it in '\t'..'\r' || it == '\uFEFF' || Character.isSpaceChar(it)
}

internal fun String.profileV3QuestionLength(): Int =
    profileV3Question().let { it.codePointCount(0, it.length) }

internal data class ProfileV3InterestDetail(val question: String = "", val postId: String? = null) {
    fun fields(): Map<String, String> = buildMap {
        question.profileV3Question().takeIf { it.isNotEmpty() }?.let { put("question", it) }
        postId?.let { put("postId", it) }
    }
}

internal fun ProfileV3Draft.interestFields(): Map<String, Map<String, String>> =
    publicInterests.mapNotNull { ProfileV3Interest.forLabel(it) }
        .mapNotNull { interest ->
            interestDetails[interest.id]?.fields()?.takeIf { it.isNotEmpty() }?.let { interest.id to it }
        }.toMap()

internal fun ProfileV3Draft.interestProjection(field: String): Map<String, String> =
    interestFields().mapNotNull { (key, value) -> value[field]?.let { key to it } }.toMap()

internal fun DocumentReference.profileV3Links() = collection("interest_discussions").document("current")

internal fun Transaction.syncProfileV3Links(before: DocumentSnapshot, postIds: Map<String, String>) {
    if (postIds.isEmpty()) {
        if (before.exists()) delete(before.reference)
    } else if (before.get("postIds") != postIds) {
        set(before.reference, mapOf("postIds" to postIds))
    }
}
