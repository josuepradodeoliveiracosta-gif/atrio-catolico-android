package br.com.atriocatolico

/**
 * Serializa pedidos de salvar/remover a MESMA discussão.
 *
 * O ícone pode refletir a intenção mais recente durante a escrita, mas o
 * texto "Salvo" só deverá ser anunciado quando o servidor tiver confirmado.
 * Erros restauram o último valor confirmado, nunca um valor otimista.
 *
 * Não conhece Firestore ou a interface: pode ser testado sem Android.
 */
internal class AtrioSaveIntentCoordinator(
    private val write: (id: String, save: Boolean, done: (Boolean) -> Unit) -> Unit,
    private val onState: (id: String, saved: Boolean, pending: Boolean) -> Unit,
    private val onFailure: (id: String) -> Unit
) {
    private data class Entry(
        var confirmed: Boolean,
        var desired: Boolean,
        var writing: Boolean = false
    )

    private val entries = mutableMapOf<String, Entry>()

    fun toggle(id: String, currentlySaved: Boolean) {
        if (id.isBlank()) return
        val entry = entries.getOrPut(id) { Entry(currentlySaved, currentlySaved) }
        entry.desired = !entry.desired
        onState(id, entry.desired, true)
        if (!entry.writing) flush(id, entry)
    }

    private fun flush(id: String, entry: Entry) {
        if (entry.desired == entry.confirmed) {
            entries.remove(id)
            onState(id, entry.confirmed, false)
            return
        }
        val target = entry.desired
        entry.writing = true
        write(id, target) { accepted ->
            if (entries[id] === entry) {
                entry.writing = false
                if (!accepted) {
                    entries.remove(id)
                    onState(id, entry.confirmed, false)
                    onFailure(id)
                } else {
                    entry.confirmed = target
                    if (entry.desired == target) {
                        entries.remove(id)
                        onState(id, target, false)
                    } else {
                        flush(id, entry)
                    }
                }
            }
        }
    }
}
