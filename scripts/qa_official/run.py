"""Black-box UI session on the verified release APK. No Firestore writes here."""
import contextlib
import json
import logging
import os
from pathlib import Path
import re
import sys
import time
import xml.etree.ElementTree as ET
from common import PACKAGE, REPO, UIDS, Oracle, accounts, field, require, session_title


def until(check, timeout=45):
    deadline = time.monotonic() + timeout
    while True:
        result = check()
        if result:
            return result
        require(time.monotonic() < deadline, "condition_timeout")
        time.sleep(1)


def locate(xml, *, text=None, description=None, label=None):
    """Read accessibility semantics, never hard-code screen coordinates."""
    found = []
    for node in ET.fromstring(xml).iter("node"):
        if node.get("package") != PACKAGE or node.get("enabled") != "true":
            continue
        if label is not None:
            if node.get("class") != "android.widget.EditText":
                continue
            values = [v for child in node.iter() for v in (child.get("text", ""), child.get("content-desc", ""))]
            match = any(label in value for value in values)
        else:
            match = (text is not None and node.get("text") == text) or (
                description is not None and node.get("content-desc") == description)
        if match:
            bounds = re.fullmatch(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", node.get("bounds", ""))
            if bounds:
                left, top, right, bottom = map(int, bounds.groups())
                if right > left and bottom > top:
                    found.append(((left + right) // 2, (top + bottom) // 2))
    require(len(found) <= 1, "ambiguous_ui_control")
    return found[0] if found else None


class UI:
    def __init__(self):
        import uiautomator2 as u2
        self.d = u2.connect()
        self.d.settings["wait_timeout"] = 10

    def find(self, scroll=False, **selector):
        for attempt in range(9 if scroll else 1):
            require(self.d.app_current().get("package") == PACKAGE, "unexpected_foreground_app")
            point = locate(self.d.dump_hierarchy(), **selector)
            if point:
                return point
            if scroll and attempt < 8:
                area = self.d(packageName=PACKAGE, scrollable=True)
                if not area.exists:
                    return None
                area.scroll.forward(steps=30)
        return None

    def wait(self, **selector):
        return until(lambda: self.find(**selector))

    def click(self, scroll=False, **selector):
        point = until(lambda: self.find(scroll=scroll, **selector))
        self.d.click(*point)

    def fill(self, label, value):
        self.click(label=label, scroll=True)
        target = self.d(packageName=PACKAGE, className="android.widget.EditText", focused=True)
        require(target.count == 1, "input_not_focused")
        target.set_text(value)
        # Hide only the IME; Back must not accidentally leave the form.
        if self.d.info.get("currentPackageName") == PACKAGE:
            keyboard = self.d.shell(["dumpsys", "input_method"]).output
            if "mInputShown=true" in keyboard or "mIsInputViewShown=true" in keyboard:
                self.d.press("back")

    def login(self, bot, name):
        self.wait(text="Entrar na comunidade")
        self.fill("E-mail", bot["email"])
        self.fill("Senha (mínimo 6 caracteres)", bot["password"])
        self.click(text="Entrar", scroll=True)
        self.wait(text=f"Paz e bem, {name.split()[0]}!")

    def logout(self):
        self.click(text="Perfil")
        self.click(text="Sair da conta", scroll=True)
        self.wait(text="Entrar na comunidade")

    def open_post(self, title):
        # Search by the unique test title. Never select the first public post.
        self.click(description="Buscar")
        self.fill("Buscar discussões", title)
        self.click(text=title, scroll=True)
        self.wait(label="Sua resposta", scroll=True)


def execute(report):
    require(os.environ.get("GITHUB_EVENT_NAME") == "workflow_dispatch", "manual_only")
    require(os.environ.get("GITHUB_REPOSITORY") == REPO, "wrong_repository")
    require(os.environ.get("GITHUB_RUN_ATTEMPT") == "1", "rerun_not_allowed")
    require(not os.environ.get("GOOGLE_APPLICATION_CREDENTIALS"), "admin_credentials_refused")
    bots = accounts(os.environ["ATRIO_QA_BOTS_JSON"])
    title = session_title(os.environ["QA_SESSION"])
    mode = os.environ["QA_MODE"]
    require(mode in ("preflight", "session"), "invalid_mode")
    report.update(session=os.environ["QA_SESSION"], mode=mode, stage="verify_bot_logins")
    oracle = Oracle(os.environ["FIREBASE_WEB_API_KEY"], bots)
    require(not oracle.query("clara", "posts", "title", title), "session_already_has_post")
    if mode == "preflight":
        report["status"] = "preflight_passed_no_ui_session"
        return

    ui = UI()
    ui.d.app_start(PACKAGE, stop=True)
    until(lambda: ui.d.app_current().get("package") == PACKAGE)
    report["stage"] = "clara_login"
    ui.login(bots["clara"], oracle.names["clara"])
    report["stage"] = "clara_publish"
    ui.click(text="Publicar")
    ui.fill("Título da publicação", title)
    body = "SIMULACAO: teste solicitado pelo fundador, feito por tres bots no APK oficial. Nao e uma conversa humana."
    ui.fill("Sua reflexão ou pergunta", body)
    # Exactly ONE submission. No retry of a click after ambiguous network failure.
    ui.click(text="Publicar discussão", scroll=True)
    posts = until(lambda: oracle.query("clara", "posts", "title", title))
    require(len(posts) == 1, "post_count_mismatch")
    post = posts[0]
    require(field(post, "uid") == UIDS["clara"] and field(post, "body") == body, "post_author_or_body_mismatch")
    post_id = post["name"].split("/")[-1]
    report["post_id"] = post_id
    report["checks"].append("clara_publish_ui_and_server")
    ui.wait(text=f"Paz e bem, {oracle.names['clara'].split()[0]}!")
    ui.logout()

    reply_ids = []
    for alias in ("miguel", "lucia"):
        report["stage"] = alias + "_login_and_reply"
        ui.login(bots[alias], oracle.names[alias])
        ui.open_post(title)
        require(field(oracle.get(alias, "posts/" + post_id), "uid") == UIDS["clara"], "target_changed")
        body = f"SIMULACAO BOT DE TESTE: {alias} respondeu pela interface do APK. Sessao {os.environ['QA_SESSION']}."
        ui.fill("Sua resposta", body)
        ui.click(text="Enviar resposta", scroll=True)
        replies = until(lambda: oracle.query(alias, "replies", "uid", UIDS[alias], "posts/" + post_id))
        require(len(replies) == 1 and field(replies[0], "body") == body, "reply_mismatch")
        reply_ids.append(replies[0]["name"].split("/")[-1])
        report["checks"].append(alias + "_reply_ui_and_server")
        ui.click(description="Voltar")
        ui.logout()

    report["stage"] = "clara_notifications"
    ui.login(bots["clara"], oracle.names["clara"])
    def two_notices():
        items = oracle.query("clara", "notifications", "postId", post_id, "users/" + UIDS["clara"])
        return items if len(items) >= 2 else []
    notices = until(two_notices)
    require(len(notices) == 2 and {field(n, "replyId") for n in notices} == set(reply_ids)
            and {field(n, "actorUid") for n in notices} == {UIDS['miguel'], UIDS['lucia']}, "notifications_mismatch")
    ui.click(description="Notificações")
    ui.wait(text="Notificações")
    # Server persistence + opening the central. Do not claim FCM or read marking.
    report["checks"].append("two_internal_notices_and_center_opened")
    report.update(status="passed", stage="complete")


if __name__ == "__main__":
    report = {"status": "failed", "stage": "configuration", "checks": []}
    logging.disable(logging.CRITICAL)
    code = 0
    try:
        # Third-party UI errors can contain field values. Never upload raw logs,
        # screenshots, hierarchy dumps, tokens, emails or passwords.
        with open(os.devnull, "w") as sink, contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
            execute(report)
    except Exception:
        code = 1
    finally:
        Path("qa-official-results").mkdir(exist_ok=True)
        filename = "preflight.json" if os.environ.get("QA_MODE") == "preflight" else "session.json"
        Path("qa-official-results", filename).write_text(json.dumps(report, indent=2))
        print(json.dumps(report))
    sys.exit(code)
