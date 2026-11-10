#!/usr/bin/env python3
"""LABORATORIO OFFLINE 18+: somente simula consumo atomico persistente.

NAO e backend, nao autentica sessao, nao valida atestado ou idade real,
nao emite chatAgeEligibility, nao conecta Firebase/Cloudflare e nao faz deploy.
Somente entrada sintetica do TESTE pode chamar consume_verified_fixture().
"""
from __future__ import annotations

from pathlib import Path
import re
import sqlite3

UID = re.compile(r"[A-Za-z0-9_-]{1,128}\Z")
SESSION = re.compile(r"[A-Za-z0-9_-]{16,128}\Z")
NONCE = re.compile(r"[A-Za-z0-9_-]{32,128}\Z")
JTI = re.compile(r"[A-Za-z0-9_-]{16,128}\Z")
TTL = 120
MAX_CLOCK = 2**63 - TTL - 1


def _valid(value: object, pattern: re.Pattern[str]) -> bool:
    return isinstance(value, str) and bool(pattern.fullmatch(value))


def _clock(value: object) -> bool:
    return type(value) is int and 0 < value <= MAX_CLOCK


class OfflineChallengeLedger:
    """SQLite local em arquivo temporario. Proibido para credenciais/usuarios reais."""

    def __init__(self, filename: str | Path):
        path = str(filename)
        if not path or path == ":memory:" or path.startswith("file:"):
            raise ValueError("Somente arquivo SQLite local de laboratorio")
        self._db = sqlite3.connect(path, timeout=10, isolation_level=None)
        try:
            self._db.execute("PRAGMA busy_timeout=10000")
            self._db.execute("PRAGMA journal_mode=WAL")
            self._db.executescript("""
                CREATE TABLE IF NOT EXISTS qa_age18_challenges (
                    nonce TEXT PRIMARY KEY,
                    uid TEXT NOT NULL,
                    session_id TEXT NOT NULL,
                    issued_at INTEGER NOT NULL,
                    expires_at INTEGER NOT NULL,
                    state TEXT NOT NULL
                      CHECK(state IN ('active','revoked','consumed'))
                );
                CREATE INDEX IF NOT EXISTS qa_age18_session_idx
                    ON qa_age18_challenges(uid, session_id, state);
                CREATE TABLE IF NOT EXISTS qa_age18_jtis (
                    jti TEXT PRIMARY KEY,
                    nonce TEXT NOT NULL,
                    consumed_at INTEGER NOT NULL
                );
            """)
        except BaseException:
            self._db.close()
            raise

    def close(self) -> None:
        self._db.close()

    def _rollback(self) -> None:
        # Ate consultar in_transaction pode falhar em uma conexao fechada.
        # Nenhuma excecao de tratamento de erro pode virar sucesso.
        try:
            if self._db.in_transaction:
                self._db.rollback()
        except sqlite3.Error:
            pass

    def issue_fixture(
        self, *, uid: str, session_id: str, nonce: str, now: int
    ) -> bool:
        """Reemissao revoga desafios anteriores MESMO se nonce colidir."""
        if not (_valid(uid, UID) and _valid(session_id, SESSION)
                and _valid(nonce, NONCE) and _clock(now)):
            return False
        try:
            self._db.execute("BEGIN IMMEDIATE")
            self._db.execute(
                """UPDATE qa_age18_challenges SET state='revoked'
                   WHERE uid=? AND session_id=? AND state='active'""",
                (uid, session_id),
            )
            try:
                self._db.execute(
                    """INSERT INTO qa_age18_challenges
                       (nonce,uid,session_id,issued_at,expires_at,state)
                       VALUES (?,?,?,?,?,'active')""",
                    (nonce, uid, session_id, now, now + TTL),
                )
            except sqlite3.IntegrityError:
                self._db.commit()  # Mantem revogacao do desafio antigo.
                return False
            self._db.commit()
            return True
        except sqlite3.Error:
            self._rollback()
            return False

    def consume_verified_fixture(
        self, *, uid: str, session_id: str, nonce: str, jti: str, now: int
    ) -> bool:
        """APENAS simula etapa atomica POS-verificacao externa ficticia.

        Qualquer chamador real poderia mentir sobre a comprovacao.
        Este metodo jamais deve ser usado para conceder acesso ao chat.
        """
        if not (_valid(uid, UID) and _valid(session_id, SESSION)
                and _valid(nonce, NONCE) and _valid(jti, JTI)
                and _clock(now)):
            return False
        try:
            self._db.execute("BEGIN IMMEDIATE")
            row = self._db.execute(
                """SELECT uid,session_id,issued_at,expires_at,state
                   FROM qa_age18_challenges WHERE nonce=?""", (nonce,)
            ).fetchone()
            if (not row or row[0] != uid or row[1] != session_id
                    or row[4] != "active"
                    or not row[2] <= now < row[3]):
                self._db.rollback()
                return False
            try:
                self._db.execute(
                    "INSERT INTO qa_age18_jtis(jti,nonce,consumed_at) VALUES (?,?,?)",
                    (jti, nonce, now),
                )
            except sqlite3.IntegrityError:
                self._db.rollback()
                return False
            updated = self._db.execute(
                """UPDATE qa_age18_challenges SET state='consumed'
                   WHERE nonce=? AND state='active'""", (nonce,)
            )
            if updated.rowcount != 1:
                self._db.rollback()
                return False
            self._db.commit()
            return True
        except sqlite3.Error:
            self._rollback()
            return False
