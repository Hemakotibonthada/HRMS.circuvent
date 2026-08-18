package com.circuvent.hrms.feature

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.circuvent.hrms.AppContainer
import com.circuvent.hrms.data.SessionUser
import com.circuvent.hrms.data.net.ApiException
import com.circuvent.hrms.data.net.OfflineException
import com.circuvent.hrms.data.net.SignedOutException
import com.circuvent.hrms.data.queue.OfflineQueue
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * The session, in three states.
 *
 * `Loading` is a real state, not a shade of signed-out: on a cold start the
 * answer is genuinely unknown until the keystore has been read and the token
 * checked. Collapsing it into signed-out shows the sign-in screen for a moment
 * on every launch and then replaces it; collapsing it into signed-in shows an
 * empty home screen to somebody who is not.
 */
sealed interface SessionState {
    data object Loading : SessionState
    data object SignedOut : SessionState
    data class SignedIn(val user: SessionUser?) : SessionState
}

class AppViewModel(private val container: AppContainer) : ViewModel() {

    private val _session = MutableStateFlow<SessionState>(SessionState.Loading)
    val session: StateFlow<SessionState> = _session.asStateFlow()

    private val _pending = MutableStateFlow(0)
    val pending: StateFlow<Int> = _pending.asStateFlow()

    private val _quarantined = MutableStateFlow<List<OfflineQueue.Operation>>(emptyList())
    val quarantined: StateFlow<List<OfflineQueue.Operation>> = _quarantined.asStateFlow()

    init {
        container.onSignedOut = { _session.value = SessionState.SignedOut }
        restore()
        refreshQueueCounts()
    }

    private fun restore() {
        viewModelScope.launch {
            if (container.tokens.accessToken == null) {
                _session.value = SessionState.SignedOut
                return@launch
            }

            try {
                _session.value = SessionState.SignedIn(container.repository.me())
            } catch (_: OfflineException) {
                // Offline with a stored token is not signed out. Forcing a
                // password on a train with no signal, when the token is still
                // valid, is the difference between an app that works on a
                // commute and one that does not — and clocking in on arrival,
                // in a basement car park, is exactly the case.
                _session.value = SessionState.SignedIn(null)
            } catch (_: SignedOutException) {
                _session.value = SessionState.SignedOut
            } catch (_: ApiException) {
                _session.value = SessionState.SignedOut
            }
        }
    }

    suspend fun signIn(email: String, password: String, totpCode: String?) {
        val (access, refresh) = container.repository.signIn(email, password, totpCode)
        container.tokens.save(access, refresh)
        _session.value = SessionState.SignedIn(runCatching { container.repository.me() }.getOrNull())
    }

    /**
     * Signs in with a passkey.
     *
     * Takes the already-flattened assertion rather than doing the ceremony
     * itself, because the ceremony needs an Activity to host the system sheet
     * and a ViewModel outlives the one that started it.
     */
    suspend fun signInWithPasskey(assertion: Map<String, String>) {
        val (access, refresh) = container.repository.passkeySignIn(assertion)
        container.tokens.save(access, refresh)
        _session.value = SessionState.SignedIn(runCatching { container.repository.me() }.getOrNull())
    }

    suspend fun passkeyLoginOptions(): String = container.repository.passkeyLoginOptions()

    suspend fun passkeyRegisterOptions(): String = container.repository.passkeyRegisterOptions()

    suspend fun registerPasskey(fields: Map<String, Any>) =
        container.repository.passkeyRegister(fields)

    fun signOut() {
        viewModelScope.launch {
            container.repository.signOut()
            container.tokens.clearSession()
            _session.value = SessionState.SignedOut
        }
    }

    fun refreshQueueCounts() {
        viewModelScope.launch {
            _pending.value = container.queue.pending().size
            _quarantined.value = container.queue.quarantined()
        }
    }

    /**
     * Sends everything that is due, oldest first.
     *
     * Errors are recorded against the operation rather than surfaced: the
     * queue decides whether a failure is worth retrying, and a network blip
     * during a background flush is not something to interrupt somebody with.
     */
    fun flush() {
        viewModelScope.launch {
            for (operation in container.queue.due()) {
                try {
                    container.repository.sendQueued(operation.kind, operation.payload, operation.id)
                    container.queue.markSent(operation.id)
                } catch (e: ApiException) {
                    container.queue.markFailed(operation.id, e.status, e.message)
                } catch (e: OfflineException) {
                    container.queue.markFailed(operation.id, null, e.message)
                    // Nothing else will get through either. Stop rather than
                    // burning the backoff on every queued operation at once.
                    break
                }
            }
            refreshQueueCounts()
        }
    }

    fun retry(id: String) {
        container.queue.retry(id)
        refreshQueueCounts()
        flush()
    }

    fun discard(id: String) {
        container.queue.discard(id)
        refreshQueueCounts()
    }
}
